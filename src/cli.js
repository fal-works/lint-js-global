#!/usr/bin/env node
// @ts-check

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolve a path relative to this package's root (not the cwd).
 *
 * @param {...string} segments
 * @returns {string}
 */
function packagePath(...segments) {
  return join(dirname(fileURLToPath(import.meta.url)), "..", ...segments);
}

if (!existsSync("package.json")) {
  console.error("lint-js: no package.json found in current directory.");
  console.error("Run lint-js from the root of a JS/TS project.");
  process.exit(1);
}

const oxfmtBin = packagePath("node_modules", ".bin", "oxfmt");
const oxlintBin = packagePath("node_modules", ".bin", "oxlint");
const oxfmtConfig = packagePath("cfg", "oxfmtrc.json");
const oxlintConfig = packagePath("cfg", "oxlintrc.json");

// Step 1: format
const fmtResult = spawnSync(oxfmtBin, ["-c", oxfmtConfig, "."], { stdio: "inherit" });
if (fmtResult.error) {
  console.error("lint-js: failed to launch oxfmt:", fmtResult.error.message);
  process.exit(1);
}

// Step 2: lint + fix
const lintResult = spawnSync(oxlintBin, ["-c", oxlintConfig, "--fix", "."], {
  stdio: "inherit",
});
if (lintResult.error) {
  console.error("lint-js: failed to launch oxlint:", lintResult.error.message);
  process.exit(1);
}

process.exit(lintResult.status ?? 1);
