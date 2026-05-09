import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

/**
 * Source-buffer cache keyed by filename, with a precomputed line-start index for fast L:C lookup.
 */
export interface SourceCache {
  get(filename: string): SourceEntry | null;
}

interface SourceEntry {
  buffer: Buffer;
  lineStartOffsets: number[];
}

/**
 * Build a cache that lazily reads files relative to `cwd` and indexes line starts on first read.
 * Subsequent reads of the same path (including failures) are memoised.
 */
export function createSourceCache(cwd: string): SourceCache {
  const cache = new Map<string, SourceEntry | null>();
  return {
    get(filename) {
      const cached = cache.get(filename);
      if (cached !== undefined) return cached;
      try {
        const path = isAbsolute(filename) ? filename : resolve(cwd, filename);
        const buffer = readFileSync(path);
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
 * Resolve a byte-range span against the cached source, returning position info + UTF-8 text.
 *
 * Inputs (`offset`, `length`) are byte units, matching oxlint's native span representation.
 * Output columns (`startCol`, `endCol`) are 1-origin UTF-16 code units.
 *
 * End position is inclusive (points to the last code unit of the span, 1-origin).
 * Zero-length spans collapse end → start.
 * Returns `null` when the source is unreadable or the span is out-of-bounds.
 */
export function resolveSpan(
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
  const startCol = utf16LengthInLine(buffer, start.lineStart, offset) + 1;
  const lastByte = length > 0 ? offset + length - 1 : offset;
  const end = findLine(lineStartOffsets, lastByte);
  const endLine = end.line;
  const endCol = length > 0 ? utf16LengthInLine(buffer, end.lineStart, offset + length) : startCol;
  return { text, startLine, startCol, endLine, endCol };
}

/**
 * UTF-16 code unit length of the line slice `[lineStart, byteEnd)`.
 */
function utf16LengthInLine(buffer: Buffer, lineStart: number, byteEnd: number): number {
  return buffer.subarray(lineStart, byteEnd).toString("utf8").length;
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
