import assert from "node:assert/strict";
import test from "node:test";

import { formatCodeSlice } from "./code-slice.ts";

void test("formatCodeSlice: short single-line text passes through unchanged", () => {
  assert.deepEqual(formatCodeSlice("debugger"), { text: "debugger", truncated: false });
});

void test("formatCodeSlice: long single line truncates at 40 code points with '...'", () => {
  const long = "a".repeat(45);
  assert.deepEqual(formatCodeSlice(long), {
    text: `${"a".repeat(40)}...`,
    truncated: true,
  });
});

void test("formatCodeSlice: multi-line text with first line ≤40 chars gets the ' ...' marker", () => {
  const result = formatCodeSlice("function foo() {\n  return 1;\n}");
  assert.deepEqual(result, { text: "function foo() { ...", truncated: true });
});

void test("formatCodeSlice: multi-line text with first line >40 chars truncates and suppresses the marker", () => {
  // Long first line (50 chars) → first-line length truncation takes precedence; no " ..." appended.
  const text = `${"a".repeat(50)}\nmore`;
  assert.deepEqual(formatCodeSlice(text), {
    text: `${"a".repeat(40)}...`,
    truncated: true,
  });
});

void test("formatCodeSlice: CRLF inside the span strips the trailing CR before ' ...'", () => {
  // First line with embedded CR (\r\n linebreak) — the CR must not survive into the rendered slice.
  assert.deepEqual(formatCodeSlice("foo bar\r\nbaz"), {
    text: "foo bar ...",
    truncated: true,
  });
});

void test("formatCodeSlice: span ending exactly at CR strips the trailing CR", () => {
  // Span text "foo\r" — no LF inside the span, so no multi-line marker, but the CR must strip.
  assert.deepEqual(formatCodeSlice("foo\r"), { text: "foo", truncated: false });
});

void test("formatCodeSlice: counts code points (not UTF-16 units) when truncating non-BMP chars", () => {
  // "𠮷" is U+20BB7: 4 bytes UTF-8, 1 code point, but a UTF-16 surrogate pair (length 2).
  // 41× "𠮷" must truncate to first 40 + "..." (a UTF-16-naive impl would split a surrogate pair).
  const text = "𠮷".repeat(41);
  assert.deepEqual(formatCodeSlice(text), {
    text: `${"𠮷".repeat(40)}...`,
    truncated: true,
  });
});
