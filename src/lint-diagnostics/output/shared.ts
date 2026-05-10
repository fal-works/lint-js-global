import type { FileFinding, ProjectFinding } from "../model/finding.ts";

/**
 * Heading shown in place of an empty `filename` for project-level findings.
 */
const PROJECT_PLACEHOLDER_HEADING = "(project)";

/**
 * Synthetic placeholder displayed inside the bracketed code slot when a finding has no `code`
 * (oxc parser errors). Distinguishable from real codes, which always carry the `plugin(rule)`
 * form.
 */
const PARSE_ERROR_CODE = "parse-error";

/**
 * Render output split into two parallel blocks the caller emits independently.
 *
 * Each string carries its own trailing newline, or is empty when nothing applies.
 */
export interface RenderedDiagnostics {
  /** Per-file diagnostics block, one entry per locatable finding. */
  file: string;

  /** Location-less diagnostics block. */
  project: string;
}

/** Display string for the bracketed code slot; `null` collapses to the parse-error placeholder. */
export function displayCode(code: string | null): string {
  return code ?? PARSE_ERROR_CODE;
}

/**
 * Stable ordering: filename (lexicographic) → start line → start column → displayed code.
 */
export function compareFileFindings(a: FileFinding, b: FileFinding): number {
  if (a.filename !== b.filename) return a.filename < b.filename ? -1 : 1;
  if (a.startLine !== b.startLine) return a.startLine - b.startLine;
  if (a.startCol !== b.startCol) return a.startCol - b.startCol;
  const ac = displayCode(a.code);
  const bc = displayCode(b.code);
  if (ac !== bc) return ac < bc ? -1 : 1;
  return 0;
}

/**
 * Stable ordering for project-level findings: heading → displayed code → message.
 * Empty `filename` is normalized through {@link projectHeading} so it sorts alongside
 * other entries that share the placeholder.
 */
export function compareProjectFindings(a: ProjectFinding, b: ProjectFinding): number {
  const aHeading = projectHeading(a.filename);
  const bHeading = projectHeading(b.filename);
  if (aHeading !== bHeading) return aHeading < bHeading ? -1 : 1;
  const ac = displayCode(a.code);
  const bc = displayCode(b.code);
  if (ac !== bc) return ac < bc ? -1 : 1;
  if (a.message !== b.message) return a.message < b.message ? -1 : 1;
  return 0;
}

/** Display heading for a project finding; empty filename collapses to a fixed placeholder. */
export function projectHeading(filename: string): string {
  return filename === "" ? PROJECT_PLACEHOLDER_HEADING : filename;
}

/** Collapse `\r?\n` newlines to single spaces so a head line stays on one line. */
export function collapseNewlines(text: string): string {
  return text.replace(/\r?\n/g, " ");
}
