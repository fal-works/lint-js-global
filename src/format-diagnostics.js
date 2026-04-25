// @ts-check

import { readFileSync } from "node:fs";

/**
 * LLM-friendly formatter for oxlint's `--format=json` output.
 * See `dev/records/011-llm-diagnostic-format-spec.md` for the specification.
 */

const LEGEND = "diagnostic legend: <location> `<code-slice>` [<rule-name>]";
const SLICE_MAX_LEN = 40;
const UNREADABLE_SLICE = "<unreadable>";
const UNSAFE_CODE_PATTERN = /^typescript-eslint\(no-unsafe-/;

/**
 * @typedef {{
 *   filename: string;
 *   rawCode: string | null;
 *   message: string;
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
 * Entry point: takes raw oxlint JSON-format stdout and returns the formatted payload.
 *
 * Not a strictly pure function (reads source files to resolve spans), but performs
 * no stdout/stderr output — the caller decides when and where to emit.
 *
 * @param {object} options
 * @param {string} options.capturedStdout Raw oxlint stdout from `--format=json`.
 * @param {boolean} options.unix If true, pass through unchanged (no legend, no hint, no summary).
 * @param {string} options.weakTypingsDocPath Absolute path used in the weak-typings hint.
 * @returns {{ formattedStdout: string; linterSummary: string | null }}
 */
export function formatLintOutput({ capturedStdout, unix, weakTypingsDocPath }) {
  if (unix) {
    return { formattedStdout: capturedStdout, linterSummary: null };
  }

  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(capturedStdout);
  } catch {
    // Broken JSON: relay oxlint's raw output verbatim and let the overall
    // `lint-js:` summary flag the failure via non-zero exit code.
    return { formattedStdout: capturedStdout, linterSummary: null };
  }

  const rawDiagnostics = extractDiagnostics(parsed);
  if (rawDiagnostics.length === 0) {
    return { formattedStdout: "", linterSummary: null };
  }

  const cache = createSourceCache();
  const resolved = rawDiagnostics.map((d) => resolveDiagnostic(d, cache));
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
  return { formattedStdout, linterSummary };
}

/**
 * @param {unknown} parsed
 * @returns {unknown[]}
 */
function extractDiagnostics(parsed) {
  if (typeof parsed !== "object" || parsed === null) return [];
  const diags = /** @type {{ diagnostics?: unknown }} */ (parsed).diagnostics;
  return Array.isArray(diags) ? diags : [];
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
 * @param {unknown} diag
 * @param {ReturnType<typeof createSourceCache>} cache
 * @returns {ResolvedDiagnostic}
 */
function resolveDiagnostic(diag, cache) {
  const d = isObject(diag) ? diag : {};
  const filename = typeof d.filename === "string" ? d.filename : "<unknown>";
  const rawCode = typeof d.code === "string" ? d.code : null;
  const message = typeof d.message === "string" ? d.message : "";
  const span = extractFirstSpan(d);
  const ruleName = extractRuleName(rawCode, message);

  // Reported position from oxlint (start only). Used as sort key and fallback location.
  const reportedLine = span !== null && typeof span.line === "number" ? span.line : 1;
  const reportedCol = span !== null && typeof span.column === "number" ? span.column : 1;

  if (span !== null && typeof span.offset === "number" && typeof span.length === "number") {
    const resolved = resolveSpan(cache, filename, span.offset, span.length);
    if (resolved !== null) {
      const slice = formatCodeSlice(resolved.text);
      const location = slice.truncated
        ? `${resolved.startLine}:${resolved.startCol}-${resolved.endLine}:${resolved.endCol}`
        : `${resolved.startLine}:${resolved.startCol}`;
      return {
        filename,
        rawCode,
        message,
        sortLine: resolved.startLine,
        sortCol: resolved.startCol,
        ruleName,
        location,
        slice: slice.text,
      };
    }
  }

  // Fallback: source unreadable or span out-of-bounds. Preserve start position from oxlint.
  return {
    filename,
    rawCode,
    message,
    sortLine: reportedLine,
    sortCol: reportedCol,
    ruleName,
    location: `${reportedLine}:${reportedCol}`,
    slice: UNREADABLE_SLICE,
  };
}

/**
 * @param {Record<string, unknown>} diag
 * @returns {Record<string, unknown> | null}
 */
function extractFirstSpan(diag) {
  const labels = diag.labels;
  if (!isUnknownArray(labels) || labels.length === 0) return null;
  const first = labels[0];
  if (!isObject(first)) return null;
  const span = first.span;
  if (!isObject(span)) return null;
  return span;
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
 * Per spec §3.3: strip the plugin prefix and use the inner rule ID.
 * Per agreed design: if `code` is absent, use `(message)` with the full message, newlines stripped.
 *
 * @param {string | null} rawCode
 * @param {string} message
 * @returns {string}
 */
function extractRuleName(rawCode, message) {
  if (rawCode === null) return `(${message.replace(/\r?\n/g, " ")})`;
  const match = /\(([^)]+)\)\s*$/.exec(rawCode);
  return match ? match[1] : rawCode;
}

/**
 * Per spec §3.2: extract first line, truncate if too long, append multi-line marker.
 *
 * Handles both LF and CRLF source files: the regex split discards a CR that
 * pairs with the next LF, and the trailing-CR strip covers the edge case where
 * a span ends exactly at the CR of a CRLF pair (no following LF inside the span).
 *
 * @param {string} text
 * @returns {{ text: string; truncated: boolean }}
 */
function formatCodeSlice(text) {
  const nlIdx = text.search(/\r?\n/);
  const hasMoreLines = nlIdx !== -1;
  const rawFirstLine = hasMoreLines ? text.slice(0, nlIdx) : text;
  const firstLine = rawFirstLine.replace(/\r$/, "");
  // Iterate as Unicode code points (not UTF-16 units) so e.g. "𠮷" counts as 1.
  const codePoints = Array.from(firstLine);
  if (codePoints.length > SLICE_MAX_LEN) {
    // Rule 2: hard truncate, no leading space before "...".
    // Applies regardless of whether more lines follow.
    return { text: `${codePoints.slice(0, SLICE_MAX_LEN).join("")}...`, truncated: true };
  }
  if (hasMoreLines) {
    // Rule 3: first line fits but there are more lines — append " ..." with a leading space.
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
  return `  ${d.location} \`${d.slice}\` [${d.ruleName}]`;
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
