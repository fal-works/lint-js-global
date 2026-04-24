// @ts-check

/**
 * Build CLI args for oxlint.
 *
 * Default mode uses `--format=json` for downstream parsing by the LLM-friendly formatter.
 * `unix` mode delegates to oxlint's own `--format=unix` for VS Code terminal link detection.
 *
 * @param {string} config Path to the oxlint config file.
 * @param {string[]} ignorePatterns Gitignore-style patterns.
 * @param {string[]} targets Positional paths to process.
 * @param {boolean} check Report only; do not apply auto-fix.
 * @param {boolean} unix Emit `--format=unix` instead of `--format=json`.
 * @returns {string[]}
 */
export function buildOxlintArgs(config, ignorePatterns, targets, check, unix) {
  const ignoreFlags = ignorePatterns.flatMap((pattern) => ["--ignore-pattern", pattern]);
  return [
    "-c",
    config,
    unix ? "--format=unix" : "--format=json",
    ...(check ? [] : ["--fix"]),
    "--type-aware",
    "--type-check",
    ...ignoreFlags,
    ...targets,
  ];
}
