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
 * Read the version field from this package's own `package.json`.
 *
 * @returns {string}
 */
function getPackageVersion() {
  /** @type {unknown} */
  const pkg = JSON.parse(readFileSync(packagePath("package.json"), "utf8"));
  if (!isRecord(pkg) || typeof pkg.version !== "string") {
    throw new Error('Missing or malformed "version" in package.json.');
  }
  return pkg.version;
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
 * @param {string} options.name Tool name for launch-failure diagnostics.
 * @param {string} options.bin Absolute path to the tool's JS entry point.
 * @param {string[]} options.args Arguments passed to the tool, excluding `bin`.
 * @param {NodeJS.ProcessEnv} [options.env] Env for the child. Defaults to inherited.
 * @returns {ReturnType<typeof spawnSync>}
 */
function runTool({ name, bin, args, env }) {
  const result = spawnSync(process.execPath, [bin, ...args], {
    stdio: "inherit",
    env,
  });
  if (result.error) {
    throw new Error(`lint-js: failed to launch ${name}: ${result.error.message}`, {
      cause: result.error,
    });
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
 * oxlint spawns the `tsgolint` binary via PATH lookup.
 * For globally-installed lint-js, inject our own `node_modules/.bin` at the head of PATH
 * so the bundled oxlint-tsgolint shim is found regardless of the user project's layout.
 *
 * @param {string} binDir Directory to prepend to PATH.
 * @returns {NodeJS.ProcessEnv}
 */
function buildPathInjectedEnv(binDir) {
  const isWindows = process.platform === "win32";
  const pathKey = isWindows ? "Path" : "PATH";
  const pathSep = isWindows ? ";" : ":";
  const env = { ...process.env };

  // On Windows, env keys are case-insensitive but spreading preserves the parent's spelling.
  // Remove other variants so Node doesn't pick an earlier entry ("PATH" < "Path" lexicographically)
  // and drop the prepended bin dir.
  if (isWindows) {
    for (const key of Object.keys(env)) {
      if (key !== pathKey && key.toUpperCase() === "PATH") delete env[key];
    }
  }
  env[pathKey] = `${binDir}${pathSep}${process.env[pathKey] ?? ""}`;
  return env;
}

/**
 * Pick the one-line summary emitted after both phases finish.
 *
 * Binary verdict (success/failure) — which phase failed is readable from the
 * tool output above, so the summary only needs to convey overall outcome and
 * whether fixes may have been applied.
 *
 * @param {object} options
 * @param {boolean} options.check
 * @param {number | null} options.fmtStatus
 * @param {number | null} options.lintStatus
 * @returns {string}
 */
function buildSummary({ check, fmtStatus, lintStatus }) {
  const ok = fmtStatus === 0 && lintStatus === 0;
  if (check) {
    return ok
      ? "lint-js: Completed successfully. No issues found."
      : "lint-js: Failed. Issues found; fixes required.";
  }
  return ok
    ? "lint-js: Completed successfully. Issues fixed where possible."
    : "lint-js: Failed. Issues fixed where possible; unfixable issues remain.";
}

const HELP_TEXT = `Usage: lint-js [--check] [path...]

Runs oxfmt and oxlint (+ auto-fix) on a JS/TS project.
Must be run from a project root (package.json required).

Options:
  --check         Verify only; do not rewrite files.
  -h, --help      Show this help.
  -v, --version   Show version.

Without paths, the whole project is processed.
node_modules is always skipped; .gitignore, .eslintignore, .prettierignore are respected.`;

/**
 * CLI entry point. Returns the process exit code.
 *
 * @returns {number}
 */
function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      check: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
    allowPositionals: true,
    strict: true,
  });

  if (values.help === true) {
    console.log(HELP_TEXT);
    return 0;
  }
  if (values.version === true) {
    console.log(`lint-js ${getPackageVersion()}`);
    return 0;
  }

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
  const check = values.check === true;
  const targets = positionals.length > 0 ? positionals : ["."];

  for (const target of targets) {
    if (!existsSync(target)) {
      console.error(`lint-js: target not found: ${target}`);
      return 1;
    }
  }

  // Phase banners deliberately omit the `lint-js:` prefix used elsewhere for CLI diagnostics.
  // They sit inline with oxfmt/oxlint's own output; prefixing would break visual cohesion.

  // Fmt start banner is unconditional: oxfmt's own opener is absent for zero-match runs,
  // so without this line stdout would show no trace of the fmt phase at all.
  console.log("formatting...");
  const fmtResult = runTool({
    name: "oxfmt",
    bin: oxfmtBin,
    args: buildOxfmtArgs(oxfmtConfig, ignorePatterns, targets, check),
  });
  // No fmt completion banner: oxfmt prints its own summary and ours would duplicate.

  console.log();

  const lintLabel = check ? "linting (no auto-fix)" : "linting (with auto-fix)";
  console.log(`${lintLabel}...`);
  const lintResult = runTool({
    name: "oxlint",
    bin: oxlintBin,
    args: buildOxlintArgs(oxlintConfig, ignorePatterns, targets, check),
    env: buildPathInjectedEnv(packagePath("node_modules", ".bin")),
  });
  if (lintResult.status === 0) console.log(`${lintLabel}: clean.`);

  console.log();
  console.log(buildSummary({ check, fmtStatus: fmtResult.status, lintStatus: lintResult.status }));

  return Math.max(fmtResult.status ?? 1, lintResult.status ?? 1);
}

process.exitCode = main();
