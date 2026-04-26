// @ts-check

import { readFileSync } from "node:fs";

/**
 * LLM-friendly formatter for oxlint's `--format=json` output.
 * See `dev/records/011-llm-diagnostic-format-spec.md` for the specification.
 */

const LEGEND = "diagnostic legend: <location> <code-slice> [<rule-name>]";
const SLICE_MAX_LEN = 40;
const UNREADABLE_SLICE = "<unreadable>";
const UNSAFE_CODE_PATTERN = /^typescript-eslint\(no-unsafe-/;

/**
 * Per-diagnostic shape after schema validation. Only fields the wrapper
 * consumes are kept.
 *
 * `code` and `message` are both nullable, but the validator guarantees at
 * least one is non-null.
 *
 * @typedef {{
 *   filename: string;
 *   code: string | null;
 *   message: string | null;
 *   span: { offset: number; length: number; line: number; column: number };
 * }} ValidatedDiagnostic
 */

/**
 * @typedef {{
 *   filename: string;
 *   rawCode: string | null;
 *   sortLine: number;
 *   sortCol: number;
 *   ruleName: string;
 *   location: string;
 *   slice: string;
 * }} ResolvedDiagnostic
 */

/**
 * @typedef {{
 *   buffer: Buffer;
 *   lineStartOffsets: number[];
 * }} SourceEntry
 */

/**
 * Result of {@link formatLintOutput}.
 *
 * `schemaMismatch` is non-null when the captured stdout parsed as JSON but
 * its shape diverges from the wrapper's contract. `reason` names the
 * offending field. In that case `formattedStdout` carries the raw stdout for
 * relay and `linterSummary` is null.
 *
 * @typedef {{
 *   formattedStdout: string;
 *   linterSummary: string | null;
 *   schemaMismatch: { reason: string } | null;
 * }} FormatLintResult
 */

/**
 * Format raw oxlint JSON stdout into the LLM-friendly payload.
 *
 * No stdout/stderr emission; the caller decides when and where to write. May
 * read source files to resolve span positions.
 *
 * @param {object} options
 * @param {string} options.capturedStdout Raw oxlint stdout from `--format=json`.
 * @param {boolean} options.unix If true, pass through unchanged (no legend, no hint, no summary).
 * @param {string} options.weakTypingsDocPath Absolute path used in the weak-typings hint.
 * @returns {FormatLintResult}
 */
export function formatLintOutput({ capturedStdout, unix, weakTypingsDocPath }) {
  if (unix) {
    return { formattedStdout: capturedStdout, linterSummary: null, schemaMismatch: null };
  }

  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(capturedStdout);
  } catch {
    // Broken JSON: relay oxlint's raw output verbatim and let the overall
    // `lint-js:` summary flag the failure via non-zero exit code.
    return { formattedStdout: capturedStdout, linterSummary: null, schemaMismatch: null };
  }

  const validation = validatePayload(parsed);
  if (!validation.ok) {
    return {
      formattedStdout: capturedStdout,
      linterSummary: null,
      schemaMismatch: { reason: validation.reason },
    };
  }
  const validated = validation.diagnostics;
  if (validated.length === 0) {
    return { formattedStdout: "", linterSummary: null, schemaMismatch: null };
  }

  const cache = createSourceCache();
  const resolved = validated.map((d) => resolveDiagnostic(d, cache));
  resolved.sort(compareDiagnostics);

  const fileGroups = groupByFilename(resolved);

  /** @type {string[][]} */
  const sections = [[LEGEND]];
  for (const [filename, diags] of fileGroups) {
    sections.push([filename, ...diags.map(formatDiagLine)]);
  }

  const hasUnsafe = resolved.some((d) => d.rawCode !== null && UNSAFE_CODE_PATTERN.test(d.rawCode));
  if (hasUnsafe) {
    sections.push(renderWeakTypingsHint(weakTypingsDocPath));
  }

  const formattedStdout = `${sections.map((s) => s.join("\n")).join("\n\n")}\n`;
  const issueWord = resolved.length === 1 ? "issue" : "issues";
  const fileWord = fileGroups.size === 1 ? "file" : "files";
  const linterSummary = `Found ${resolved.length} unfixed ${issueWord} in ${fileGroups.size} ${fileWord}.`;
  return { formattedStdout, linterSummary, schemaMismatch: null };
}

