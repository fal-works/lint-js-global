#!/usr/bin/env node
// @ts-check

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

/**
 * Resolve a path relative to this package's root (not the cwd).
 *
 * @param {...string} segments
 * @returns {string}
 */
function packagePath(...segments) {
  return join(import.meta.dirname, "..", ...segments);
}

/**
 * Type predicate narrowing an arbitrary value to a string-keyed record.
 *
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return value !== null && typeof value === "object";
}

/**
 * Resolve the bin script path for a dependency package.
 *
 * Running the script with `process.execPath` avoids relying on platform-specific
 * shims in `node_modules/.bin`.
 *
 * @param {string} packageName
 * @param {string} binName
 * @returns {string}
 */
function resolvePackageBin(packageName, binName) {
  const packageJsonPath = fileURLToPath(import.meta.resolve(`${packageName}/package.json`));
  /** @type {unknown} */
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  if (!isRecord(pkg) || !isRecord(pkg.bin)) {
    throw new Error(`Missing or malformed "bin" in ${packageName}/package.json.`);
  }
  const binPath = pkg.bin[binName];
  if (typeof binPath !== "string") {
    throw new Error(`Missing "${binName}" bin in ${packageName}/package.json.`);
  }
  return join(dirname(packageJsonPath), binPath);
}

/**
 * Returns ignore patterns that apply regardless of project configuration.
 *
 * - `node_modules` (unanchored, any depth) — oxlint does not skip it unless an `.eslintignore` is
 *   present. oxfmt already skips it by default, so the pattern is a no-op there.
 * - `/.mcp.json`, `/.claude` (root-anchored) — Claude Code's sandbox bind-mounts these to `/dev/null`
 *   at the project root, causing oxfmt / oxlint to fail with `Failed to read` / `EROFS`. Detected
 *   via `$HOME` dotfiles shadowed as character devices at the project root: always shadowed inside
 *   the sandbox, never legitimate in a JS/TS project root.
 *
 * @returns {string[]} Gitignore-style patterns.
 */
function getSystemIgnorePatterns() {
  const patterns = ["node_modules"];

  const claudeSandboxSentinels = [".bashrc", ".gitconfig"];
  const inClaudeSandbox = claudeSandboxSentinels.some((path) => {
    try {
      return statSync(path).isCharacterDevice();
    } catch {
      return false;
    }
  });
  if (inClaudeSandbox) patterns.push("/.mcp.json", "/.claude");

  return patterns;
}

/**
 * Launches a tool via `process.execPath` with stdio inherited.
 * Throws on launch failure so Node surfaces the stack trace.
 *
 * @param {object} options
 * @param {string} [options.progressLabel] Gerund (e.g. `"formatting"`);
 *   when given, logs `"<label>..."` at start and `"<label>: clean."`
 *   after a zero-exit run (subject to `logCompletion`).
 * @param {boolean} [options.logCompletion=true] Pass `false` to suppress the
 *   completion line — use when the tool already prints its own summary. Default is `true`
 * @param {string} options.name Tool name for launch-failure diagnostics.
 * @param {string} options.bin Absolute path to the tool's JS entry point.
 * @param {string[]} options.args Arguments passed to the tool, excluding `bin`.
 * @param {NodeJS.ProcessEnv} [options.env] Env for the child. Defaults to inherited.
 * @returns {ReturnType<typeof spawnSync>}
 */
function runTool({ progressLabel, logCompletion = true, name, bin, args, env }) {
  const hasLabel = (progressLabel?.length ?? 0) > 0;

  if (hasLabel) console.log(`${progressLabel}...`);
  const result = spawnSync(process.execPath, [bin, ...args], {
    stdio: "inherit",
    env,
  });
  if (result.error) {
    throw new Error(`lint-js: failed to launch ${name}: ${result.error.message}`, {
      cause: result.error,
    });
  }

  if (hasLabel && logCompletion && result.status === 0) {
    console.log(`\n${progressLabel}: clean.`);
  }

  return result;
}

