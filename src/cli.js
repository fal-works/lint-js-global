#!/usr/bin/env node
// @ts-check

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

/**
 * Resolve a path relative to this package's root (not the cwd).
 *
 * @param {...string} segments
 * @returns {string}
 */
function packagePath(...segments) {
  return join(dirname(fileURLToPath(import.meta.url)), "..", ...segments);
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
  const packageJsonPath = require.resolve(`${packageName}/package.json`);
  const packageJsonText = readFileSync(packageJsonPath, "utf8");
  // oxlint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const packageJson = /** @type {{ bin?: Record<string, string> }} */ (JSON.parse(packageJsonText));
  const binPath = packageJson.bin?.[binName];

  if (typeof binPath !== "string") {
    throw new Error(`Missing "${binName}" bin in ${packageName}/package.json.`);
  }

  return join(dirname(packageJsonPath), binPath);
}

if (!existsSync("package.json")) {
  console.error("lint-js: no package.json found in current directory.");
  console.error("Run lint-js from the root of a JS/TS project.");
  process.exit(1);
}

const oxfmtBin = resolvePackageBin("oxfmt", "oxfmt");
const oxlintBin = resolvePackageBin("oxlint", "oxlint");
const oxfmtConfig = packagePath("cfg", "oxfmtrc.json");
const oxlintConfig = packagePath("cfg", "oxlintrc.json");

/**
 * Returns ignore patterns that apply regardless of project configuration.
 *
 * Currently handles Claude Code's sandbox, which bind-mounts user config files
 * (`.mcp.json`, `.claude/`) to `/dev/null` at the project root to block accidental writes.
 * Without these ignores, oxfmt / oxlint fail with `Failed to read` / `EROFS` on those paths.
 *
 * Detection uses `$HOME` dotfiles shadowed as character devices at the project root:
 * they are always shadowed inside the sandbox and never legitimate files in a JS/TS project root.
 *
 * @returns {string[]} Root-anchored patterns so same-name files in sub-trees are not affected.
 */
function getSystemIgnorePatterns() {
  const claudeSandboxSentinels = [".bashrc", ".gitconfig"];
  const inClaudeSandbox = claudeSandboxSentinels.some((path) => {
    try {
      return statSync(path).isCharacterDevice();
    } catch {
      return false;
    }
  });

  if (inClaudeSandbox) return ["/.mcp.json", "/.claude"];

  return [];
}

/**
 * Launches a tool via `process.execPath` with stdio inherited from the parent.
 * On launch failure (e.g. bin not found) prints a diagnostic and exits the process.
 *
 * @param {object} options
 * @param {string} options.action Phrase for the progress log (e.g. `"formatting"`).
 * @param {string} options.name Tool name used in launch-failure diagnostics.
 * @param {string} options.bin Absolute path to the tool's JS entry point.
 * @param {string[]} options.args Arguments passed to the tool, excluding `bin`.
 * @param {NodeJS.ProcessEnv} [options.env] Env for child process. Defaults to inherited.
 * @returns {ReturnType<typeof spawnSync>}
 */
function runTool({ action, name, bin, args, env }) {
  console.log(`lint-js: ${action}...`);
  const result = spawnSync(process.execPath, [bin, ...args], {
    stdio: "inherit",
    env,
  });
  if (result.error) {
    console.error(`lint-js: failed to launch ${name}:`, result.error.message);
    process.exit(1);
  }
  return result;
}

const systemIgnorePatterns = getSystemIgnorePatterns();

// Step 1: format
const oxfmtArgs = ["-c", oxfmtConfig, "."];
for (const pattern of systemIgnorePatterns) oxfmtArgs.push(`!${pattern}`);
runTool({ action: "formatting", name: "oxfmt", bin: oxfmtBin, args: oxfmtArgs });

// Step 2: lint + fix (type-aware)
const oxlintArgs = [
  "-c",
  oxlintConfig,
  "--format=unix",
  "--fix",
  "--type-aware",
  "--type-check",
  "--ignore-pattern",
  "node_modules",
];
for (const pattern of systemIgnorePatterns) {
  oxlintArgs.push("--ignore-pattern", pattern);
}
oxlintArgs.push(".");

// oxlint spawns the `tsgolint` binary via PATH lookup. For globally-installed
// lint-js, inject our own node_modules/.bin at the head of PATH so the bundled
// oxlint-tsgolint shim is found regardless of the user project's layout.
const binDir = packagePath("node_modules", ".bin");
const pathKey = process.platform === "win32" ? "Path" : "PATH";
const pathSep = process.platform === "win32" ? ";" : ":";
const lintResult = runTool({
  action: "linting (with auto-fix)",
  name: "oxlint",
  bin: oxlintBin,
  args: oxlintArgs,
  env: {
    ...process.env,
    [pathKey]: `${binDir}${pathSep}${process.env[pathKey] ?? ""}`,
  },
});

process.exit(lintResult.status ?? 1);
