import type { ResolvedDiagnostic, ResolvedProjectDiagnostic } from "./resolve.ts";

/**
 * Pattern matching the `errorCode` of `typescript-eslint(no-unsafe-*)` diagnostics, which
 * trigger the weak-typings hint block.
 */
const UNSAFE_CODE_PATTERN = /^typescript-eslint\(no-unsafe-/;

/**
 * Heading shown in place of an empty `filename` for project-level diagnostics.
 */
const PROJECT_PLACEHOLDER_HEADING = "(project)";

/**
 * Render the stylish layout: project sections first, then per-file sections.
 * Returns an empty string when both inputs are empty.
 */
export function renderStylish(
  resolved: readonly ResolvedDiagnostic[],
  project: readonly ResolvedProjectDiagnostic[],
): string {
  if (resolved.length === 0 && project.length === 0) return "";
  const sections: string[] = [];
  const sortedProject = [...project].sort(compareProjectDiagnostics);
  for (const [heading, diags] of groupProjectByHeading(sortedProject)) {
    sections.push([heading, ...diags.map(formatProjectStylishEntry)].join("\n"));
  }
  const sortedFile = [...resolved].sort(compareDiagnostics);
  for (const [filename, diags] of groupByFilename(sortedFile)) {
    sections.push([filename, ...diags.map(formatStylishEntry)].join("\n"));
  }
  return `${sections.join("\n\n")}\n`;
}

/**
 * Render the unix layout: project lines first, then per-file lines.
 * Returns an empty string when both inputs are empty.
 */
export function renderUnix(
  resolved: readonly ResolvedDiagnostic[],
  project: readonly ResolvedProjectDiagnostic[],
): string {
  if (resolved.length === 0 && project.length === 0) return "";
  const projectLines = [...project].sort(compareProjectDiagnostics).map(formatProjectUnixLine);
  const fileLines = [...resolved].sort(compareDiagnostics).map(formatUnixLine);
  return `${[...projectLines, ...fileLines].join("\n")}\n`;
}

/**
 * Compose the human-readable summary line stating how many issues remain.
 * In `--check` mode the "unfixed" qualifier is dropped.
 */
export function formatSummary(check: boolean, issueCount: number): string {
  const issueWord = issueCount === 1 ? "lint issue" : "lint issues";
  const qualifier = check ? "" : "unfixed ";
  return `${issueCount} ${qualifier}${issueWord}.`;
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

/**
 * Stable ordering for project-level diagnostics: heading → error code → message.
 * Empty `filename` is normalized through {@link PROJECT_PLACEHOLDER_HEADING} so it
 * sorts alongside other entries that share the placeholder.
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

/**
 * Group already-sorted project diagnostics by their displayed heading, preserving order.
 */
export function groupProjectByHeading(
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

/**
 * Render one project diagnostic as the stylish layout's indented one-line entry.
 * Carries no location and no source slice.
 */
export function formatProjectStylishEntry(d: ResolvedProjectDiagnostic): string {
  const message = collapseNewlines(d.message);
  return `  ${message} [${d.errorCode}]`;
}

/**
 * Render one project diagnostic as a single `<heading>: <message> [<code>]` line.
 */
export function formatProjectUnixLine(d: ResolvedProjectDiagnostic): string {
  const message = collapseNewlines(d.message);
  return `${projectHeading(d.filename)}: ${message} [${d.errorCode}]`;
}

function projectHeading(filename: string): string {
  return filename === "" ? PROJECT_PLACEHOLDER_HEADING : filename;
}

function collapseNewlines(text: string): string {
  return text.replace(/\r?\n/g, " ");
}
