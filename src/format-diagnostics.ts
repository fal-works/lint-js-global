import { readFileSync } from "node:fs";

/**
 * LLM-friendly formatter for oxlint's `--format=json` output.
 */

const PARSE_ERROR_CODE = "parse-error";
const SLICE_MAX_LEN = 40;
const UNREADABLE_SLICE = "<unreadable>";
const UNSAFE_CODE_PATTERN = /^typescript-eslint\(no-unsafe-/;

/** Discriminated-union result type for fallible validators. */
type Result<T, E> = { ok: true; value: T } | { ok: false; reason: E };

/**
 * Per-diagnostic shape after schema validation. Only fields the wrapper consumes are kept.
 */
interface ValidatedDiagnostic {
  filename: string;

  /** Nullable: oxc parser-error diagnostics omit `code`. */
  code: string | null;

  message: string;
  span: { offset: number; length: number; line: number; column: number };
}

interface ResolvedDiagnostic {
  filename: string;

  /**
   * Value to emit inside `[...]` in the formatted output.
   *
   * - For real diagnostics it is the raw `code` from oxlint, passed through unchanged (e.g.
   *   `eslint(no-debugger)`, `typescript(TS2591)`).
   * - For oxc parser errors (no `code`), it is the synthetic literal `parse-error`. The shape is
   *   structurally distinguishable from real codes (real codes carry the `plugin(rule)` form with
   *   parens; the placeholder does not).
   */
  errorCode: string;

  message: string;
  sortLine: number;
  sortCol: number;
  location: string;
  slice: string;
}

interface SourceEntry {
  buffer: Buffer;
  lineStartOffsets: number[];
}

/**
 * Result of {@link formatLintOutput}.
 */
export interface FormatLintResult {
  formattedStdout: string;

  /**
   * A human-readable summary of the unfixed issues.
   *
   * Null when `schemaMismatch` is non-null.
   */
  linterSummary: string | null;

  /**
   * Non-null when the captured stdout fails the wrapper's output contract:
   * either non-empty stdout that does not parse as JSON, or
   * JSON whose shape diverges from the expected diagnostic schema.
   *
   * `reason` names the offending field or parser failure.
   */
  schemaMismatch: { reason: string } | null;

  /**
   * True when oxlint signaled that no files matched any target
   * (the targets contained no lintable files, or every match was filtered out by ignore patterns).
   * oxlint ≥1.61 prepends a human-readable line to stdout and exits non-zero in that case.
   */
  noFilesMatched: boolean;
}

/** Prefix oxlint ≥1.61 prepends to stdout when no files match the targets. */
const NO_FILES_PREFIX = "No files found to lint.";

export interface FormatLintOptions {
  /** Raw oxlint stdout from `--format=json`. */
  capturedStdout: string;

  /** If true, pass through unchanged (no hint, no summary). */
  unix: boolean;

  /** Absolute path used in the weak-typings hint. */
  weakTypingsDocPath: string;
}

/**
 * Format raw oxlint JSON stdout into the LLM-friendly payload.
 *
 * No stdout/stderr emission.
 * May read source files to resolve span positions.
 */
export function formatLintOutput({
  capturedStdout,
  unix,
  weakTypingsDocPath,
}: FormatLintOptions): FormatLintResult {
  // Detected before mode branching: the prefix appears in --format=unix output too,
  // so unix mode also needs the exit-normalization signal.
  const noFilesMatched = capturedStdout.startsWith(NO_FILES_PREFIX);

  if (unix) {
    return {
      formattedStdout: capturedStdout,
      linterSummary: null,
      schemaMismatch: null,
      noFilesMatched,
    };
  }

  // Empty stdout is treated as clean-compatible: oxlint emitted no payload at all,
  // which is benign and should not be escalated to a contract failure.
  if (capturedStdout === "") {
    return {
      formattedStdout: "",
      linterSummary: null,
      schemaMismatch: null,
      noFilesMatched: false,
    };
  }

  // The prefix breaks JSON parsing; short-circuit to a clean result.
  if (noFilesMatched) {
    return {
      formattedStdout: "",
      linterSummary: null,
      schemaMismatch: null,
      noFilesMatched: true,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(capturedStdout);
  } catch (err) {
    // Non-empty unparseable stdout is an output-contract failure (e.g. caret-range
    // oxlint update silently changed the format). Surface it via the same path as
    // schema drift so the wrapper exits 2 instead of misreporting the run as clean.
    const message = err instanceof Error ? err.message : String(err);
    return {
      formattedStdout: capturedStdout,
      linterSummary: null,
      schemaMismatch: { reason: `stdout is not valid JSON: ${message}` },
      noFilesMatched: false,
    };
  }

  const validation = validatePayload(parsed);
  if (!validation.ok) {
    return {
      formattedStdout: capturedStdout,
      linterSummary: null,
      schemaMismatch: { reason: validation.reason },
      noFilesMatched: false,
    };
  }
  const validated = validation.value;
  if (validated.length === 0) {
    return {
      formattedStdout: "",
      linterSummary: null,
      schemaMismatch: null,
      noFilesMatched: false,
    };
  }

  const cache = createSourceCache();
  const resolved = validated.map((d) => resolveDiagnostic(d, cache));
  resolved.sort(compareDiagnostics);

  const fileGroups = groupByFilename(resolved);

  const sections: string[][] = [];
  for (const [filename, diags] of fileGroups) {
    sections.push([filename, ...diags.map(formatDiagLine)]);
  }

  const hasUnsafe = resolved.some((d) => UNSAFE_CODE_PATTERN.test(d.errorCode));
  if (hasUnsafe) {
    sections.push(renderWeakTypingsHint(weakTypingsDocPath));
  }

  const formattedStdout = `${sections.map((s) => s.join("\n")).join("\n\n")}\n`;
  const issueWord = resolved.length === 1 ? "issue" : "issues";
  const fileWord = fileGroups.size === 1 ? "file" : "files";
  const linterSummary = `Found ${resolved.length} unfixed ${issueWord} in ${fileGroups.size} ${fileWord}.`;
  return { formattedStdout, linterSummary, schemaMismatch: null, noFilesMatched: false };
}

/**
 * Validate the parsed oxlint payload against the {@link ValidatedDiagnostic} contract.
 *
 * Stops at the first mismatch so shape drift surfaces as a contract error
 * rather than averaging out across silently-degraded entries.
 */
function validatePayload(parsed: unknown): Result<ValidatedDiagnostic[], string> {
  if (!isObject(parsed)) return { ok: false, reason: "top-level value is not an object" };
  const diagnostics = parsed.diagnostics;
  if (!isUnknownArray(diagnostics)) {
    return { ok: false, reason: "`diagnostics` is missing or not an array" };
  }
  const validated: ValidatedDiagnostic[] = [];
  for (let i = 0; i < diagnostics.length; i++) {
    const result = validateDiagnostic(diagnostics[i]);
    if (!result.ok) return { ok: false, reason: `diagnostics[${i}]: ${result.reason}` };
    validated.push(result.value);
  }
  return { ok: true, value: validated };
}

/**
 * Validate a single oxlint diagnostic entry.
 */
function validateDiagnostic(diag: unknown): Result<ValidatedDiagnostic, string> {
  if (!isObject(diag)) return { ok: false, reason: "not an object" };
  if (typeof diag.filename !== "string") {
    return { ok: false, reason: "`filename` is missing or not a string" };
  }
  const codeResult = validateOptionalString(diag.code, "code");
  if (!codeResult.ok) return codeResult;
  const code = codeResult.value;
  if (typeof diag.message !== "string") {
    return { ok: false, reason: "`message` is missing or not a string" };
  }
  const message = diag.message;
  if (!isUnknownArray(diag.labels) || diag.labels.length === 0) {
    return { ok: false, reason: "`labels` is missing or empty" };
  }
  // Reduce multi-label entries to `labels[0]`.
  // Typical extras are duplicate pointers to the identical slice at different locations.
  const first = diag.labels[0];
  if (!isObject(first)) return { ok: false, reason: "`labels[0]` is not an object" };
  const span = first.span;
  if (!isObject(span)) {
    return { ok: false, reason: "`labels[0].span` is missing or not an object" };
  }
  // Without integer-domain checks, malformed spans slip past validation and
  // surface as `<unreadable>` at the runtime path, masking contract drift.
  if (!isNonNegativeInteger(span.offset)) {
    return { ok: false, reason: "`labels[0].span.offset` is not a non-negative integer" };
  }
  if (!isNonNegativeInteger(span.length)) {
    return { ok: false, reason: "`labels[0].span.length` is not a non-negative integer" };
  }
  if (!isPositiveInteger(span.line)) {
    return { ok: false, reason: "`labels[0].span.line` is not a positive integer" };
  }
  if (!isPositiveInteger(span.column)) {
    return { ok: false, reason: "`labels[0].span.column` is not a positive integer" };
  }
  return {
    ok: true,
    value: {
      filename: diag.filename,
      code,
      message,
      span: {
        offset: span.offset,
        length: span.length,
        line: span.line,
        column: span.column,
      },
    },
  };
}

interface SourceCache {
  get(filename: string): SourceEntry | null;
}

function createSourceCache(): SourceCache {
  const cache = new Map<string, SourceEntry | null>();
  return {
    get(filename) {
      const cached = cache.get(filename);
      if (cached !== undefined) return cached;
      try {
        const buffer = readFileSync(filename);
        const entry: SourceEntry = { buffer, lineStartOffsets: buildLineStartOffsets(buffer) };
        cache.set(filename, entry);
        return entry;
      } catch {
        cache.set(filename, null);
        return null;
      }
    },
  };
}

/**
 * Build an index of byte offsets where each line starts (0-origin array, 1-origin line).
 */
function buildLineStartOffsets(buffer: Buffer): number[] {
  const offsets = [0];
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === 0x0a) offsets.push(i + 1);
  }
  return offsets;
}

