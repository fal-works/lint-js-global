import type { ResolvedDiagnostic, ResolvedProjectDiagnostic } from "../resolve.ts";

/**
 * Heading shown in place of an empty `filename` for project-level diagnostics.
 */
const PROJECT_PLACEHOLDER_HEADING = "(project)";

/**
 * Render output split into two parallel blocks the caller emits independently.
 *
 * Each string carries its own trailing newline, or is empty when nothing applies.
 */
export interface RenderedDiagnostics {
  /** Per-file diagnostics block, one entry per locatable diagnostic. */
  file: string;

  /** Location-less diagnostics block. */
  project: string;
}

/**
 * Stable ordering: filename (lexicographic) → start line → start column → error code.
 */
export function compareDiagnostics(a: ResolvedDiagnostic, b: ResolvedDiagnostic): number {
  if (a.filename !== b.filename) return a.filename < b.filename ? -1 : 1;
  if (a.startLine !== b.startLine) return a.startLine - b.startLine;
  if (a.startCol !== b.startCol) return a.startCol - b.startCol;
  if (a.errorCode !== b.errorCode) return a.errorCode < b.errorCode ? -1 : 1;
  return 0;
}

/**
 * Stable ordering for project-level diagnostics: heading → error code → message.
 * Empty `filename` is normalized through {@link projectHeading} so it sorts alongside
 * other entries that share the placeholder.
 */
export function compareProjectDiagnostics(
  a: ResolvedProjectDiagnostic,
  b: ResolvedProjectDiagnostic,
): number {
  const aHeading = projectHeading(a.filename);
  const bHeading = projectHeading(b.filename);
  if (aHeading !== bHeading) return aHeading < bHeading ? -1 : 1;
  if (a.errorCode !== b.errorCode) return a.errorCode < b.errorCode ? -1 : 1;
  if (a.message !== b.message) return a.message < b.message ? -1 : 1;
  return 0;
}

/** Display heading for a project diagnostic; empty filename collapses to a fixed placeholder. */
export function projectHeading(filename: string): string {
  return filename === "" ? PROJECT_PLACEHOLDER_HEADING : filename;
}

/** Collapse `\r?\n` newlines to single spaces so a head line stays on one line. */
export function collapseNewlines(text: string): string {
  return text.replace(/\r?\n/g, " ");
}
