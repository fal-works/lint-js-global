#!/usr/bin/env node
// @ts-check

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
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

// Step 1: format
console.log("lint-js: formatting...");
const fmtResult = spawnSync(process.execPath, [oxfmtBin, "-c", oxfmtConfig, "."], {
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
const lintResult = spawnSync(
  process.execPath,
  [
    oxlintBin,
    "-c",
    oxlintConfig,
    "--format=unix",
    "--fix",
    "--type-aware",
    "--type-check",
    "--ignore-pattern",
    "node_modules",
    ".",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      [pathKey]: `${binDir}${process.platform === "win32" ? ";" : ":"}${process.env[pathKey] ?? ""}`,
    },
  },
);
if (lintResult.error) {
  console.error("lint-js: failed to launch oxlint:", lintResult.error.message);
  process.exit(1);
}

process.exit(lintResult.status ?? 1);
