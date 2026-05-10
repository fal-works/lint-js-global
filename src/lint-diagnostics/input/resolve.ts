import type { SourceCache } from "../../system/source-cache.ts";
import type { FileFinding, ProjectFinding } from "../model/finding.ts";
import { resolveDiagnostic, resolveProjectDiagnostic } from "./resolve-diagnostic.ts";
import type { ValidatedFileDiagnostic, ValidatedFindings } from "./schema.ts";

/**
 * Outcome of resolving a full validated payload through {@link resolveAll}.
 *
 * Discriminated by `kind`:
 * - `ok`: every file diagnostic resolved successfully; project diagnostics passed through.
 * - `contract-failure`: at least one file diagnostic could not be resolved against the source.
 * `reason` is human-readable and follows `failed to resolve span: filename=…, offset=…, length=…`.
 */
export type ResolveResult =
  | { kind: "ok"; file: readonly FileFinding[]; project: readonly ProjectFinding[] }
  | { kind: "contract-failure"; reason: string };

/**
 * Resolve a full validated payload against the source cache.
 *
 * Short-circuits on the first file diagnostic that fails to resolve.
 */
export function resolveAll(findings: ValidatedFindings, cache: SourceCache): ResolveResult {
  const file: FileFinding[] = [];
  for (const diag of findings.file) {
    const entry = resolveDiagnostic(diag, cache);
    if (entry === null) return { kind: "contract-failure", reason: formatResolveFailure(diag) };
    file.push(entry);
  }
  const project = findings.project.map(resolveProjectDiagnostic);
  return { kind: "ok", file, project };
}

function formatResolveFailure(diag: ValidatedFileDiagnostic): string {
  const { offset, length } = diag.labels[0].span;
  return `failed to resolve span: filename=${diag.filename}, offset=${offset}, length=${length}`;
}
