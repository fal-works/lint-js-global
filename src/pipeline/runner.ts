import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { LintJsError } from "../error.ts";
import type { LintOutputMode } from "../lint-diagnostics/index.ts";
import type { Logger } from "../log.ts";
import { getSystemIgnorePatterns } from "../system/ignore.ts";
import { type FmtPhaseOutcome, runFmtPhase } from "./fmt.ts";
import { type LintPhaseOutcome, runLintPhase } from "./lint.ts";
import { buildSummary } from "./summary.ts";

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
 * Exit codes follow the wrapper-wide convention (see `src/cli/index.ts`):
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
