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

const systemIgnorePatterns = getSystemIgnorePatterns();

// Step 1: format
console.log("lint-js: formatting...");
const oxfmtArgs = [oxfmtBin, "-c", oxfmtConfig, "."];
for (const pattern of systemIgnorePatterns) oxfmtArgs.push(`!${pattern}`);
const fmtResult = spawnSync(process.execPath, oxfmtArgs, {
  stdio: "inherit",
});
if (fmtResult.error) {
  console.error("lint-js: failed to launch oxfmt:", fmtResult.error.message);
  process.exit(1);
}

// Step 2: lint + fix (type-aware)
// oxlint spawns the `tsgolint` binary via PATH lookup. For globally-installed
// lint-js, inject our own node_modules/.bin at the head of PATH so the bundled
// oxlint-tsgolint shim is found regardless of the user project's layout.
console.log("lint-js: linting (with auto-fix)...");
const binDir = packagePath("node_modules", ".bin");
const pathKey = process.platform === "win32" ? "Path" : "PATH";
const oxlintArgs = [
  oxlintBin,
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
const lintResult = spawnSync(process.execPath, oxlintArgs, {
  stdio: "inherit",
  env: {
    ...process.env,
    [pathKey]: `${binDir}${process.platform === "win32" ? ";" : ":"}${process.env[pathKey] ?? ""}`,
  },
});
if (lintResult.error) {
  console.error("lint-js: failed to launch oxlint:", lintResult.error.message);
  process.exit(1);
}

process.exit(lintResult.status ?? 1);
