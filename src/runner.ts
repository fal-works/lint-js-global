import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { buildOxfmtArgs } from "./fmt.ts";
import { formatLintOutput } from "./format-diagnostics.ts";
import { getSystemIgnorePatterns } from "./ignore.ts";
import { buildOxlintArgs } from "./lint.ts";
import { LintJsError, type Logger } from "./log.ts";
import { resolvePackageBin } from "./package-info.ts";
import {
  NODE_MODULES_BIN,
  OXFMT_CONFIG,
  OXLINT_CONFIG,
  WEAK_TYPINGS_DOC,
} from "./package-paths.ts";
import {
  buildPathInjectedEnv,
  runToolCapturingCombined,
  runToolCapturingOutput,
} from "./run-tool.ts";

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

  const ignorePatterns = getSystemIgnorePatterns(cwd);

  for (const target of targets) {
    if (!existsSync(resolve(cwd, target))) {
      throw new LintJsError(`target not found: ${target}`);
    }
  }

  const runFmt = !lintOnly;
  const runLint = !formatOnly;

  let fmtStatus: number | null = null;
  if (runFmt) {
    const oxfmtBin = resolvePackageBin("oxfmt", "oxfmt");
    const fmtLabel = check ? "formatting (check-only)" : "formatting";
    logger.writeErr(`${fmtLabel}...\n`);
    // Combined capture: oxfmt's output is auxiliary text routed to stderr as a single block,
    // so capturing the streams together preserves the child's natural emission order.
    const { result: fmtResult, captured: fmtOutput } = runToolCapturingCombined({
      name: "oxfmt",
      bin: oxfmtBin,
      args: buildOxfmtArgs(OXFMT_CONFIG, ignorePatterns, targets, check),
      cwd,
    });
    logger.writeErr(fmtOutput);
    // No fmt completion banner: oxfmt prints its own summary and ours would duplicate.
    fmtStatus = fmtResult.status;
  }

  if (runFmt && runLint) logger.writeErr("\n");

  let lintStatus: number | null = null;
  if (runLint) {
    const oxlintBin = resolvePackageBin("oxlint", "oxlint");
    const lintLabel = check ? "linting (no auto-fix)" : "linting (with auto-fix)";
    logger.writeErr(`${lintLabel}...\n`);
    const {
      result: lintResult,
      capturedStdout: lintStdout,
      capturedStderr: lintStderr,
    } = runToolCapturingOutput({
      name: "oxlint",
      bin: oxlintBin,
      args: buildOxlintArgs(OXLINT_CONFIG, ignorePatterns, targets, check, unix),
      cwd,
      env: buildPathInjectedEnv(NODE_MODULES_BIN),
    });
    logger.writeErr(lintStderr);
    const { formattedStdout, linterSummary, schemaMismatch, noFilesMatched } = formatLintOutput({
      capturedStdout: lintStdout,
      check,
      unix,
      weakTypingsDocPath: WEAK_TYPINGS_DOC,
      cwd,
    });
    if (noFilesMatched) {
      // oxlint ≥1.61 emits "No files found to lint." on stdout when no files match;
      // rewrite it to stderr so stdout stays clean for downstream consumers.
      logger.writeErr("No files found to lint.\n");
    } else {
      logger.writeOut(formattedStdout);
    }
    if (schemaMismatch !== null) {
      // Raw stdout was relayed above; route the contract failure through LintJsError.
      throw new LintJsError("oxlint output contract mismatch.", {
        details: [schemaMismatch.reason, "Raw payload relayed to stdout above."],
      });
    }
    // oxlint ≥1.61 exits non-zero when no files match the targets; treat that as clean.
    const lintCleanish = lintResult.status === 0 || noFilesMatched;
    if (lintCleanish) logger.writeErr(`${lintLabel}: clean.\n`);
    if (linterSummary !== null) {
      logger.writeErr(`\n${linterSummary}\n`);
    }
    lintStatus = lintCleanish ? 0 : lintResult.status;
  }

  logger.writeErr("\n");
  logger.writeErrTagged(buildSummary({ check, fmtStatus, lintStatus }));

  // Collapse any non-zero child status to 1; exit 2 is reserved for LintJsError.
  const fmtFailed = fmtStatus !== null && fmtStatus !== 0;
  const lintFailed = lintStatus !== null && lintStatus !== 0;
  return fmtFailed || lintFailed ? 1 : 0;
}
