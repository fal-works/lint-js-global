import type { FmtPhaseOutcome } from "./fmt.ts";
import type { LintPhaseOutcome } from "./lint.ts";
import type { RunMode } from "./runner.ts";

export interface BuildSummaryOptions {
  mode: RunMode;
  check: boolean;

  /** True when the leading fmt phase halted the run; lint and trailing fmt were skipped. */
  halted: boolean;

  /** `null` if the phase was skipped (`--lint-only`). */
  leadingFmt: FmtPhaseOutcome | null;

  /** `null` if the phase was skipped (`--format-only`, or halted before it ran). */
  lint: LintPhaseOutcome | null;

  /** `null` if the phase was skipped (`--check`, `--format-only`, `--lint-only`, or halted). */
  trailingFmt: FmtPhaseOutcome | null;
}

/**
 * Pick the one-line summary emitted after the run finishes.
 *
 * Outcomes default to a binary verdict plus whether fixes may have been applied.
 * Failure attribution is left to the tool output rendered earlier in the run.
 *
 * Three cases override the default with dedicated wording:
 *
 * - Halted runs: lint and trailing fmt were skipped, so the summary points the user back at the
 *   format errors above.
 * - Non-check `--format-only` failures: the only failure mode is a parse error in the leading pass,
 *   with no fixes attempted. The generic "unfixed issues remain" wording would misrepresent the
 *   failure as a lint issue.
 * - Successful runs that matched no files: "Issues fixed where possible." would imply work happened
 *   on a phase with nothing to check.
 */
export function buildSummary({
  mode,
  check,
  halted,
  leadingFmt,
  lint,
  trailingFmt,
}: BuildSummaryOptions): string {
  if (halted) {
    return "Halted. Resolve format errors above and re-run.";
  }
  const fmtOk =
    (leadingFmt === null || leadingFmt.kind === "ok") &&
    (trailingFmt === null || trailingFmt.kind === "ok");
  const lintOk = lint === null || lint.kind === "ok" || lint.kind === "no-files";
  const ok = fmtOk && lintOk;
  if (mode === "format-only" && !check && !ok) {
    return "Failed. Format errors remain.";
  }
  if (ok && lint?.kind === "no-files") {
    return "Completed successfully. No lintable files matched.";
  }
  if (check) {
    return ok
      ? "Completed successfully. No issues found."
      : "Failed. Issues found; fixes required.";
  }
  return ok
    ? "Completed successfully. Issues fixed where possible."
    : "Failed. Issues fixed where possible; unfixed issues remain.";
}
