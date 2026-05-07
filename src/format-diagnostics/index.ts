import { validatePayload } from "../oxlint-json-schema.ts";
import { createSourceCache } from "../source.ts";
import { formatSummary, renderDiagnostics } from "./render.ts";
import { resolveDiagnostic } from "./resolve.ts";

/**
 * LLM-friendly formatter for oxlint's `--format=json` output.
 */

/** Matches the signal oxlint ≥1.61 prepends to stdout when no files match the targets. */
const OXLINT_NO_FILES_RE = /^No files found to lint\./;

/**
 * Result of {@link formatLintOutput}.
 *
 * The three payload fields (`formattedDiagnostics`, `weakTypingsHint`, `linterSummary`)
 * are independent; the caller chooses a destination for each.
 */
export interface FormatLintResult {
  /**
   * Per-file diagnostic sections, joined into a single string with a trailing newline.
   * Empty when there are no diagnostics to report.
   */
  formattedDiagnostics: string;

  /**
   * Weak-typings hint block, non-null when any `no-unsafe-*` diagnostic is present.
   * Ends with a trailing newline.
   */
  weakTypingsHint: string | null;

  /**
   * Human-readable summary line stating how many issues remain.
   * In `--check` mode the "unfixed" qualifier is omitted.
   *
   * Null when there is nothing to summarize (no diagnostics, unix passthrough,
   * or `schemaMismatch` is non-null).
   */
  linterSummary: string | null;

  /**
   * Non-null when the captured stdout fails the wrapper's output contract:
   * either non-empty stdout that does not parse as JSON, or
   * JSON whose shape diverges from the expected diagnostic schema.
   *
   * `reason` names the offending field or parser failure.
   */
  schemaMismatch: { reason: string } | null;

  /**
   * True when oxlint signaled that no files matched any target
   * (the targets contained no lintable files, or every match was filtered out by ignore patterns).
   * oxlint ≥1.61 prepends a human-readable line to stdout and exits non-zero in that case.
   */
  noFilesMatched: boolean;
}

export interface FormatLintOptions {
  /** Raw oxlint stdout from `--format=json`. */
  capturedStdout: string;

  /** Whether the run is `--check` (no auto-fix attempted). */
  check: boolean;

  /** If true, pass through unchanged (no hint, no summary). */
  unix: boolean;

  /** Absolute path used in the weak-typings hint. */
  weakTypingsDocPath: string;

  /**
   * Working directory against which oxlint's relative `filename` fields are resolved
   * when reading the source for span-slice extraction. Defaults to `process.cwd()`.
   */
  cwd?: string;
}

/**
 * Format raw oxlint JSON stdout into the LLM-friendly payload.
 *
 * No stdout/stderr emission.
 * May read source files to resolve span positions.
 */
export function formatLintOutput({
  capturedStdout,
  check,
  unix,
  weakTypingsDocPath,
  cwd,
}: FormatLintOptions): FormatLintResult {
  // Detected before mode branching: the prefix appears in --format=unix output too,
  // so unix mode also needs the exit-normalization signal.
  const noFilesMatched = OXLINT_NO_FILES_RE.test(capturedStdout);

  if (unix) {
    return {
      formattedDiagnostics: capturedStdout,
      weakTypingsHint: null,
      linterSummary: null,
      schemaMismatch: null,
      noFilesMatched,
    };
  }

  // Empty stdout is treated as clean-compatible: oxlint emitted no payload at all,
  // which is benign and should not be escalated to a contract failure.
  if (capturedStdout === "") {
    return {
      formattedDiagnostics: "",
      weakTypingsHint: null,
      linterSummary: null,
      schemaMismatch: null,
      noFilesMatched: false,
    };
  }

  // The prefix breaks JSON parsing; short-circuit to a clean result.
  if (noFilesMatched) {
    return {
      formattedDiagnostics: "",
      weakTypingsHint: null,
      linterSummary: null,
      schemaMismatch: null,
      noFilesMatched: true,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(capturedStdout);
  } catch (err) {
    // Non-empty unparseable stdout is an output-contract failure (e.g. caret-range
    // oxlint update silently changed the format). Surface it via the same path as
    // schema drift so the wrapper exits 2 instead of misreporting the run as clean.
    const message = err instanceof Error ? err.message : String(err);
    return {
      formattedDiagnostics: capturedStdout,
      weakTypingsHint: null,
      linterSummary: null,
      schemaMismatch: { reason: `stdout is not valid JSON: ${message}` },
      noFilesMatched: false,
    };
  }

  const validation = validatePayload(parsed);
  if (!validation.ok) {
    return {
      formattedDiagnostics: capturedStdout,
      weakTypingsHint: null,
      linterSummary: null,
      schemaMismatch: { reason: validation.reason },
      noFilesMatched: false,
    };
  }
  const validated = validation.value;
  if (validated.length === 0) {
    return {
      formattedDiagnostics: "",
      weakTypingsHint: null,
      linterSummary: null,
      schemaMismatch: null,
      noFilesMatched: false,
    };
  }

  const cache = createSourceCache(cwd ?? process.cwd());
  const resolved = validated.map((d) => resolveDiagnostic(d, cache));
  const { formattedDiagnostics, weakTypingsHint, fileCount } = renderDiagnostics(
    resolved,
    weakTypingsDocPath,
  );
  const linterSummary = formatSummary(check, resolved.length, fileCount);
  return {
    formattedDiagnostics,
    weakTypingsHint,
    linterSummary,
    schemaMismatch: null,
    noFilesMatched: false,
  };
}