/**
 * Validate the parsed oxlint payload against the {@link ValidatedDiagnostic} contract.
 *
 * Stops at the first mismatch so shape drift surfaces as a contract error
 * rather than averaging out across silently-degraded entries.
 *
 * @param {unknown} parsed
 * @returns {{ ok: true; diagnostics: ValidatedDiagnostic[] } | { ok: false; reason: string }}
 */
function validatePayload(parsed) {
  if (!isObject(parsed)) return { ok: false, reason: "top-level value is not an object" };
  const diagnostics = parsed.diagnostics;
  if (!isUnknownArray(diagnostics)) {
    return { ok: false, reason: "`diagnostics` is missing or not an array" };
  }
  /** @type {ValidatedDiagnostic[]} */
  const validated = [];
  for (let i = 0; i < diagnostics.length; i++) {
    const result = validateDiagnostic(diagnostics[i]);
    if (!result.ok) return { ok: false, reason: `diagnostics[${i}]: ${result.reason}` };
    validated.push(result.value);
  }
  return { ok: true, diagnostics: validated };
}

/**
 * Validate a single oxlint diagnostic entry.
 *
 * @param {unknown} diag
 * @returns {{ ok: true; value: ValidatedDiagnostic } | { ok: false; reason: string }}
 */
function validateDiagnostic(diag) {
  if (!isObject(diag)) return { ok: false, reason: "not an object" };
  if (typeof diag.filename !== "string") {
    return { ok: false, reason: "`filename` is missing or not a string" };
  }
  const code = typeof diag.code === "string" ? diag.code : null;
  const message = typeof diag.message === "string" ? diag.message : null;
  if (code === null && message === null) {
    return { ok: false, reason: "neither `code` nor `message` is a string" };
  }
  if (!isUnknownArray(diag.labels) || diag.labels.length === 0) {
    return { ok: false, reason: "`labels` is missing or empty" };
  }
  // Reduce multi-label entries to `labels[0]`. Typical extras are duplicate
  // pointers to the same slice.
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

/**
 * @returns {{ get(filename: string): SourceEntry | null }}
 */
function createSourceCache() {
  /** @type {Map<string, SourceEntry | null>} */
  const cache = new Map();
  return {
    get(filename) {
      const cached = cache.get(filename);
      if (cached !== undefined) return cached;
      try {
        const buffer = readFileSync(filename);
        /** @type {SourceEntry} */
        const entry = { buffer, lineStartOffsets: buildLineStartOffsets(buffer) };
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
 *
 * @param {Buffer} buffer
 * @returns {number[]}
 */
function buildLineStartOffsets(buffer) {
  const offsets = [0];
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === 0x0a) offsets.push(i + 1);
  }
  return offsets;
}

/**
 * Binary-search for the 1-origin line whose start offset is the greatest one ≤ `offset`.
 *
 * @param {number[]} lineStartOffsets
 * @param {number} offset
 * @returns {number}
 */
function findLine(lineStartOffsets, offset) {
  let lo = 0;
  let hi = lineStartOffsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStartOffsets[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/**
 * Resolve a validated diagnostic against the source cache. Falls back when
 * the source is unreadable or the span is out-of-bounds.
 *
 * @param {ValidatedDiagnostic} diag
 * @param {ReturnType<typeof createSourceCache>} cache
 * @returns {ResolvedDiagnostic}
 */
function resolveDiagnostic(diag, cache) {
  const ruleName = extractRuleName(diag.code, diag.message);
  const resolved = resolveSpan(cache, diag.filename, diag.span.offset, diag.span.length);
  if (resolved !== null) {
    const slice = formatCodeSlice(resolved.text);
    const location = slice.truncated
      ? `${resolved.startLine}:${resolved.startCol}-${resolved.endLine}:${resolved.endCol}`
      : `${resolved.startLine}:${resolved.startCol}`;
    return {
      filename: diag.filename,
      rawCode: diag.code,
      sortLine: resolved.startLine,
      sortCol: resolved.startCol,
      ruleName,
      location,
      slice: slice.text,
    };
  }

  return {
    filename: diag.filename,
    rawCode: diag.code,
    sortLine: diag.span.line,
    sortCol: diag.span.column,
    ruleName,
    location: `${diag.span.line}:${diag.span.column}`,
    slice: UNREADABLE_SLICE,
  };
}

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isObject(v) {
  return typeof v === "object" && v !== null;
}

/**
 * Type-guard wrapper for `Array.isArray` that narrows to `unknown[]` instead of `any[]`.
 *
 * @param {unknown} v
 * @returns {v is unknown[]}
 */
function isUnknownArray(v) {
  return Array.isArray(v);
}

/**
 * @param {unknown} v
 * @returns {v is number}
 */
function isNonNegativeInteger(v) {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

/**
 * @param {unknown} v
 * @returns {v is number}
 */
function isPositiveInteger(v) {
  return typeof v === "number" && Number.isInteger(v) && v >= 1;
}

/**
 * Resolve a byte-range span against the cached source, returning position info + UTF-8 text.
 *
 * End position is inclusive (points to the last byte of the span, 1-origin). Zero-length spans
 * collapse end → start.
 *
 * @param {ReturnType<typeof createSourceCache>} cache
 * @param {string} filename
 * @param {number} offset
 * @param {number} length
 * @returns {{
 *   text: string;
 *   startLine: number;
 *   startCol: number;
 *   endLine: number;
 *   endCol: number;
 * } | null}
 */
function resolveSpan(cache, filename, offset, length) {
  const entry = cache.get(filename);
  if (entry === null) return null;
  const { buffer, lineStartOffsets } = entry;
  if (offset < 0 || length < 0 || offset + length > buffer.length) return null;

  const text = buffer.subarray(offset, offset + length).toString("utf8");
  const startLine = findLine(lineStartOffsets, offset);
  const startCol = offset - lineStartOffsets[startLine - 1] + 1;
  const lastByte = length > 0 ? offset + length - 1 : offset;
  const endLine = findLine(lineStartOffsets, lastByte);
  const endCol = length > 0 ? lastByte - lineStartOffsets[endLine - 1] + 1 : startCol;
  return { text, startLine, startCol, endLine, endCol };
}

/**
 * Strip the plugin prefix from `rawCode` and return the inner rule ID. When
 * `rawCode` is null, fall back to `(message)` with newlines collapsed.
 *
 * @param {string | null} rawCode
 * @param {string | null} message
 * @returns {string}
 */
function extractRuleName(rawCode, message) {
  if (rawCode === null) return `(${(message ?? "").replace(/\r?\n/g, " ")})`;
  const match = /\(([^)]+)\)\s*$/.exec(rawCode);
  return match ? match[1] : rawCode;
}

/**
 * Extract the first line of a span, truncate if too long, and append a
 * multi-line marker if more lines follow.
 *
 * @param {string} text
 * @returns {{ text: string; truncated: boolean }}
 */
function formatCodeSlice(text) {
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

/**
 * @param {ResolvedDiagnostic} a
 * @param {ResolvedDiagnostic} b
 * @returns {number}
 */
function compareDiagnostics(a, b) {
  if (a.filename !== b.filename) return a.filename < b.filename ? -1 : 1;
  if (a.sortLine !== b.sortLine) return a.sortLine - b.sortLine;
  if (a.sortCol !== b.sortCol) return a.sortCol - b.sortCol;
  if (a.ruleName !== b.ruleName) return a.ruleName < b.ruleName ? -1 : 1;
  return 0;
}

/**
 * @param {ResolvedDiagnostic[]} resolved
 * @returns {Map<string, ResolvedDiagnostic[]>}
 */
function groupByFilename(resolved) {
  /** @type {Map<string, ResolvedDiagnostic[]>} */
  const map = new Map();
  for (const d of resolved) {
    const arr = map.get(d.filename);
    if (arr !== undefined) arr.push(d);
    else map.set(d.filename, [d]);
  }
  return map;
}

/**
 * @param {ResolvedDiagnostic} d
 * @returns {string}
 */
function formatDiagLine(d) {
  return `  ${d.location} ${d.slice} [${d.ruleName}]`;
}

/**
 * @param {string} docPath
 * @returns {string[]}
 */
function renderWeakTypingsHint(docPath) {
  return [
    "Hint on the `no-unsafe-*` diagnostics:",
    "- Remedies: `*.d.ts` augmentation, `unknown` + type predicates, or boundary module with typed wrappers.",
    "- Inline disable (`// oxlint-disable-next-line`) is not a fix; use only when explicitly permitted by the project maintainer.",
    `- See: ${docPath}`,
  ];
}
