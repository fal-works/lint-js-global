import { createSourceCache } from "../../system/source-cache.ts";
import type { LintOutcome } from "../model/outcome.ts";
import { classifyLintRun } from "./classify.ts";
import { resolveAll } from "./resolve.ts";

/**
 * Top-level input-side function: classify the raw oxlint stdout, resolve any spans against the
 * source cache rooted at `cwd`, and return a {@link LintOutcome} ready for the output side.
 */
export function interpretOxlintOutput(capturedStdout: string, cwd: string): LintOutcome {
  const state = classifyLintRun(capturedStdout);
  switch (state.kind) {
    case "no-files":
    case "clean":
    case "contract-failure":
      return state;
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
      return {
        kind: "findings",
        findings: { file: resolved.file, project: resolved.project },
      };
    }
  }
}
