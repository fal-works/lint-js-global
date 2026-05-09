import { createSourceCache } from "../system/source-cache.ts";
import { classifyLintRun } from "./classify.ts";
import {
  type LintOutputMode,
  type RenderedLintOutput,
  renderLintFindings,
} from "./render/compose.ts";
import { resolveAll } from "./resolve.ts";

export type { LintOutputMode, RenderedLintOutput };

export interface ProcessLintRunOptions {
  outputMode: LintOutputMode;

  /** Whether the run is `--check` (no auto-fix attempted); drops the "unfixed" qualifier. */
  check: boolean;

  /** Absolute path included in the weak-typings hint. */
  weakTypingsDocPath: string;
}

/**
 * Outcome of one full diagnostics pipeline run.
 *
 * Discriminated by `kind`:
 * - `no-files`: oxlint matched no files against the targets.
 * - `clean`: no diagnostics survived; the run is lint-clean.
 * - `contract-failure`: a pipeline stage rejected the payload. `rawStdout` carries the original
 * payload so the caller can attach it to a wrapper-level error.
 * - `findings`: at least one diagnostic survived every stage; `rendered` carries the composed
 * output blocks ready to write to the logger.
 */
export type ProcessLintRunResult =
  | { kind: "no-files" }
  | { kind: "clean" }
  | { kind: "contract-failure"; reason: string; rawStdout: string }
  | { kind: "findings"; rendered: RenderedLintOutput };

/** Top-level pipeline: classify → resolve → render. */
export function processLintRun(
  capturedStdout: string,
  cwd: string,
  options: ProcessLintRunOptions,
): ProcessLintRunResult {
  const state = classifyLintRun(capturedStdout);
  switch (state.kind) {
    case "no-files":
      return { kind: "no-files" };
    case "clean":
      return { kind: "clean" };
    case "contract-failure":
      return { kind: "contract-failure", reason: state.reason, rawStdout: state.rawStdout };
    case "findings": {
      const cache = createSourceCache(cwd);
      const resolved = resolveAll(state, cache);
      if (resolved.kind === "contract-failure") {
        return {
          kind: "contract-failure",
          reason: resolved.reason,
          rawStdout: capturedStdout,
        };
      }
      const rendered = renderLintFindings(resolved, options);
      return { kind: "findings", rendered };
    }
  }
}
