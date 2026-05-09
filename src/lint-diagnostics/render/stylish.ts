import type { ResolvedDiagnostic, ResolvedProjectDiagnostic } from "../resolve.ts";
import { formatCodeSlice } from "./code-slice.ts";
import {
  collapseNewlines,
  compareDiagnostics,
  compareProjectDiagnostics,
  projectHeading,
  type RenderedDiagnostics,
} from "./shared.ts";

export function renderStylish(
  resolved: readonly ResolvedDiagnostic[],
  project: readonly ResolvedProjectDiagnostic[],
): RenderedDiagnostics {
  const fileSections: string[] = [];
  const sortedFile = [...resolved].sort(compareDiagnostics);
  for (const [filename, diags] of groupByFilename(sortedFile)) {
    fileSections.push([filename, ...diags.map(formatStylishEntry)].join("\n"));
  }
  const projectSections: string[] = [];
  const sortedProject = [...project].sort(compareProjectDiagnostics);
  for (const [heading, diags] of groupProjectByHeading(sortedProject)) {
    projectSections.push([heading, ...diags.map(formatProjectStylishEntry)].join("\n"));
  }
  return {
    file: fileSections.length === 0 ? "" : `${fileSections.join("\n\n")}\n`,
    project: projectSections.length === 0 ? "" : `${projectSections.join("\n\n")}\n`,
  };
}

/**
 * The location widens to `L:C-L:C` when the slice gets truncated, so the hidden portion
 * is still visible. Newlines in `message` collapse to single spaces so the head line stays
 * on one line.
 */
export function formatStylishEntry(d: ResolvedDiagnostic): string {
  const slice = formatCodeSlice(d.spanText);
  const location = slice.truncated
    ? `${d.startLine}:${d.startCol}-${d.endLine}:${d.endCol}`
    : `${d.startLine}:${d.startCol}`;
  const message = collapseNewlines(d.message);
  return `  ${location} ${message} [${d.errorCode}]\n    ${slice.text}`;
}

export function formatProjectStylishEntry(d: ResolvedProjectDiagnostic): string {
  const message = collapseNewlines(d.message);
  return `  ${message} [${d.errorCode}]`;
}

/** Group already-sorted diagnostics into a Map keyed by filename, preserving order. */
function groupByFilename(
  resolved: readonly ResolvedDiagnostic[],
): Map<string, ResolvedDiagnostic[]> {
  const map = new Map<string, ResolvedDiagnostic[]>();
  for (const d of resolved) {
    const arr = map.get(d.filename);
    if (arr !== undefined) arr.push(d);
    else map.set(d.filename, [d]);
  }
  return map;
}

/** Group already-sorted project diagnostics by their displayed heading, preserving order. */
function groupProjectByHeading(
  project: readonly ResolvedProjectDiagnostic[],
): Map<string, ResolvedProjectDiagnostic[]> {
  const map = new Map<string, ResolvedProjectDiagnostic[]>();
  for (const d of project) {
    const heading = projectHeading(d.filename);
    const arr = map.get(heading);
    if (arr !== undefined) arr.push(d);
    else map.set(heading, [d]);
  }
  return map;
}
