import type { FileFinding, ProjectFinding } from "../model/finding.ts";
import {
  collapseNewlines,
  compareFileFindings,
  compareProjectFindings,
  displayCode,
  projectHeading,
  type RenderedDiagnostics,
} from "./shared.ts";

export function renderUnix(
  file: readonly FileFinding[],
  project: readonly ProjectFinding[],
): RenderedDiagnostics {
  const fileLines = [...file].sort(compareFileFindings).map(formatUnixLine);
  const projectLines = [...project].sort(compareProjectFindings).map(formatProjectUnixLine);
  return {
    file: fileLines.length === 0 ? "" : `${fileLines.join("\n")}\n`,
    project: projectLines.length === 0 ? "" : `${projectLines.join("\n")}\n`,
  };
}

export function formatUnixLine(d: FileFinding): string {
  const message = collapseNewlines(d.message);
  return `${d.filename}:${d.startLine}:${d.startCol}: ${message} [${displayCode(d.code)}]`;
}

export function formatProjectUnixLine(d: ProjectFinding): string {
  const message = collapseNewlines(d.message);
  return `${projectHeading(d.filename)}: ${message} [${displayCode(d.code)}]`;
}
