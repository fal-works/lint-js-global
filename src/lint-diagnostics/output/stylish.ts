import type { FileFinding, ProjectFinding } from "../model/finding.ts";
import { formatCodeSlice } from "./code-slice.ts";
import {
  collapseNewlines,
  compareFileFindings,
  compareProjectFindings,
  displayCode,
  projectHeading,
  type RenderedDiagnostics,
} from "./shared.ts";

export function renderStylish(
  file: readonly FileFinding[],
  project: readonly ProjectFinding[],
): RenderedDiagnostics {
  const fileSections: string[] = [];
  const sortedFile = [...file].sort(compareFileFindings);
  for (const [filename, findings] of groupByFilename(sortedFile)) {
    fileSections.push([filename, ...findings.map(formatStylishEntry)].join("\n"));
  }
  const projectSections: string[] = [];
  const sortedProject = [...project].sort(compareProjectFindings);
  for (const [heading, findings] of groupProjectByHeading(sortedProject)) {
    projectSections.push([heading, ...findings.map(formatProjectStylishEntry)].join("\n"));
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
export function formatStylishEntry(d: FileFinding): string {
  const slice = formatCodeSlice(d.spanText);
  const location = slice.truncated
    ? `${d.startLine}:${d.startCol}-${d.endLine}:${d.endCol}`
    : `${d.startLine}:${d.startCol}`;
  const message = collapseNewlines(d.message);
  return `  ${location} ${message} [${displayCode(d.code)}]\n    ${slice.text}`;
}

export function formatProjectStylishEntry(d: ProjectFinding): string {
  const message = collapseNewlines(d.message);
  return `  ${message} [${displayCode(d.code)}]`;
}

/** Group already-sorted findings into a Map keyed by filename, preserving order. */
function groupByFilename(file: readonly FileFinding[]): Map<string, FileFinding[]> {
  const map = new Map<string, FileFinding[]>();
  for (const d of file) {
    const arr = map.get(d.filename);
    if (arr !== undefined) arr.push(d);
    else map.set(d.filename, [d]);
  }
  return map;
}

/** Group already-sorted project findings by their displayed heading, preserving order. */
function groupProjectByHeading(project: readonly ProjectFinding[]): Map<string, ProjectFinding[]> {
  const map = new Map<string, ProjectFinding[]>();
  for (const d of project) {
    const heading = projectHeading(d.filename);
    const arr = map.get(heading);
    if (arr !== undefined) arr.push(d);
    else map.set(heading, [d]);
  }
  return map;
}
