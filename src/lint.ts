/**
 * Build CLI args for oxlint.
 *
 * Default mode uses `--format=json` for downstream parsing by the LLM-friendly formatter.
 * `unix` mode delegates to oxlint's own `--format=unix` for VS Code terminal link detection.
 *
 * @param config - Path to the oxlint config file.
 * @param ignorePatterns - Gitignore-style patterns.
 * @param targets - Positional paths to process.
 * @param check - Report only; do not apply auto-fix.
 * @param unix - Emit `--format=unix` instead of `--format=json`.
 */
export function buildOxlintArgs(
  config: string,
  ignorePatterns: readonly string[],
  targets: readonly string[],
  check: boolean,
  unix: boolean,
): string[] {
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
