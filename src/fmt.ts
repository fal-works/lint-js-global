/**
 * Build CLI args for oxfmt.
 *
 * @param config - Path to the oxfmt config file.
 * @param ignorePatterns - Gitignore-style patterns.
 * @param targets - Positional paths to process.
 * @param check - Verify only; do not rewrite files.
 */
export function buildOxfmtArgs(
  config: string,
  ignorePatterns: readonly string[],
  targets: readonly string[],
  check: boolean,
): string[] {
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
