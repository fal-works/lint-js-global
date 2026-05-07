import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import {
  formatCodeSlice,
  PARSE_ERROR_CODE,
  resolveDiagnostic,
  UNREADABLE_SLICE,
} from "../../../src/format-diagnostics/resolve.ts";
import type { ValidatedDiagnostic } from "../../../src/oxlint-json-schema.ts";
import { createSourceCache } from "../../../src/source.ts";
import { setupFixture } from "./_helpers.ts";

function makeValidated(overrides: Partial<ValidatedDiagnostic> = {}): ValidatedDiagnostic {
  return {
    filename: "/x.ts",
    code: "eslint(no-debugger)",
    message: "msg",
    span: { offset: 0, length: 8, line: 1, column: 1 },
    ...overrides,
  };
}

void test("resolveDiagnostic: happy path uses source slice + L:C", (t) => {
  const dir = setupFixture(t, { "x.ts": "debugger;\n" });
  const file = join(dir, "x.ts");
  const cache = createSourceCache(dir);

  const result = resolveDiagnostic(makeValidated({ filename: file }), cache);

  assert.equal(result.filename, file);
  assert.equal(result.errorCode, "eslint(no-debugger)");
  assert.equal(result.message, "msg");
  assert.equal(result.location, "1:1");
  assert.equal(result.slice, "debugger");
  assert.equal(result.sortLine, 1);
  assert.equal(result.sortCol, 1);
});

void test("resolveDiagnostic: null code is replaced with the parse-error placeholder", (t) => {
  const dir = setupFixture(t, { "x.ts": "const x = ;\n" });
  const file = join(dir, "x.ts");
  const cache = createSourceCache(dir);

  const result = resolveDiagnostic(
    makeValidated({
      filename: file,
      code: null,
      span: { offset: 10, length: 1, line: 1, column: 11 },
    }),
    cache,
  );

  assert.equal(result.errorCode, PARSE_ERROR_CODE);
  assert.equal(result.slice, ";");
});

void test("resolveDiagnostic: unreadable source falls back to validator-reported L:C and placeholder slice", () => {
  const cache = createSourceCache("/");
  const result = resolveDiagnostic(
    makeValidated({
      filename: "/nonexistent/path/to/file.ts",
      span: { offset: 0, length: 8, line: 3, column: 5 },
    }),
    cache,
  );

  assert.equal(result.location, "3:5");
  assert.equal(result.slice, UNREADABLE_SLICE);
  assert.equal(result.sortLine, 3);
  assert.equal(result.sortCol, 5);
});

void test("resolveDiagnostic: out-of-bounds span falls back the same way", (t) => {
  const dir = setupFixture(t, { "x.ts": "debugger;\n" });
  const file = join(dir, "x.ts");
  const cache = createSourceCache(dir);

  const result = resolveDiagnostic(
    makeValidated({
      filename: file,
      span: { offset: 0, length: 9999, line: 1, column: 1 },
    }),
    cache,
  );

  assert.equal(result.location, "1:1");
  assert.equal(result.slice, UNREADABLE_SLICE);
});

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
  // Long first line (50 chars) → byte-truncation form takes precedence; no " ..." appended.
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
