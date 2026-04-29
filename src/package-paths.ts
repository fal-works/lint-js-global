import { join } from "node:path";

/**
 * Centralized absolute paths to package-internal files and directories.
 *
 * Single source of truth for any code that needs to reference a path inside this
 * package's installed footprint. A unit test stat()s every export to catch
 * references that rot when files are moved or renamed.
 */

const fromRoot = (...segments: string[]): string => join(import.meta.dirname, "..", ...segments);

export const PACKAGE_JSON = fromRoot("package.json");
export const OXFMT_CONFIG = fromRoot("cfg", "oxfmtrc.json");
export const OXLINT_CONFIG = fromRoot("cfg", "oxlintrc.json");
export const WEAK_TYPINGS_DOC = fromRoot("docs", "guide", "weak-typings.md");
export const NODE_MODULES_BIN = fromRoot("node_modules", ".bin");
