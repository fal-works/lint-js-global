/**
 * Per-file lint finding pinned to a source span.
 *
 * Source-locatability discriminates `FileFinding` from {@link ProjectFinding}: a project-level
 * entry without a source location lives in the latter.
 */
export interface FileFinding {
  filename: string;

  /**
   * Diagnostic code as emitted by the upstream linter; treated as an opaque string by this tool.
   *
   * `null` carries the parse-error signal (oxc parser-error diagnostics omit `code`); the
   * rendering side substitutes a placeholder when displaying.
   */
  code: string | null;

  message: string;

  /** 1-origin line number of the span start. */
  startLine: number;

  /** 1-origin column of the span start, in UTF-16 code units. */
  startCol: number;

  /** 1-origin line number of the span end (inclusive). */
  endLine: number;

  /** 1-origin column of the span end (inclusive), in UTF-16 code units. */
  endCol: number;

  /** Decoded source text covered by the span; rendered shape is the renderer's concern. */
  spanText: string;
}

/**
 * Project-level lint finding without a source span (e.g. tsconfig-level errors).
 */
export interface ProjectFinding {
  /** May be the empty string when no path can be attributed. */
  filename: string;

  /** Same opaque-string treatment as {@link FileFinding.code}; `null` is the parse-error signal. */
  code: string | null;

  message: string;
}

/**
 * Findings of one lint run, partitioned by source-locatability.
 */
export interface Findings {
  file: readonly FileFinding[];
  project: readonly ProjectFinding[];
}
