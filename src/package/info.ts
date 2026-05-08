import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { LintJsError } from "../error.ts";
import { PACKAGE_JSON } from "./paths.ts";

/**
 * Type predicate narrowing an arbitrary value to a string-keyed record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

/**
 * Resolve the bin script path for a dependency package.
 *
 * Running the script with `process.execPath` avoids relying on platform-specific
 * shims in `node_modules/.bin`.
 */
export function resolvePackageBin(packageName: string, binName: string): string {
  const packageJsonPath = fileURLToPath(import.meta.resolve(`${packageName}/package.json`));
  const pkg: unknown = JSON.parse(readFileSync(packageJsonPath, "utf8"));
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
 */
export function getPackageVersion(): string {
  const pkg: unknown = JSON.parse(readFileSync(PACKAGE_JSON, "utf8"));
  if (!isRecord(pkg) || typeof pkg.version !== "string") {
    throw new LintJsError('Missing or malformed "version" in package.json.');
  }
  return pkg.version;
}
