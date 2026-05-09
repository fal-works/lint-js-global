import {
  validatePayload,
  type ValidatedFileDiagnostic,
  type ValidatedProjectDiagnostic,
} from "./schema.ts";

/** Matches the signal oxlint ≥1.61 prepends to stdout when no files match the targets. */
const OXLINT_NO_FILES_RE = /^No files found to lint\./;

/**
 * Structural classification of a single oxlint invocation, derived from `capturedStdout` alone.
 *
 * Discriminated by `kind`:
 * - `no-files`: oxlint signaled that no files matched any target.
 * - `contract-failure`: stdout breached the wrapper's output contract
 * (unparseable JSON or schema mismatch).
 * - `clean`: stdout was either empty or carried an empty `diagnostics` array.
 * - `findings`: at least one diagnostic survived schema validation.
 * Invariant: `file.length + project.length > 0`.
 */
export type LintRunState =
  | { kind: "no-files" }
  | { kind: "contract-failure"; reason: string; rawStdout: string }
  | { kind: "clean" }
  | {
      kind: "findings";
      file: readonly ValidatedFileDiagnostic[];
      project: readonly ValidatedProjectDiagnostic[];
    };

/**
 * Classify the raw oxlint stdout into a {@link LintRunState}.
 *
 * Pure: reads no source files, emits no output.
 */
export function classifyLintRun(capturedStdout: string): LintRunState {
  if (OXLINT_NO_FILES_RE.test(capturedStdout)) return { kind: "no-files" };

  // oxlint normally always emits a JSON payload; an empty stdout is a benign edge case
  // (no payload at all) and should not be escalated to a contract failure.
  if (capturedStdout === "") return { kind: "clean" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(capturedStdout);
  } catch (err) {
    // Unparseable stdout signals a tool failure (e.g. tsgolint resolution failure, missing config),
    // not a lint diagnostic.
    // Route it through contract-failure so the wrapper boundary surfaces it as LintJsError + exit 2.
    const message = err instanceof Error ? err.message : String(err);
    return {
      kind: "contract-failure",
      reason: `stdout is not valid JSON: ${message}`,
      rawStdout: capturedStdout,
    };
  }

  const validation = validatePayload(parsed);
  if (!validation.ok) {
    return { kind: "contract-failure", reason: validation.reason, rawStdout: capturedStdout };
  }

  const validated = validation.value;
  if (validated.length === 0) return { kind: "clean" };

  const file: ValidatedFileDiagnostic[] = [];
  const project: ValidatedProjectDiagnostic[] = [];
  for (const v of validated) {
    if (v.kind === "file") file.push(v);
    else project.push(v);
  }
  return { kind: "findings", file, project };
}
