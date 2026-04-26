// @ts-check

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { LintJsError } from "./log.js";
import { PACKAGE_JSON } from "./package-paths.js";

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
export function resolvePackageBin(packageName, binName) {
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
export function getPackageVersion() {
  /** @type {unknown} */
  const pkg = JSON.parse(readFileSync(PACKAGE_JSON, "utf8"));
  if (!isRecord(pkg) || typeof pkg.version !== "string") {
    throw new LintJsError('Missing or malformed "version" in package.json.');
  }
  return pkg.version;
}
