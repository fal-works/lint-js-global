import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { runFmtPhase } from "./fmt.ts";
import { getSystemIgnorePatterns } from "./ignore.ts";
import { runLintPhase } from "./lint.ts";
import { LintJsError, type Logger } from "./log.ts";

/** Run-mode arguments. */
export interface RunArgs {
  check: boolean;
  unix: boolean;
  formatOnly: boolean;
  lintOnly: boolean;
  targets: readonly string[];
}

/**
 * Ambient context for {@link run}.
 * `cwd` is the working directory used for filesystem checks and child-process spawning.
 */
export interface RunContext {
  cwd: string;
  logger: Logger;
}

interface BuildSummaryOptions {
  check: boolean;

  /**
   * `null` if the format phase was skipped (`--lint-only`);
   * skipped phases do not contribute to the verdict.
   */
  fmtStatus: number | null;

  /**
   * `null` if the lint phase was skipped (`--format-only`);
   * skipped phases do not contribute to the verdict.
   */
  lintStatus: number | null;
}

/**
 * Pick the one-line summary emitted after the run finishes.
 *
 * Binary verdict only (success/failure).
 * Which phase failed is readable from the tool output above,
 * so the summary only needs to convey overall outcome
 * and whether fixes may have been applied.
 */
function buildSummary({ check, fmtStatus, lintStatus }: BuildSummaryOptions): string {
  const fmtOk = fmtStatus === null || fmtStatus === 0;
  const lintOk = lintStatus === null || lintStatus === 0;
  const ok = fmtOk && lintOk;
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
 * Exit codes follow the wrapper-wide convention (see `src/cli.ts`):
 * 0 success, 1 fmt/lint findings remain, 2 reserved for {@link LintJsError}.
 *
 * May throw {@link LintJsError}; the CLI boundary catches it and maps to exit 2.
 */
export function run(args: RunArgs, ctx: RunContext): number {
  const { check, unix, formatOnly, lintOnly, targets } = args;
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

  let fmtStatus: number | null = null;
  let lintStatus: number | null = null;

  if (!lintOnly) {
    const r = runFmtPhase({ check, targets, ignorePatterns }, phaseCtx);
    fmtStatus = r.status;
  }

  if (!formatOnly) {
    logger.markBlankSeparator();
    const r = runLintPhase({ check, unix, targets, ignorePatterns }, phaseCtx);
    lintStatus = r.status;
  }

  logger.markBlankSeparator();
  logger.writeErrTagged(buildSummary({ check, fmtStatus, lintStatus }));

  // Collapse any non-zero child status to 1; exit 2 is reserved for LintJsError.
  const fmtFailed = fmtStatus !== null && fmtStatus !== 0;
  const lintFailed = lintStatus !== null && lintStatus !== 0;
  return fmtFailed || lintFailed ? 1 : 0;
}