/**
 * Build CLI args for oxfmt.
 *
 * @param {string} config Path to the oxfmt config file.
 * @param {string[]} ignorePatterns Gitignore-style patterns.
 * @param {string[]} targets Positional paths to process.
 * @param {boolean} check Verify only; do not rewrite files.
 * @returns {string[]}
 */
function buildOxfmtArgs(config, ignorePatterns, targets, check) {
  return [
    "-c",
    config,
    // Suppress oxfmt's exit-2 when a positional target resolves to no files
    // (e.g. fully excluded by `.prettierignore`).
    // Typos are caught separately by lint-js's own existence check.
    "--no-error-on-unmatched-pattern",
    ...(check ? ["--check"] : []),
    ...targets,
    ...ignorePatterns.map((pattern) => `!${pattern}`),
  ];
}

/**
 * Build CLI args for oxlint.
 *
 * @param {string} config Path to the oxlint config file.
 * @param {string[]} ignorePatterns Gitignore-style patterns.
 * @param {string[]} targets Positional paths to process.
 * @param {boolean} check Report only; do not apply auto-fix.
 * @returns {string[]}
 */
function buildOxlintArgs(config, ignorePatterns, targets, check) {
  const ignoreFlags = ignorePatterns.flatMap((pattern) => ["--ignore-pattern", pattern]);
  return [
    "-c",
    config,
    "--format=unix", // should be LLM-friendly
    ...(check ? [] : ["--fix"]),
    "--type-aware",
    "--type-check",
    ...ignoreFlags,
    ...targets,
  ];
}

/**
 * Returns a copy of `process.env` with `binDir` prepended to `PATH`.
 *
 * oxlint spawns the `tsgolint` binary via PATH lookup. For globally-installed
 * lint-js, inject our own node_modules/.bin at the head of PATH so the bundled
 * oxlint-tsgolint shim is found regardless of the user project's layout.
 *
 * @param {string} binDir Directory to prepend to PATH.
 * @returns {NodeJS.ProcessEnv}
 */
function buildPathInjectedEnv(binDir) {
  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  const pathSep = process.platform === "win32" ? ";" : ":";
  return {
    ...process.env,
    [pathKey]: `${binDir}${pathSep}${process.env[pathKey] ?? ""}`,
  };
}

/**
 * CLI entry point. Returns the process exit code.
 *
 * @returns {number}
 */
function main() {
  if (!existsSync("package.json")) {
    console.error("lint-js: no package.json in current directory.");
    console.error("Run lint-js from the root of a JS/TS project.");
    console.error("(Required as a guard against accidental runs)");
    return 1;
  }

  const oxfmtBin = resolvePackageBin("oxfmt", "oxfmt");
  const oxlintBin = resolvePackageBin("oxlint", "oxlint");
  const oxfmtConfig = packagePath("cfg", "oxfmtrc.json");
  const oxlintConfig = packagePath("cfg", "oxlintrc.json");
  const ignorePatterns = getSystemIgnorePatterns();
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      check: { type: "boolean" },
    },
    allowPositionals: true,
    strict: true,
  });
  const check = values.check === true;
  const targets = positionals.length > 0 ? positionals : ["."];

  for (const target of targets) {
    if (!existsSync(target)) {
      console.error(`lint-js: target not found: ${target}`);
      return 1;
    }
  }

  const fmtResult = runTool({
    // Always emit the phase label — oxfmt's own opener is absent for zero-match runs,
    // so without this line stdout would show no trace of the fmt phase at all.
    progressLabel: "formatting",
    // oxfmt prints its own summary; our completion line would only duplicate.
    logCompletion: false,
    name: "oxfmt",
    bin: oxfmtBin,
    args: buildOxfmtArgs(oxfmtConfig, ignorePatterns, targets, check),
  });

  console.log();

  const lintResult = runTool({
    progressLabel: check ? "linting (no auto-fix)" : "linting (with auto-fix)",
    name: "oxlint",
    bin: oxlintBin,
    args: buildOxlintArgs(oxlintConfig, ignorePatterns, targets, check),
    env: buildPathInjectedEnv(packagePath("node_modules", ".bin")),
  });

  return Math.max(fmtResult.status ?? 1, lintResult.status ?? 1);
}

process.exitCode = main();