/**
 * Binary-search for the 1-origin line whose start offset is the greatest one ≤ `offset`.
 *
 * Returns both the line number and the matching start offset so the caller can compute
 * column without indexing back into the array.
 */
function findLine(
  lineStartOffsets: readonly number[],
  offset: number,
): { line: number; lineStart: number } {
  let lo = 0;
  let hi = lineStartOffsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const midOffset = lineStartOffsets[mid];
    if (midOffset !== undefined && midOffset <= offset) lo = mid;
    else hi = mid - 1;
  }
  // `buildLineStartOffsets` always seeds the array with `[0]`, so index `lo` is in bounds;
  // the `?? 0` is a no-op in practice but satisfies TS narrowing.
  const lineStart = lineStartOffsets[lo] ?? 0;
  return { line: lo + 1, lineStart };
}

/**
 * Resolve a validated diagnostic against the source cache. Falls back when
 * the source is unreadable or the span is out-of-bounds.
 */
function resolveDiagnostic(diag: ValidatedDiagnostic, cache: SourceCache): ResolvedDiagnostic {
  const errorCode = diag.code ?? PARSE_ERROR_CODE;
  const resolved = resolveSpan(cache, diag.filename, diag.span.offset, diag.span.length);
  if (resolved !== null) {
    const slice = formatCodeSlice(resolved.text);
    const location = slice.truncated
      ? `${resolved.startLine}:${resolved.startCol}-${resolved.endLine}:${resolved.endCol}`
      : `${resolved.startLine}:${resolved.startCol}`;
    return {
      filename: diag.filename,
      errorCode,
      message: diag.message,
      sortLine: resolved.startLine,
      sortCol: resolved.startCol,
      location,
      slice: slice.text,
    };
  }

  return {
    filename: diag.filename,
    errorCode,
    message: diag.message,
    sortLine: diag.span.line,
    sortCol: diag.span.column,
    location: `${diag.span.line}:${diag.span.column}`,
    slice: UNREADABLE_SLICE,
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * Type-guard wrapper for `Array.isArray` that narrows to `unknown[]` instead of `any[]`.
 */
function isUnknownArray(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

/**
 * Accept string, null, or undefined as a valid optional-string field. A present-but-wrong-typed
 * value (e.g. a structured object from a future schema change) is rejected so caret-range
 * upstream drift surfaces as a contract failure instead of being silently coerced to null.
 *
 * @param name - Field name, used in the failure reason.
 */
function validateOptionalString(v: unknown, name: string): Result<string | null, string> {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v === "string") return { ok: true, value: v };
  return { ok: false, reason: `\`${name}\` is present but not a string or null` };
}

function isNonNegativeInteger(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function isPositiveInteger(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1;
}

/**
 * Resolve a byte-range span against the cached source, returning position info + UTF-8 text.
 *
 * End position is inclusive (points to the last byte of the span, 1-origin). Zero-length spans
 * collapse end → start.
 */
function resolveSpan(
  cache: SourceCache,
  filename: string,
  offset: number,
  length: number,
): {
  text: string;
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
} | null {
  const entry = cache.get(filename);
  if (entry === null) return null;
  const { buffer, lineStartOffsets } = entry;
  if (offset < 0 || length < 0 || offset + length > buffer.length) return null;

  const text = buffer.subarray(offset, offset + length).toString("utf8");
  const start = findLine(lineStartOffsets, offset);
  const startLine = start.line;
  const startCol = offset - start.lineStart + 1;
  const lastByte = length > 0 ? offset + length - 1 : offset;
  const end = findLine(lineStartOffsets, lastByte);
  const endLine = end.line;
  const endCol = length > 0 ? lastByte - end.lineStart + 1 : startCol;
  return { text, startLine, startCol, endLine, endCol };
}

/**
 * Extract the first line, truncate if too long,
 * and append a multi-line marker if more lines follow.
 */
function formatCodeSlice(text: string): { text: string; truncated: boolean } {
  const nlIdx = text.search(/\r?\n/);
  const hasMoreLines = nlIdx !== -1;
  const rawFirstLine = hasMoreLines ? text.slice(0, nlIdx) : text;
  // Strip a trailing CR left when the span ends exactly at the CR of a CRLF
  // pair (the LF that the regex would otherwise consume is outside the span).
  const firstLine = rawFirstLine.replace(/\r$/, "");
  // Iterate as Unicode code points (not UTF-16 units) so e.g. "𠮷" counts as 1.
  const codePoints = Array.from(firstLine);
  if (codePoints.length > SLICE_MAX_LEN) {
    return { text: `${codePoints.slice(0, SLICE_MAX_LEN).join("")}...`, truncated: true };
  }
  if (hasMoreLines) {
    return { text: `${firstLine} ...`, truncated: true };
  }
  return { text: firstLine, truncated: false };
}

function compareDiagnostics(a: ResolvedDiagnostic, b: ResolvedDiagnostic): number {
  if (a.filename !== b.filename) return a.filename < b.filename ? -1 : 1;
  if (a.sortLine !== b.sortLine) return a.sortLine - b.sortLine;
  if (a.sortCol !== b.sortCol) return a.sortCol - b.sortCol;
  if (a.errorCode !== b.errorCode) return a.errorCode < b.errorCode ? -1 : 1;
  return 0;
}

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

/**
 * Render a single diagnostic as the head line (`<location> <message> [<error-code>]`)
 * followed by a source-slice continuation line. Newlines inside `message` collapse to
 * a single space so the head line stays on one line.
 */
function formatDiagLine(d: ResolvedDiagnostic): string {
  const message = d.message.replace(/\r?\n/g, " ");
  const headLine = `  ${d.location} ${message} [${d.errorCode}]`;
  return `${headLine}\n    ${d.slice}`;
}

function renderWeakTypingsHint(docPath: string): string[] {
  return [
    "Hint on the `no-unsafe-*` diagnostics:",
    "- Remedies: `*.d.ts` augmentation, `unknown` + type predicates, or boundary module with typed wrappers.",
    "- Inline disable (`// oxlint-disable-next-line`) is not a fix; use only when explicitly permitted by the project maintainer.",
    `- See: ${docPath}`,
  ];
}
