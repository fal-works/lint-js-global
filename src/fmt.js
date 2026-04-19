// @ts-check

/**
 * Build CLI args for oxfmt.
 *
 * @param {string} config Path to the oxfmt config file.
 * @param {string[]} ignorePatterns Gitignore-style patterns.
 * @param {string[]} targets Positional paths to process.
 * @param {boolean} check Verify only; do not rewrite files.
 * @returns {string[]}
 */
export function buildOxfmtArgs(config, ignorePatterns, targets, check) {
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
