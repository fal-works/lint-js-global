import { type SourceCache, resolveSpan } from "../../system/source-cache.ts";
import type { FileFinding, ProjectFinding } from "../model/finding.ts";
import type { ValidatedFileDiagnostic, ValidatedProjectDiagnostic } from "./schema.ts";

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
): FileFinding | null {
  const span = diag.labels[0].span;
  const resolved = resolveSpan(cache, diag.filename, span.offset, span.length);
  if (resolved === null) return null;
  return {
    filename: diag.filename,
    code: diag.code,
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
export function resolveProjectDiagnostic(diag: ValidatedProjectDiagnostic): ProjectFinding {
  const message = diag.help === null ? diag.message : `${diag.message}: ${diag.help}`;
  return {
    filename: diag.filename,
    code: diag.code,
    message,
  };
}
