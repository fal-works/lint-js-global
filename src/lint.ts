import { formatLintOutput } from "./format-diagnostics.ts";
import { LintJsError, type Logger } from "./log.ts";
import { resolvePackageBin } from "./package-info.ts";
import { NODE_MODULES_BIN, OXLINT_CONFIG, WEAK_TYPINGS_DOC } from "./package-paths.ts";
import { buildPathInjectedEnv, runToolCapturingOutput } from "./run-tool.ts";

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

export interface LintPhaseOptions {
  check: boolean;
  unix: boolean;
  targets: readonly string[];
  ignorePatterns: readonly string[];
}

export interface LintPhaseContext {
  cwd: string;
  logger: Logger;
}

/**
 * Outcome of a single oxlint invocation.
 *
 * - `ok`: oxlint exited 0, or returned the no-files-matched signal that collapses to clean.
 * - `findings`: oxlint reported diagnostics that remain after `--fix` (or in `--check` mode).
 */
export type LintPhaseOutcome = { kind: "ok" } | { kind: "findings" };

/**
 * Run the lint phase: spawn oxlint, parse its JSON stdout via {@link formatLintOutput},
 * and emit diagnostics plus linter summary through `ctx.logger`.
 *
 * @throws {LintJsError} on launch failure, signal-driven termination,
 *   or oxlint output-contract mismatch.
 */
export function runLintPhase(opts: LintPhaseOptions, ctx: LintPhaseContext): LintPhaseOutcome {
  const { check, unix, targets, ignorePatterns } = opts;
  const { cwd, logger } = ctx;

  const oxlintBin = resolvePackageBin("oxlint", "oxlint");

  const { result, capturedStdout, capturedStderr } = runToolCapturingOutput({
    name: "oxlint",
    bin: oxlintBin,
    args: buildOxlintArgs(OXLINT_CONFIG, ignorePatterns, targets, check, unix),
    cwd,
    env: buildPathInjectedEnv(NODE_MODULES_BIN),
  });

  logger.writeErr(capturedStderr);

  const { formattedStdout, linterSummary, schemaMismatch, noFilesMatched } = formatLintOutput({
    capturedStdout,
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
  const cleanish = result.status === 0 || noFilesMatched;
  if (linterSummary !== null) {
    logger.markBlankSeparator();
    logger.writeErr(`${linterSummary}\n`);
  }
  return cleanish ? { kind: "ok" } : { kind: "findings" };
}
