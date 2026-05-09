import { LintJsError } from "../error.ts";
import { classifyLintRun } from "../lint-diagnostics/classify.ts";
import { type LintOutputMode, renderLintFindings } from "../lint-diagnostics/render.ts";
import { resolveAll } from "../lint-diagnostics/resolve.ts";
import type { Logger } from "../log.ts";
import { resolvePackageBin } from "../package/info.ts";
import { OXLINT_CONFIG, WEAK_TYPINGS_DOC } from "../package/paths.ts";
import { createTsgolintShimDir } from "../package/tsgolint-shim.ts";
import { createSourceCache } from "../source.ts";
import { buildPathInjectedEnv, runToolCapturingOutput } from "../system/subprocess.ts";

/**
 * Build CLI args for oxlint. Always invokes `--format=json`;
 * the per-diagnostic stdout layout is selected downstream in {@link renderLintFindings}.
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
 * Spawn oxlint and emit diagnostics plus auxiliary text through `ctx.logger`.
 *
 * Per-file diagnostics route to stdout in the layout selected by `outputMode`.
 * Location-less diagnostics, the weak-typings hint (when applicable), and the issue-count
 * summary all route to stderr so stdout stays a uniform per-line stream.
 *
 * @throws {LintJsError} on launch failure, signal-driven termination,
 *   or oxlint output-contract mismatch.
 */
export async function runLintPhase(
  opts: LintPhaseOptions,
  ctx: LintPhaseContext,
): Promise<LintPhaseOutcome> {
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
    ({ result, capturedStdout, capturedStderr } = await runToolCapturingOutput({
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

  const state = classifyLintRun(capturedStdout);
  switch (state.kind) {
    case "no-files":
      // Rewrite to stderr so stdout stays clean for downstream consumers.
      logger.writeErr("No files found to lint.\n");
      return { kind: "no-files" };

    case "contract-failure":
      // Route the raw payload through LintJsError.details so stdout stays reserved for diagnostics
      // and stderr stays reserved for wrapper notifications.
      throw new LintJsError("oxlint output contract mismatch.", {
        details: [state.reason, "--- raw stdout ---", ...state.rawStdout.trimEnd().split("\n")],
      });

    case "clean":
      // A non-zero exit on a clean payload means oxlint failed as a tool, not as a linter.
      // Surface it through LintJsError so the run is not reported as a successful lint.
      if (result.status !== 0) {
        throw new LintJsError("oxlint exited non-zero without producing diagnostics.", {
          details: [
            `exit status: ${result.status ?? "(none)"}`,
            "stderr above (if any) is the only signal from the tool.",
          ],
        });
      }
      return { kind: "ok" };

    case "findings": {
      const cache = createSourceCache(cwd);
      const resolved = resolveAll(state, cache);
      if (resolved.kind === "contract-failure") {
        // Raw payload aids investigation. Same shape as the classify-stage path.
        throw new LintJsError("oxlint output contract mismatch.", {
          details: [resolved.reason, "--- raw stdout ---", ...capturedStdout.trimEnd().split("\n")],
        });
      }
      const rendered = renderLintFindings(resolved, {
        outputMode,
        check,
        weakTypingsDocPath: WEAK_TYPINGS_DOC,
      });
      if (rendered.projectBlock !== "") {
        logger.markBlankSeparator();
        logger.writeErr(rendered.projectBlock);
      }
      logger.writeOut(rendered.fileBlock);
      if (rendered.weakTypingsHint !== "") {
        logger.markBlankSeparator();
        logger.writeErr(rendered.weakTypingsHint);
      }
      logger.markBlankSeparator();
      logger.writeErr(`${rendered.summaryLine}\n`);
      return { kind: "findings" };
    }
  }
}
