import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { createSourceCache, resolveSpan } from "./source.ts";

/**
 * Make a temp dir that gets cleaned up at test teardown, and pre-populate source files into it.
 */
function setupFixture(t: TestContext, sources: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "lint-js-source-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [relPath, content] of Object.entries(sources)) {
    writeFileSync(join(dir, relPath), content);
  }
  return dir;
}

void test("resolveSpan: happy path on LF source returns text and 1-origin L:C", (t) => {
  const dir = setupFixture(t, { "x.ts": "const x = 1;\nconst y = 2;\n" });
  const cache = createSourceCache(dir);

  // "const y" starts at byte 13 (after "const x = 1;\n").
  const result = resolveSpan(cache, join(dir, "x.ts"), 13, 7);

  assert.deepEqual(result, {
    text: "const y",
    startLine: 2,
    startCol: 1,
    endLine: 2,
    endCol: 7,
  });
});

void test("resolveSpan: start column counts bytes (not code points) for multi-byte preceding chars", (t) => {
  // Source: "// あ = 'いう';\n"
  // Bytes:  0='/' 1='/' 2=' ' 3..5=あ 6=' ' 7='=' 8=' ' 9='\'' 10..12=い 13..15=う 16='\'' 17=';' 18='\n'
  // Span over "'いう'": offset 9, length 8.
  const dir = setupFixture(t, { "x.ts": "// あ = 'いう';\n" });
  const cache = createSourceCache(dir);

  const result = resolveSpan(cache, join(dir, "x.ts"), 9, 8);

  // startCol = 9 - 0 + 1 = 10 (byte-based; char-based would be 8).
  assert.equal(result?.text, "'いう'");
  assert.equal(result?.startLine, 1);
  assert.equal(result?.startCol, 10);
});

void test("resolveSpan: end column counts bytes across a multi-line span ending in multi-byte chars", (t) => {
  // Line 1: "x = 0;\n"        (bytes 0..6, line 2 starts at byte 7)
  // Line 2: "// あいう\n"      (bytes 7..19; "う" occupies 16..18)
  const src = "x = 0;\n// あいう\n";
  const dir = setupFixture(t, { "x.ts": src });
  const cache = createSourceCache(dir);

  // Span ending at the last byte of "う" (byte 18).
  const result = resolveSpan(cache, join(dir, "x.ts"), 0, 19);

  // endCol = 18 - 7 + 1 = 12 (byte-based; char-based would be 6).
  assert.equal(result?.endLine, 2);
  assert.equal(result?.endCol, 12);
});

void test("resolveSpan: CRLF source builds line index from LF byte only", (t) => {
  // CRLF: line 1 = "foo\r\n" (bytes 0..4), line 2 starts at byte 5.
  const dir = setupFixture(t, { "x.ts": "foo\r\nbar\r\n" });
  const cache = createSourceCache(dir);

  // Span over "bar": offset 5, length 3.
  const result = resolveSpan(cache, join(dir, "x.ts"), 5, 3);

  assert.equal(result?.text, "bar");
  assert.equal(result?.startLine, 2);
  assert.equal(result?.startCol, 1);
  assert.equal(result?.endLine, 2);
  assert.equal(result?.endCol, 3);
});

void test("resolveSpan: zero-length span collapses end → start", (t) => {
  const dir = setupFixture(t, { "x.ts": "const x = 1;\n" });
  const cache = createSourceCache(dir);

  const result = resolveSpan(cache, join(dir, "x.ts"), 6, 0);

  assert.equal(result?.text, "");
  assert.equal(result?.startLine, 1);
  assert.equal(result?.startCol, 7);
  assert.equal(result?.endLine, 1);
  assert.equal(result?.endCol, 7);
});

void test("resolveSpan: out-of-bounds span returns null", (t) => {
  const dir = setupFixture(t, { "x.ts": "abc\n" });
  const cache = createSourceCache(dir);

  // length exceeds buffer
  assert.equal(resolveSpan(cache, join(dir, "x.ts"), 0, 9999), null);
  // offset past end
  assert.equal(resolveSpan(cache, join(dir, "x.ts"), 100, 1), null);
});

void test("resolveSpan: missing file returns null without throwing", () => {
  const cache = createSourceCache("/");

  assert.equal(resolveSpan(cache, "/nonexistent/path/to/file.ts", 0, 1), null);
});
