// @ts-check

import { print } from "./log.js";
import { packagePath } from "./package-info.js";

/**
 * Build CLI args for oxlint.
 *
 * @param {string} config Path to the oxlint config file.
 * @param {string[]} ignorePatterns Gitignore-style patterns.
 * @param {string[]} targets Positional paths to process.
 * @param {boolean} check Report only; do not apply auto-fix.
 * @returns {string[]}
 */
export function buildOxlintArgs(config, ignorePatterns, targets, check) {
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
 * Match an oxlint `--format=unix` diagnostic from any rule in the `no-unsafe-*` family.
 * Loose `[\w-]+` so future additions to the family are picked up automatically.
 */
export const UNSAFE_ANY_DIAGNOSTIC_PATTERN = /typescript-eslint\(no-unsafe-[\w-]+\)/;

/**
 * Print a pointer to `docs/weak-typings.md`.
 * Call after the lint phase on a `no-unsafe-*` hit.
 */
export function printWeakTypingsHint() {
  print("Hint on the `no-unsafe-*` diagnostics:");
  print(
    "- Remedies: `*.d.ts` augmentation, `unknown` + type predicates, or boundary module with typed wrappers.",
  );
  print(
    "- Inline disable (`// oxlint-disable-next-line`) is not a fix; use only when explicitly permitted by the project maintainer.",
  );
  print(`- See: ${packagePath("docs", "weak-typings.md")}`);
}
