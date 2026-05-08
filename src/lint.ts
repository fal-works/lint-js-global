import { LintJsError } from "./error.ts";
import { formatLintOutput, type LintOutputMode } from "./format-diagnostics/index.ts";
import type { Logger } from "./log.ts";
import { resolvePackageBin } from "./package-info.ts";
import { OXLINT_CONFIG, WEAK_TYPINGS_DOC } from "./package-paths.ts";
import { buildPathInjectedEnv, runToolCapturingOutput } from "./run-tool.ts";
import { createTsgolintShimDir } from "./tsgolint-shim.ts";

/**
 * Build CLI args for oxlint. Always invokes `--format=json`;
 * the per-diagnostic stdout layout is selected downstream in {@link formatLintOutput}.
 *
 * @param config - Path to the oxlint config file.
 * @param ignorePatterns - Gitignore-style patterns.
 * @param targets - Positional paths to process.
 * @param check - Report only; do not apply auto-fix.
 */
export function buildOxlintArgs(
  config: string,
  ignorePatterns: readonly string[],
  targets: readonly string[],
  check: boolean,
): string[] {
  const ignoreFlags = ignorePatterns.flatMap((pattern) => ["--ignore-pattern", pattern]);
  return [
    "-c",
    config,
    "--format=json",
    ...(check ? [] : ["--fix"]),
    "--type-aware",
    "--type-check",
    ...ignoreFlags,
    ...targets,
  ];
}

export interface LintPhaseOptions {
  check: boolean;
  outputMode: LintOutputMode;
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
 * - `ok`: oxlint exited 0 against a non-empty file set.
 * - `no-files`: no files matched the targets (oxlint ≥1.61's no-files signal). Exit-clean, but
 *   distinct from `ok` so callers can adjust trailing-fmt and summary behavior.
 * - `findings`: oxlint reported diagnostics that remain after `--fix` (or in `--check` mode).
 */
export type LintPhaseOutcome = { kind: "ok" } | { kind: "no-files" } | { kind: "findings" };

/**
 * Run the lint phase: spawn oxlint, validate the payload through {@link formatLintOutput},
 * and emit diagnostics plus auxiliary text through `ctx.logger`.
 *
 * Diagnostics route to stdout in the layout selected by `outputMode`;
 * the weak-typings hint (when applicable) and the issue-count summary always route to stderr.
 *
 * @throws {LintJsError} on launch failure, signal-driven termination,
 *   or oxlint output-contract mismatch.
 */
export function runLintPhase(opts: LintPhaseOptions, ctx: LintPhaseContext): LintPhaseOutcome {
  const { check, outputMode, targets, ignorePatterns } = opts;
  const { cwd, logger } = ctx;

  const oxlintBin = resolvePackageBin("oxlint", "oxlint");

  // oxlint's native side resolves `tsgolint` via `PATH`.
  // The shim binds that resolution to the bundled `oxlint-tsgolint`.
  const shim = createTsgolintShimDir();
  let result;
  let capturedStdout;
  let capturedStderr;
  try {
    const env = buildPathInjectedEnv(shim.dir);
    ({ result, capturedStdout, capturedStderr } = runToolCapturingOutput({
      name: "oxlint",
      bin: oxlintBin,
      args: buildOxlintArgs(OXLINT_CONFIG, ignorePatterns, targets, check),
      cwd,
      env,
    }));
  } finally {
    shim.cleanup();
  }

  logger.writeErr(capturedStderr);

  const formatted = formatLintOutput({
    capturedStdout,
    check,
    outputMode,
    weakTypingsDocPath: WEAK_TYPINGS_DOC,
    cwd,
  });

  switch (formatted.kind) {
    case "no-files":
      // Rewrite to stderr so stdout stays clean for downstream consumers.
      logger.writeErr("No files found to lint.\n");
      return { kind: "no-files" };

    case "contract-failure":
      // Route the raw payload through LintJsError.details so stdout stays reserved for diagnostics
      // and stderr stays reserved for wrapper notifications.
      throw new LintJsError("oxlint output contract mismatch.", {
        details: [
          formatted.reason,
          "--- raw stdout ---",
          ...formatted.rawStdout.trimEnd().split("\n"),
        ],
      });

    case "diagnostics": {
      const { formattedDiagnostics, weakTypingsHint, linterSummary } = formatted;
      // Non-zero exit with no validated diagnostics (empty stdout, or `{"diagnostics":[]}`)
      // means oxlint signaled failure without producing findings.
      // Surface it as a tool failure so the run does not display the misleading "unfixed issues remain" summary.
      if (linterSummary === null && result.status !== 0) {
        throw new LintJsError("oxlint exited non-zero without producing diagnostics.", {
          details: [
            `exit status: ${result.status ?? "(none)"}`,
            "stderr above (if any) is the only signal from the tool.",
          ],
        });
      }
      logger.writeOut(formattedDiagnostics);
      if (weakTypingsHint !== null) {
        logger.markBlankSeparator();
        logger.writeErr(weakTypingsHint);
      }
      if (linterSummary !== null) {
        logger.markBlankSeparator();
        logger.writeErr(`${linterSummary}\n`);
      }
      return result.status === 0 ? { kind: "ok" } : { kind: "findings" };
    }
  }
}
