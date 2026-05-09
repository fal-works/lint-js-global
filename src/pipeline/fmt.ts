import type { Logger } from "../log.ts";
import { resolvePackageBin } from "../package/info.ts";
import { OXFMT_CONFIG } from "../package/paths.ts";
import { runToolCapturingCombined } from "../system/subprocess.ts";

/**
 * Build CLI args for oxfmt.
 *
 * @param config - Path to the oxfmt config file.
 * @param ignorePatterns - Gitignore-style patterns.
 * @param targets - Positional paths to process.
 * @param check - Verify only; do not rewrite files.
 */
function buildOxfmtArgs(
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

interface FmtPhaseOptions {
  check: boolean;
  targets: readonly string[];
  ignorePatterns: readonly string[];
}

interface FmtPhaseContext {
  cwd: string;
  logger: Logger;
}

/**
 * Outcome of a single oxfmt invocation.
 *
 * - `ok`: oxfmt exited 0.
 * - `findings`: `--check` reported files needing formatting (oxfmt exit 1).
 * - `fatal`: oxfmt rejected the input. Covers parse error (exit ≥ 2 in either mode) and write failure
 *   (any non-zero in write mode), both user-source attributable.
 * - Tool-side failures (launch, signal-driven termination) escalate to `LintJsError` and never reach
 *   this outcome.
 */
export type FmtPhaseOutcome = { kind: "ok" } | { kind: "findings" } | { kind: "fatal" };

/**
 * Run the format phase: spawn oxfmt against `opts.targets` under `ctx.cwd`.
 * On success, emits nothing. On any non-zero exit, relays oxfmt's captured output
 * to stderr verbatim.
 *
 * @throws {LintJsError} on launch failure or signal-driven termination
 *   (propagated from `runToolCapturingCombined`).
 */
export async function runFmtPhase(
  opts: FmtPhaseOptions,
  ctx: FmtPhaseContext,
): Promise<FmtPhaseOutcome> {
  const { check, targets, ignorePatterns } = opts;
  const { cwd, logger } = ctx;

  const oxfmtBin = resolvePackageBin("oxfmt", "oxfmt");
  // Combined capture: oxfmt's output is auxiliary text routed to stderr as a single block,
  // so capturing the streams together preserves the child's natural emission order.
  const { result, captured } = await runToolCapturingCombined({
    name: "oxfmt",
    bin: oxfmtBin,
    args: buildOxfmtArgs(OXFMT_CONFIG, ignorePatterns, targets, check),
    cwd,
  });

  const status = result.status ?? 0;
  if (status === 0) return { kind: "ok" };

  logger.writeErr(captured);
  // oxfmt exit codes: 0 = clean, 1 = `--check` drift, anything else fatal.
  // Write mode never legitimately exits 1.
  if (check && status === 1) return { kind: "findings" };
  return { kind: "fatal" };
}
