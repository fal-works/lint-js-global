import type { ResolvedDiagnostic } from "./resolve.ts";

/**
 * Pattern matching the `errorCode` of `typescript-eslint(no-unsafe-*)` diagnostics, which
 * trigger the weak-typings hint block.
 */
const UNSAFE_CODE_PATTERN = /^typescript-eslint\(no-unsafe-/;

/**
 * Render the formatted diagnostics payload from resolved diagnostics. Diagnostics are
 * sorted stably, grouped by filename, and emitted as one section per file.
 *
 * Returns the diagnostics block alongside the file count and an optional weak-typings
 * hint block. The hint is non-null whenever any `no-unsafe-*` diagnostic is present;
 * it is returned separately so the caller can route it apart from the diagnostics.
 */
export function renderDiagnostics(
  resolved: readonly ResolvedDiagnostic[],
  weakTypingsDocPath: string,
): { formattedDiagnostics: string; weakTypingsHint: string | null; fileCount: number } {
  const sorted = [...resolved].sort(compareDiagnostics);
  const fileGroups = groupByFilename(sorted);

  const sections: string[][] = [];
  for (const [filename, diags] of fileGroups) {
    sections.push([filename, ...diags.map(formatDiagLine)]);
  }

  const formattedDiagnostics = `${sections.map((s) => s.join("\n")).join("\n\n")}\n`;

  const weakTypingsHint = sorted.some((d) => UNSAFE_CODE_PATTERN.test(d.errorCode))
    ? `${renderWeakTypingsHint(weakTypingsDocPath).join("\n")}\n`
    : null;

  return { formattedDiagnostics, weakTypingsHint, fileCount: fileGroups.size };
}

/**
 * Compose the human-readable summary line stating how many issues remain.
 * In `--check` mode the "unfixed" qualifier is dropped.
 */
export function formatSummary(check: boolean, issueCount: number, fileCount: number): string {
  const issueWord = issueCount === 1 ? "lint issue" : "lint issues";
  const fileWord = fileCount === 1 ? "file" : "files";
  const qualifier = check ? "" : "unfixed ";
  return `${issueCount} ${qualifier}${issueWord} in ${fileCount} ${fileWord}.`;
}

/**
 * Stable ordering: filename (lexicographic) → start line → start column → error code.
 */
export function compareDiagnostics(a: ResolvedDiagnostic, b: ResolvedDiagnostic): number {
  if (a.filename !== b.filename) return a.filename < b.filename ? -1 : 1;
  if (a.sortLine !== b.sortLine) return a.sortLine - b.sortLine;
  if (a.sortCol !== b.sortCol) return a.sortCol - b.sortCol;
  if (a.errorCode !== b.errorCode) return a.errorCode < b.errorCode ? -1 : 1;
  return 0;
}

/**
 * Group already-sorted diagnostics into a Map keyed by filename, preserving order.
 */
export function groupByFilename(
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

/**
 * Render a single diagnostic as the head line (`<location> <message> [<error-code>]`)
 * followed by a source-slice continuation line. Newlines inside `message` collapse to
 * a single space so the head line stays on one line.
 */
export function formatDiagLine(d: ResolvedDiagnostic): string {
  const message = d.message.replace(/\r?\n/g, " ");
  const headLine = `  ${d.location} ${message} [${d.errorCode}]`;
  return `${headLine}\n    ${d.slice}`;
}

/**
 * Static weak-typings hint block. Each entry is one line of the block, in render order.
 */
export function renderWeakTypingsHint(docPath: string): string[] {
  return [
    "Hint on the `no-unsafe-*` diagnostics:",
    "- Remedies: `*.d.ts` augmentation, `unknown` + type predicates, or boundary module with typed wrappers.",
    "- Inline disable (`// oxlint-disable-next-line`) is not a fix; use only when explicitly permitted by the project maintainer.",
    `- See: ${docPath}`,
  ];
}
