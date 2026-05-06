import type { Logger } from "./log.ts";
import { resolvePackageBin } from "./package-info.ts";
import { OXFMT_CONFIG } from "./package-paths.ts";
import { runToolCapturingCombined } from "./run-tool.ts";

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

export interface FmtPhaseOptions {
  check: boolean;
  targets: readonly string[];
  ignorePatterns: readonly string[];
}

export interface FmtPhaseContext {
  cwd: string;
  logger: Logger;
}

export interface FmtPhaseResult {
  /** oxfmt's exit code. */
  status: number;
}

/**
 * Run the format phase: spawn oxfmt against `opts.targets` under `ctx.cwd`.
 * On success, emits nothing. On a non-zero exit, relays oxfmt's captured
 * output to stderr verbatim.
 *
 * @throws {LintJsError} on launch failure or signal-driven termination
 *   (propagated from `runToolCapturingCombined`).
 */
export function runFmtPhase(opts: FmtPhaseOptions, ctx: FmtPhaseContext): FmtPhaseResult {
  const { check, targets, ignorePatterns } = opts;
  const { cwd, logger } = ctx;

  const oxfmtBin = resolvePackageBin("oxfmt", "oxfmt");
  // Combined capture: oxfmt's output is auxiliary text routed to stderr as a single block,
  // so capturing the streams together preserves the child's natural emission order.
  const { result, captured } = runToolCapturingCombined({
    name: "oxfmt",
    bin: oxfmtBin,
    args: buildOxfmtArgs(OXFMT_CONFIG, ignorePatterns, targets, check),
    cwd,
  });

  if (result.status === 0) {
    return { status: 0 };
  }

  logger.writeErr(captured);
  return { status: result.status ?? 0 };
}
