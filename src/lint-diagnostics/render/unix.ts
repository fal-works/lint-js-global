import type { ResolvedDiagnostic, ResolvedProjectDiagnostic } from "../resolve.ts";
import {
  collapseNewlines,
  compareDiagnostics,
  compareProjectDiagnostics,
  projectHeading,
  type RenderedDiagnostics,
} from "./shared.ts";

export function renderUnix(
  resolved: readonly ResolvedDiagnostic[],
  project: readonly ResolvedProjectDiagnostic[],
): RenderedDiagnostics {
  const fileLines = [...resolved].sort(compareDiagnostics).map(formatUnixLine);
  const projectLines = [...project].sort(compareProjectDiagnostics).map(formatProjectUnixLine);
  return {
    file: fileLines.length === 0 ? "" : `${fileLines.join("\n")}\n`,
    project: projectLines.length === 0 ? "" : `${projectLines.join("\n")}\n`,
  };
}

export function formatUnixLine(d: ResolvedDiagnostic): string {
  const message = collapseNewlines(d.message);
  return `${d.filename}:${d.startLine}:${d.startCol}: ${message} [${d.errorCode}]`;
}

export function formatProjectUnixLine(d: ResolvedProjectDiagnostic): string {
  const message = collapseNewlines(d.message);
  return `${projectHeading(d.filename)}: ${message} [${d.errorCode}]`;
}
