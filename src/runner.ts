import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { LintJsError } from "./error.ts";
import { type FmtPhaseOutcome, runFmtPhase } from "./fmt.ts";
import type { LintOutputMode } from "./format-diagnostics/index.ts";
import { getSystemIgnorePatterns } from "./ignore.ts";
import { type LintPhaseOutcome, runLintPhase } from "./lint.ts";
import type { Logger } from "./log.ts";

/**
 * Which phases run.
 *
 * - `"full"` runs the full pipeline (`oxfmt` → `oxlint` → `oxfmt`).
 * - `"format-only"` and `"lint-only"` collapse to a single phase as named.
 */
export type RunMode = "full" | "format-only" | "lint-only";

/** Run-mode arguments. */
export interface RunArgs {
  mode: RunMode;
  check: boolean;
  outputMode: LintOutputMode;
  targets: readonly string[];
}

/** Ambient context for {@link run}. */
export interface RunContext {
  /** Working directory used for filesystem checks and child-process spawning. */
  cwd: string;

  logger: Logger;
}

interface BuildSummaryOptions {
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
 * Halted runs and non-check `--format-only` failures get dedicated summaries; the latter has
 * no lint phase and applies no fixes when it fails (the only failure mode is a parse error
 * in the leading pass), so the generic "fixed where possible; unfixed issues remain" wording
 * would misrepresent a fmt-only failure as a lint issue.
 * Successful runs where lint matched no files get their own wording too, since "Issues
 * fixed where possible." would imply work happened on a phase that found nothing to check.
 * Otherwise the verdict is binary; which phase failed is readable from tool output above,
 * so the summary only conveys overall outcome and whether fixes may have been applied.
 */
function buildSummary({
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

/**
 * Execute the format and lint phases against `args.targets` under `ctx.cwd`,
 * writing user-facing output through `ctx.logger`. Returns the process exit code.
 *
 * The full pipeline (no run-mode flag) runs `oxfmt` → `oxlint` → `oxfmt` (ADR-0005).
 * A fatal failure in the leading fmt pass halts the run, skipping lint and the trailing pass.
 * The trailing pass is also skipped when lint findings remain, so reported `L:C` positions
 * match the file the consumer opens next.
 *
 * `--check` runs only the leading fmt pass before lint.
 * `--format-only` and `--lint-only` collapse to a single phase as named.
 *
 * Exit codes follow the wrapper-wide convention (see `src/cli.ts`):
 * 0 success, 1 fmt/lint findings remain or run halted, 2 reserved for {@link LintJsError}.
 *
 * May throw {@link LintJsError}; the CLI boundary catches it and maps to exit 2.
 */
export function run(args: RunArgs, ctx: RunContext): number {
  const { mode, check, outputMode, targets } = args;
  const { cwd, logger } = ctx;

  if (!existsSync(resolve(cwd, "package.json"))) {
    throw new LintJsError("no package.json in current directory.", {
      details: [
        "Run lint-js from the root of a JS/TS project.",
        "(Required as a guard against accidental runs)",
      ],
    });
  }

  for (const target of targets) {
    if (!existsSync(resolve(cwd, target))) {
      throw new LintJsError(`target not found: ${target}`);
    }
  }

  const ignorePatterns = getSystemIgnorePatterns(cwd);
  const phaseCtx = { cwd, logger };

  let leadingFmt: FmtPhaseOutcome | null = null;
  let lint: LintPhaseOutcome | null = null;
  let trailingFmt: FmtPhaseOutcome | null = null;

  if (mode !== "lint-only") {
    leadingFmt = runFmtPhase({ check, targets, ignorePatterns }, phaseCtx);
  }

  // Halt only when there is something downstream to skip; in `--format-only` the leading
  // pass is the entire run, so a fatal exit there falls through as a regular failure.
  const halted = leadingFmt?.kind === "fatal" && mode !== "format-only";

  if (mode !== "format-only" && !halted) {
    logger.markBlankSeparator();
    lint = runLintPhase({ check, outputMode, targets, ignorePatterns }, phaseCtx);
  }

  // Trailing pass normalizes drift introduced by `oxlint --fix`. Runs only on the full
  // pipeline (no run-mode flag) when lint succeeded with a non-empty file set.
  // Skipped when lint findings remain, so reported `L:C` positions match the file the consumer opens next.
  // Skipped when lint matched no files (no drift).
  // Skipped under `--check` (lint applies no fixes).
  if (mode === "full" && !check && !halted && lint?.kind === "ok") {
    logger.markBlankSeparator();
    trailingFmt = runFmtPhase({ check: false, targets, ignorePatterns }, phaseCtx);
  }

  logger.markBlankSeparator();
  logger.writeErrTagged(buildSummary({ mode, check, halted, leadingFmt, lint, trailingFmt }));

  // Collapse any failing outcome to exit 1; exit 2 is reserved for LintJsError.
  const fmtFailed =
    (leadingFmt !== null && leadingFmt.kind !== "ok") ||
    (trailingFmt !== null && trailingFmt.kind !== "ok");
  const lintFailed = lint?.kind === "findings";
  return fmtFailed || lintFailed ? 1 : 0;
}
