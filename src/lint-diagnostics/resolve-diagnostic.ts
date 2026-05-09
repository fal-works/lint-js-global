import { type SourceCache, resolveSpan } from "../system/source-cache.ts";
import type { ValidatedFileDiagnostic, ValidatedProjectDiagnostic } from "./schema.ts";

/**
 * Synthetic placeholder used in the `[...]` bracket when a diagnostic has no `code` (oxc parser
 * errors). Distinguishable from real codes, which always carry the `plugin(rule)` form.
 */
const PARSE_ERROR_CODE = "parse-error";

/** Resolved unit produced from a {@link ValidatedFileDiagnostic} + source resolution. */
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

  /** Decoded source text covered by the span; rendered shape is the renderer's concern. */
  spanText: string;
}

/**
 * Resolved unit for a project-level diagnostic. Carries no source location.
 */
export interface ResolvedProjectDiagnostic {
  filename: string;
  errorCode: string;
  message: string;
}

/**
 * Resolve a validated diagnostic against the source cache.
 *
 * Returns `null` when the source is unreadable or the span is out-of-bounds.
 *
 * Uses `labels[0]` for the displayed span.
 * oxlint's `labels[]` carries no primary/secondary distinction, and
 * multi-label rules (e.g. `no-dupe-keys`) typically duplicate the same span across entries.
 */
export function resolveDiagnostic(
  diag: ValidatedFileDiagnostic,
  cache: SourceCache,
): ResolvedDiagnostic | null {
  const span = diag.labels[0].span;
  const resolved = resolveSpan(cache, diag.filename, span.offset, span.length);
  if (resolved === null) return null;
  return {
    filename: diag.filename,
    errorCode: diag.code ?? PARSE_ERROR_CODE,
    message: diag.message,
    startLine: resolved.startLine,
    startCol: resolved.startCol,
    endLine: resolved.endLine,
    endCol: resolved.endCol,
    spanText: resolved.text,
  };
}

/**
 * Project counterpart to {@link resolveDiagnostic}.
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
