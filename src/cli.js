#!/usr/bin/env node
// @ts-check

import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const LOG_PREFIX = "lint-js:";

/** Error raised by lint-js itself (not a wrapped child-process or tool error). */
class LintJsError extends Error {
  name = "LintJsError";
}

/**
 * Plain stdout line. Used for help, version, phase banners, blank separators.
 *
 * @param {string} msg
 */
function print(msg) {
  console.log(msg);
}

/**
 * Tagged stdout line. Used for the end-of-run outcome.
 *
 * @param {string} msg
 */
function printTagged(msg) {
  console.log(`${LOG_PREFIX} ${msg}`);
}

/**
 * Tagged stderr headline followed by plain-text detail lines.
 *
 * @param {string} headline
 * @param {...string} details
 */
function errorTagged(headline, ...details) {
  console.error(`${LOG_PREFIX} ${headline}`);
  for (const line of details) console.error(`  ${line}`);
}

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
    throw new LintJsError(`Missing or malformed "bin" in ${packageName}/package.json.`);
  }
  const binPath = pkg.bin[binName];
  if (typeof binPath !== "string") {
    throw new LintJsError(`Missing "${binName}" bin in ${packageName}/package.json.`);
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
    throw new LintJsError('Missing or malformed "version" in package.json.');
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
    throw new LintJsError(`failed to launch ${name}: ${result.error.message}`, {
      cause: result.error,
    });
  }
  return result;
}

/**
 * Like {@link runTool} but also captures stdout and stderr for post-run inspection.
 *
 * File-backed stdio (not pipes): workaround for https://github.com/openai/codex/issues/18473,
 * where captured pipe-backed output from a nested Node child can be dropped in the Codex sandbox.
 * Side effect: the child's output is batched until exit instead of streaming;
 * both streams are captured symmetrically so the caller can flush them in a deterministic order.
 *
 * @param {object} options
 * @param {string} options.name
 * @param {string} options.bin
 * @param {string[]} options.args
 * @param {NodeJS.ProcessEnv} [options.env]
 * @returns {{
 *   result: ReturnType<typeof spawnSync>;
 *   capturedStdout: string;
 *   capturedStderr: string;
 * }}
 */
function runToolCapturingOutput({ name, bin, args, env }) {
  const dir = mkdtempSync(join(tmpdir(), "lint-js-"));
  const stdoutPath = join(dir, "stdout");
  const stderrPath = join(dir, "stderr");
  let stdoutFd = -1;
  let stderrFd = -1;
  try {
    stdoutFd = openSync(stdoutPath, "w");
    stderrFd = openSync(stderrPath, "w");
    const result = spawnSync(process.execPath, [bin, ...args], {
      stdio: ["inherit", stdoutFd, stderrFd],
      env,
    });
    closeSync(stdoutFd);
    stdoutFd = -1;
    closeSync(stderrFd);
    stderrFd = -1;
    if (result.error) {
      throw new LintJsError(`failed to launch ${name}: ${result.error.message}`, {
        cause: result.error,
      });
    }
    return {
      result,
      capturedStdout: readFileSync(stdoutPath, "utf8"),
      capturedStderr: readFileSync(stderrPath, "utf8"),
    };
  } finally {
    if (stdoutFd !== -1) closeSync(stdoutFd);
    if (stderrFd !== -1) closeSync(stderrFd);
    rmSync(dir, { recursive: true, force: true });
  }
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
 * Match an oxlint `--format=unix` diagnostic from any rule in the `no-unsafe-*` family.
 * Loose `[\w-]+` so future additions to the family are picked up automatically.
 */
const UNSAFE_ANY_DIAGNOSTIC_PATTERN = /typescript-eslint\(no-unsafe-[\w-]+\)/;

/**
 * Print a pointer to `docs/weak-typings.md`.
 * Call after the lint phase on a `no-unsafe-*` hit.
 */
function printWeakTypingsHint() {
  print("Hint on the `no-unsafe-*` diagnostics:");
  print(
    "- Remedies: `*.d.ts` augmentation, `unknown` + type predicates, or boundary module with typed wrappers.",
  );
  print(
    "- Inline disable (`// oxlint-disable-next-line`) is not a fix; use only when explicitly permitted by the project maintainer.",
  );
  print(`- See: ${packagePath("docs", "weak-typings.md")}`);
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
      ? "Completed successfully. No issues found."
      : "Failed. Issues found; fixes required.";
  }
  return ok
    ? "Completed successfully. Issues fixed where possible."
    : "Failed. Issues fixed where possible; unfixable issues remain.";
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
    print(HELP_TEXT);
    return 0;
  }
  if (values.version === true) {
    print(`lint-js ${getPackageVersion()}`);
    return 0;
  }

  if (!existsSync("package.json")) {
    errorTagged(
      "no package.json in current directory.",
      "Run lint-js from the root of a JS/TS project.",
      "(Required as a guard against accidental runs)",
    );
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
      errorTagged(`target not found: ${target}`);
      return 1;
    }
  }

  // Phase banners deliberately omit the `lint-js:` prefix used elsewhere for CLI diagnostics.
  // They sit inline with oxfmt/oxlint's own output; prefixing would break visual cohesion.

  // Fmt start banner is unconditional although oxfmt itself prints "Checking formatting..." in check mode.
  // oxfmt's own opener is absent for zero-match runs,
  // so without this line stdout would show no trace of the fmt phase at all.
  const fmtLabel = check ? "formatting (check-only)" : "formatting";
  print(`${fmtLabel}...`);
  const fmtResult = runTool({
    name: "oxfmt",
    bin: oxfmtBin,
    args: buildOxfmtArgs(oxfmtConfig, ignorePatterns, targets, check),
  });
  // No fmt completion banner: oxfmt prints its own summary and ours would duplicate.

  print("");

  const lintLabel = check ? "linting (no auto-fix)" : "linting (with auto-fix)";
  print(`${lintLabel}...`);
  const {
    result: lintResult,
    capturedStdout: lintStdout,
    capturedStderr: lintStderr,
  } = runToolCapturingOutput({
    name: "oxlint",
    bin: oxlintBin,
    args: buildOxlintArgs(oxlintConfig, ignorePatterns, targets, check),
    env: buildPathInjectedEnv(packagePath("node_modules", ".bin")),
  });
  // Replay stderr first, then stdout. Both are batched (Codex-sandbox workaround)
  // so emission timing is lost; this fixed order keeps the relayed sequence deterministic.
  process.stderr.write(lintStderr);
  process.stdout.write(lintStdout);
  if (lintResult.status === 0) print(`${lintLabel}: clean.`);
  if (UNSAFE_ANY_DIAGNOSTIC_PATTERN.test(lintStdout)) {
    print("");
    printWeakTypingsHint();
  }

  print("");
  printTagged(buildSummary({ check, fmtStatus: fmtResult.status, lintStatus: lintResult.status }));

  return Math.max(fmtResult.status ?? 1, lintResult.status ?? 1);
}

process.exitCode = main();
