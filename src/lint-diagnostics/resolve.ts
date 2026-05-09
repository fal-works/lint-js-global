import { type SourceCache, resolveSpan } from "../source.ts";
import type { ValidatedFileDiagnostic, ValidatedProjectDiagnostic } from "./schema.ts";

/**
 * Synthetic placeholder used in the `[...]` bracket when a diagnostic has no `code` (oxc parser
 * errors). Distinguishable from real codes, which always carry the `plugin(rule)` form.
 */
export const PARSE_ERROR_CODE = "parse-error";

/** Code-point cap for the rendered slice's first line before truncation kicks in. */
export const SLICE_MAX_LEN = 40;

/**
 * Render-ready unit produced from a {@link ValidatedDiagnostic} + source resolution.
 */
export interface ResolvedDiagnostic {
  filename: string;

  /**
   * Value to emit inside `[...]` in the formatted output.
   *
   * - For real diagnostics it is the raw `code` from oxlint, passed through unchanged (e.g.
   *   `eslint(no-debugger)`, `typescript(TS2591)`).
   * - For oxc parser errors (no `code`), it is the synthetic literal {@link PARSE_ERROR_CODE}.
   */
  errorCode: string;

  message: string;

  /** 1-origin line number of the span start. */
  startLine: number;

  /** 1-origin column of the span start, in UTF-16 code units. */
  startCol: number;

  /** 1-origin line number of the span end (inclusive). */
  endLine: number;

  /** 1-origin column of the span end (inclusive), in UTF-16 code units. */
  endCol: number;

  /**
   * Source text the rule points at,
   * truncated to one line of at most {@link SLICE_MAX_LEN} code points.
   */
  slice: string;

  /** True whenever truncation hides any portion of the original span. */
  sliceTruncated: boolean;
}

/**
 * Resolve a validated diagnostic against the source cache.
 *
 * Returns `null` when the source is unreadable or the span is out-of-bounds.
 *
 * Uses `labels[0]` for the displayed span.
 * oxlint's `labels[]` carries no primary/secondary distinction, and
 * multi-label rules (e.g. `no-dupe-keys`) typically duplicate the same slice across entries.
 */
export function resolveDiagnostic(
  diag: ValidatedFileDiagnostic,
  cache: SourceCache,
): ResolvedDiagnostic | null {
  const span = diag.labels[0].span;
  const resolved = resolveSpan(cache, diag.filename, span.offset, span.length);
  if (resolved === null) return null;
  const slice = formatCodeSlice(resolved.text);
  return {
    filename: diag.filename,
    errorCode: diag.code ?? PARSE_ERROR_CODE,
    message: diag.message,
    startLine: resolved.startLine,
    startCol: resolved.startCol,
    endLine: resolved.endLine,
    endCol: resolved.endCol,
    slice: slice.text,
    sliceTruncated: slice.truncated,
  };
}

/**
 * Render-ready unit for a project-level diagnostic. Carries no source location.
 */
export interface ResolvedProjectDiagnostic {
  filename: string;
  errorCode: string;
  message: string;
}

/**
 * Project counterpart to {@link resolveDiagnostic}. Reads no source files.
 */
export function resolveProjectDiagnostic(
  diag: ValidatedProjectDiagnostic,
): ResolvedProjectDiagnostic {
  return {
    filename: diag.filename,
    errorCode: diag.code ?? PARSE_ERROR_CODE,
    message: diag.message,
  };
}

/**
 * Extract the first line, truncate if too long,
 * and append a multi-line marker if more lines follow.
 */
export function formatCodeSlice(text: string): { text: string; truncated: boolean } {
  const nlIdx = text.search(/\r?\n/);
  const hasMoreLines = nlIdx !== -1;
  const rawFirstLine = hasMoreLines ? text.slice(0, nlIdx) : text;
  // Strip a trailing CR left when the span ends exactly at the CR of a CRLF
  // pair (the LF that the regex would otherwise consume is outside the span).
  const firstLine = rawFirstLine.replace(/\r$/, "");
  // Iterate as Unicode code points (not UTF-16 units) so e.g. "𠮷" counts as 1.
  const codePoints = Array.from(firstLine);
  if (codePoints.length > SLICE_MAX_LEN) {
    return { text: `${codePoints.slice(0, SLICE_MAX_LEN).join("")}...`, truncated: true };
  }
  if (hasMoreLines) {
    return { text: `${firstLine} ...`, truncated: true };
  }
  return { text: firstLine, truncated: false };
}
