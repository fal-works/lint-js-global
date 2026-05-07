import type { ResolvedDiagnostic } from "./resolve.ts";

/**
 * Pattern matching the `errorCode` of `typescript-eslint(no-unsafe-*)` diagnostics, which
 * trigger the weak-typings hint block.
 */
const UNSAFE_CODE_PATTERN = /^typescript-eslint\(no-unsafe-/;

/**
 * Render the stylish layout: per-file sections, two lines per diagnostic.
 * Returns an empty string for an empty input.
 */
export function renderStylish(resolved: readonly ResolvedDiagnostic[]): string {
  if (resolved.length === 0) return "";
  const sorted = [...resolved].sort(compareDiagnostics);
  const fileGroups = groupByFilename(sorted);
  const sections: string[] = [];
  for (const [filename, diags] of fileGroups) {
    const lines = [filename, ...diags.map(formatStylishEntry)];
    sections.push(lines.join("\n"));
  }
  return `${sections.join("\n\n")}\n`;
}

/**
 * Render the unix layout: one line per diagnostic. Returns an empty string for an empty input.
 */
export function renderUnix(resolved: readonly ResolvedDiagnostic[]): string {
  if (resolved.length === 0) return "";
  const sorted = [...resolved].sort(compareDiagnostics);
  return `${sorted.map(formatUnixLine).join("\n")}\n`;
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

/** True when any diagnostic in the set carries a `typescript-eslint(no-unsafe-*)` code. */
export function hasUnsafeDiagnostic(resolved: readonly ResolvedDiagnostic[]): boolean {
  return resolved.some((d) => UNSAFE_CODE_PATTERN.test(d.errorCode));
}

/** Number of distinct filenames the resolved set spans. */
export function countFiles(resolved: readonly ResolvedDiagnostic[]): number {
  const set = new Set<string>();
  for (const d of resolved) set.add(d.filename);
  return set.size;
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
 * Render one diagnostic as the stylish layout's two-line entry: an indented head line carrying
 * location, message and bracketed code, followed by an indented source-slice continuation.
 *
 * The location collapses to `L:C` when the source slice fully shows the span;
 * when the slice is truncated, the range form `L:C-L:C` discloses the hidden portion.
 * Newlines inside `message` collapse to single spaces so the head line stays on one line.
 */
export function formatStylishEntry(d: ResolvedDiagnostic): string {
  const location = d.sliceTruncated
    ? `${d.startLine}:${d.startCol}-${d.endLine}:${d.endCol}`
    : `${d.startLine}:${d.startCol}`;
  const message = collapseNewlines(d.message);
  return `  ${location} ${message} [${d.errorCode}]\n    ${d.slice}`;
}

/**
 * Render one diagnostic as a single `<filename>:<L>:<C>: <message> [<code>]` line.
 */
export function formatUnixLine(d: ResolvedDiagnostic): string {
  const message = collapseNewlines(d.message);
  return `${d.filename}:${d.startLine}:${d.startCol}: ${message} [${d.errorCode}]`;
}

function collapseNewlines(text: string): string {
  return text.replace(/\r?\n/g, " ");
}
