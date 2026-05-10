import {
  type ValidatedFileDiagnostic,
  type ValidatedFindings,
  type ValidatedProjectDiagnostic,
  validateNumberOfFiles,
  validatePayload,
} from "./schema.ts";

/**
 * Structural classification of a single oxlint invocation, derived from `capturedStdout` alone.
 *
 * Discriminated by `kind`:
 *
 * - `no-files`: oxlint had no files to lint.
 * - `contract-failure`: stdout breached the wrapper's output contract (unparseable JSON or schema
 *   mismatch).
 * - `clean`: oxlint processed files and emitted no diagnostics.
 * - `findings`: at least one diagnostic survived schema validation. Invariant: `file.length +
 *   project.length > 0`.
 */
export type LintRunState =
  | { kind: "no-files" }
  | { kind: "contract-failure"; reason: string; rawStdout: string }
  | { kind: "clean" }
  | ({ kind: "findings" } & ValidatedFindings);

/**
 * Slice off any free-form advisory prelude oxlint may print before the JSON payload (e.g. the
 * "No files found to lint." banner that prefixes a no-files run). The payload always begins
 * with `{` at column 0; nested `{` in pretty-printed output are indented.
 *
 * Returns the empty string if no JSON payload is present.
 */
function extractJsonPayload(stdout: string): string {
  if (stdout.startsWith("{")) return stdout;
  const idx = stdout.indexOf("\n{");
  return idx === -1 ? "" : stdout.slice(idx + 1);
}

/**
 * Classify the raw oxlint stdout into a {@link LintRunState}.
 */
export function classifyLintRun(capturedStdout: string): LintRunState {
  const jsonText = extractJsonPayload(capturedStdout);
  if (jsonText === "") {
    // oxlint normally always emits a JSON payload; an empty stdout is a benign edge case
    // (no payload at all) and should not be escalated to a contract failure.
    if (capturedStdout === "") return { kind: "clean" };
    // Free-form text without any JSON payload signals a tool failure (e.g. tsgolint resolution
    // failure, missing config). Route it through contract-failure so the wrapper boundary
    // surfaces it as LintJsError + exit 2.
    return {
      kind: "contract-failure",
      reason: "stdout has no JSON payload",
      rawStdout: capturedStdout,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
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
  if (validated.length === 0) {
    const filesValidation = validateNumberOfFiles(parsed);
    if (!filesValidation.ok) {
      return {
        kind: "contract-failure",
        reason: filesValidation.reason,
        rawStdout: capturedStdout,
      };
    }
    return filesValidation.value === 0 ? { kind: "no-files" } : { kind: "clean" };
  }

  const file: ValidatedFileDiagnostic[] = [];
  const project: ValidatedProjectDiagnostic[] = [];
  for (const v of validated) {
    if (v.kind === "file") file.push(v);
    else project.push(v);
  }
  return { kind: "findings", file, project };
}
