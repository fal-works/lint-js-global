import type { ValidatedDiagnostic } from "../oxlint-json-schema.ts";
import { type SourceCache, resolveSpan } from "../source.ts";

/**
 * Synthetic placeholder used in the `[...]` bracket when a diagnostic has no `code` (oxc parser
 * errors). Distinguishable from real codes, which always carry the `plugin(rule)` form.
 */
export const PARSE_ERROR_CODE = "parse-error";

/** Slice text used as a placeholder when the source is unreadable or the span is out-of-bounds. */
export const UNREADABLE_SLICE = "<unreadable>";

/** Code-point cap for the rendered slice's first line before truncation kicks in. */
export const SLICE_MAX_LEN = 40;

/**
 * Render-ready unit produced from a {@link ValidatedDiagnostic} + source resolution.
 *
 * `slice` is the source text the rule points at, truncated to one line of at most
 * {@link SLICE_MAX_LEN} code points; `sliceTruncated` is true whenever truncation hides any
 * portion of the original span.
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
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
  slice: string;
  sliceTruncated: boolean;
}

/**
 * Resolve a validated diagnostic against the source cache. Falls back to the validator's
 * span L:C and {@link UNREADABLE_SLICE} when the source is unreadable or the span is out-of-bounds.
 */
export function resolveDiagnostic(
  diag: ValidatedDiagnostic,
  cache: SourceCache,
): ResolvedDiagnostic {
  const errorCode = diag.code ?? PARSE_ERROR_CODE;
  const resolved = resolveSpan(cache, diag.filename, diag.span.offset, diag.span.length);
  if (resolved !== null) {
    const slice = formatCodeSlice(resolved.text);
    return {
      filename: diag.filename,
      errorCode,
      message: diag.message,
      startLine: resolved.startLine,
      startCol: resolved.startCol,
      endLine: resolved.endLine,
      endCol: resolved.endCol,
      slice: slice.text,
      sliceTruncated: slice.truncated,
    };
  }

  return {
    filename: diag.filename,
    errorCode,
    message: diag.message,
    startLine: diag.span.line,
    startCol: diag.span.column,
    endLine: diag.span.line,
    endCol: diag.span.column,
    slice: UNREADABLE_SLICE,
    sliceTruncated: false,
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
