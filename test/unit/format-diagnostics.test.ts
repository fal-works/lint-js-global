import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { formatLintOutput } from "../../src/format-diagnostics.ts";

const HINT_PATH = "/opt/lint-js/docs/guide/weak-typings.md";

interface FakeDiag {
  message: string;
  code?: string | null;
  severity?: string;
  filename: string;
  labels: Array<{ span: { offset: number; length: number; line: number; column: number } }>;
}

/**
 * Wrap an array of fake diagnostics into the `{ "diagnostics": [...], ... }` shape
 * that oxlint emits from `--format=json`.
 */
function makeStdout(diagnostics: FakeDiag[]): string {
  return JSON.stringify({
    diagnostics,
    number_of_files: 1,
    number_of_rules: 1,
    threads_count: 1,
    start_time: 0,
  });
}

/**
 * Make a temp dir that gets cleaned up at test teardown, and pre-populate source files into it.
 */
function setupFixture(t: TestContext, sources: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "lint-js-fmt-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [relPath, content] of Object.entries(sources)) {
    writeFileSync(join(dir, relPath), content);
  }
  return dir;
}

/**
 * Assemble an expected formatted-stdout string from section arrays.
 */
function joinSections(sections: string[][]): string {
  return `${sections.map((s) => s.join("\n")).join("\n\n")}\n`;
}

void test("single file, single diagnostic (short single-line slice)", (t) => {
  const dir = setupFixture(t, { "x.ts": "debugger;\n" });
  const file = join(dir, "x.ts");
  const stdout = makeStdout([
    {
      message: "`debugger` statement is not allowed.",
      code: "eslint(no-debugger)",
      severity: "error",
      filename: file,
      labels: [{ span: { offset: 0, length: 8, line: 1, column: 1 } }],
    },
  ]);

  const result = formatLintOutput({
    capturedStdout: stdout,
    unix: false,
    weakTypingsDocPath: HINT_PATH,
  });

  assert.equal(
    result.formattedStdout,
    joinSections([
      [file, "  1:1 `debugger` statement is not allowed. [eslint(no-debugger)]", "    debugger"],
    ]),
  );
  assert.equal(result.linterSummary, "Found 1 unfixed issue in 1 file.");
});

void test("single file, multiple diagnostics sort by (line, col, error-code)", (t) => {
  // Line layout: `const x = 1;\n` (13 bytes), `const y = 2;\n` (13), `debugger;\n`.
  //   - "x" at byte 6 (col 7), "y" at byte 13+6 = 19 (col 7), "debugger" at byte 26 (col 1).
  const dir = setupFixture(t, {
    "a.ts": "const x = 1;\nconst y = 2;\ndebugger;\n",
  });
  const file = join(dir, "a.ts");
  // Feed them in non-sorted order.
  const stdout = makeStdout([
    {
      message: "d",
      code: "eslint(no-debugger)",
      severity: "error",
      filename: file,
      labels: [{ span: { offset: 26, length: 8, line: 3, column: 1 } }],
    },
    {
      message: "b",
      code: "eslint(no-unused-vars)",
      severity: "error",
      filename: file,
      labels: [{ span: { offset: 19, length: 1, line: 2, column: 7 } }],
    },
    {
      message: "a",
      code: "eslint(no-unused-vars)",
      severity: "error",
      filename: file,
      labels: [{ span: { offset: 6, length: 1, line: 1, column: 7 } }],
    },
  ]);

  const result = formatLintOutput({
    capturedStdout: stdout,
    unix: false,
    weakTypingsDocPath: HINT_PATH,
  });

  assert.equal(
    result.formattedStdout,
    joinSections([
      [
        file,
        "  1:7 a [eslint(no-unused-vars)]",
        "    x",
        "  2:7 b [eslint(no-unused-vars)]",
        "    y",
        "  3:1 d [eslint(no-debugger)]",
        "    debugger",
      ],
    ]),
  );
  assert.equal(result.linterSummary, "Found 3 unfixed issues in 1 file.");
});

void test("multiple files sort lexicographically", (t) => {
  const dir = setupFixture(t, {
    "b.ts": "debugger;\n",
    "a.ts": "debugger;\n",
  });
  const fileA = join(dir, "a.ts");
  const fileB = join(dir, "b.ts");
  const stdout = makeStdout([
    {
      message: "d",
      code: "eslint(no-debugger)",
      severity: "error",
      filename: fileB,
      labels: [{ span: { offset: 0, length: 8, line: 1, column: 1 } }],
    },
    {
      message: "d",
      code: "eslint(no-debugger)",
      severity: "error",
      filename: fileA,
      labels: [{ span: { offset: 0, length: 8, line: 1, column: 1 } }],
    },
  ]);

  const result = formatLintOutput({
    capturedStdout: stdout,
    unix: false,
    weakTypingsDocPath: HINT_PATH,
  });

  assert.equal(
    result.formattedStdout,
    joinSections([
      [fileA, "  1:1 d [eslint(no-debugger)]", "    debugger"],
      [fileB, "  1:1 d [eslint(no-debugger)]", "    debugger"],
    ]),
  );
  assert.equal(result.linterSummary, "Found 2 unfixed issues in 2 files.");
});

void test("long single-line slice truncates at 40 characters with no leading space", (t) => {
  // 45 characters of "a" then "=1"
  const line = "a".repeat(45) + " = 1;\n";
  const dir = setupFixture(t, { "x.ts": line });
  const file = join(dir, "x.ts");
  const stdout = makeStdout([
    {
      message: "unused",
      code: "eslint(no-unused-vars)",
      severity: "error",
      filename: file,
      labels: [
        // Span covers the full 45 "a"s.
        { span: { offset: 0, length: 45, line: 1, column: 1 } },
      ],
    },
  ]);

  const result = formatLintOutput({
    capturedStdout: stdout,
    unix: false,
    weakTypingsDocPath: HINT_PATH,
  });

  const truncated = "a".repeat(40) + "...";
  assert.equal(
    result.formattedStdout,
    joinSections([[file, "  1:1-1:45 unused [eslint(no-unused-vars)]", `    ${truncated}`]]),
  );
});

void test("multi-line span with first line ≤40 chars gets the ' ...' multi-line marker", (t) => {
  const src = "function foo() {\n  return 1;\n}\n";
  const dir = setupFixture(t, { "x.ts": src });
  const file = join(dir, "x.ts");
  // Span covers the whole function from 'f' in `function` through the closing `}`.
  // Bytes: offset 0, length 30 (up through the `}`).
  const stdout = makeStdout([
    {
      message: "bad function",
      code: "eslint(some-rule)",
      severity: "error",
      filename: file,
      labels: [{ span: { offset: 0, length: 30, line: 1, column: 1 } }],
    },
  ]);

  const result = formatLintOutput({
    capturedStdout: stdout,
    unix: false,
    weakTypingsDocPath: HINT_PATH,
  });

  assert.equal(
    result.formattedStdout,
    joinSections([
      [file, "  1:1-3:1 bad function [eslint(some-rule)]", "    function foo() { ..."],
    ]),
  );
});

void test("multi-line span with first line >40 chars suppresses the multi-line marker", (t) => {
  // First line: 50 chars of 'a' then a newline.
  const line1 = "a".repeat(50);
  const src = `${line1}\nmore\n`;
  const dir = setupFixture(t, { "x.ts": src });
  const file = join(dir, "x.ts");
  const stdout = makeStdout([
    {
      message: "bad",
      code: "eslint(some-rule)",
      severity: "error",
      filename: file,
      labels: [
        { span: { offset: 0, length: Buffer.byteLength(src, "utf8") - 1, line: 1, column: 1 } },
      ],
    },
  ]);

  const result = formatLintOutput({
    capturedStdout: stdout,
    unix: false,
    weakTypingsDocPath: HINT_PATH,
  });

  const truncated = "a".repeat(40) + "...";
  // End line is 2 (line containing byte at offset length-1 which is 'e' of 'more').
  // End col: byte position within line 2 + 1. Line 2 starts at offset 51 ("more" at 51..54, trailing newline at 55).
  // lastByte = offset 54 (last non-newline byte of 'more' = 'e'); endLine = 2; endCol = 54 - 51 + 1 = 4.
  assert.equal(
    result.formattedStdout,
    joinSections([[file, "  1:1-2:4 bad [eslint(some-rule)]", `    ${truncated}`]]),
  );
});

void test("CRLF source: multi-line span strips the CR before the multi-line marker", (t) => {
  // CRLF ("\r\n" = 2 bytes per break). Source: "foo bar\r\nbaz\r\n" (14 bytes).
  // Span covers "foo bar\r\nbaz" (12 bytes): offset 0, length 12.
  // Without the CRLF-aware fix, firstLine would be "foo bar\r" and the rendered slice
  // would carry an embedded CR before the " ..." multi-line marker.
  const src = "foo bar\r\nbaz\r\n";
  const dir = setupFixture(t, { "x.ts": src });
  const file = join(dir, "x.ts");
  const stdout = makeStdout([
    {
      message: "multi-line crlf",
      code: "eslint(some-rule)",
      severity: "error",
      filename: file,
      labels: [{ span: { offset: 0, length: 12, line: 1, column: 1 } }],
    },
  ]);

  const result = formatLintOutput({
    capturedStdout: stdout,
    unix: false,
    weakTypingsDocPath: HINT_PATH,
  });

  // End line is 2 (last byte of span = 'z' of "baz" at offset 11; line 2 starts at offset 9).
  // endCol = 11 - 9 + 1 = 3.
  assert.equal(
    result.formattedStdout,
    joinSections([[file, "  1:1-2:3 multi-line crlf [eslint(some-rule)]", "    foo bar ..."]]),
  );
});

void test("CRLF source: span ending exactly at CR strips the trailing CR", (t) => {
  // CRLF source. Span deliberately stops at the CR byte (no following LF inside span).
  // Source: "foo\r\nbar\r\n" (10 bytes). Span covers "foo\r": offset 0, length 4.
  const src = "foo\r\nbar\r\n";
  const dir = setupFixture(t, { "x.ts": src });
  const file = join(dir, "x.ts");
  const stdout = makeStdout([
    {
      message: "trailing cr",
      code: "eslint(some-rule)",
      severity: "error",
      filename: file,
      labels: [{ span: { offset: 0, length: 4, line: 1, column: 1 } }],
    },
  ]);

  const result = formatLintOutput({
    capturedStdout: stdout,
    unix: false,
    weakTypingsDocPath: HINT_PATH,
  });

  // Single-line slice (no LF inside span → no multi-line marker), CR stripped.
  // Span text "foo\r" is 4 bytes; lastByte = offset 3 ('\r' on line 1). endCol = 4.
  // truncated = false (length ≤ 40 and no further lines), so location uses `L:C` form.
  assert.equal(
    result.formattedStdout,
    joinSections([[file, "  1:1 trailing cr [eslint(some-rule)]", "    foo"]]),
  );
});

void test("UTF-8 multi-byte span resolves byte offsets correctly", (t) => {
  // "あ" is 3 bytes. Source: "const x = 'あいう';\n"
  // "あいう" = 9 bytes. Let's pick a span around it.
  // Full source bytes: "const x = '" (11) + "あいう" (9) + "';\n" (3) = 23 bytes.
  const src = "const x = 'あいう';\n";
  const dir = setupFixture(t, { "x.ts": src });
  const file = join(dir, "x.ts");
  // Span covers "'あいう'" : starts at byte offset 10 ("'"), length 11 (1+9+1).
  const stdout = makeStdout([
    {
      message: "literal",
      code: "eslint(some-rule)",
      severity: "error",
      filename: file,
      labels: [{ span: { offset: 10, length: 11, line: 1, column: 11 } }],
    },
  ]);

  const result = formatLintOutput({
    capturedStdout: stdout,
    unix: false,
    weakTypingsDocPath: HINT_PATH,
  });

  // "'あいう'" is 5 code points, well under 40; single-line → `L:C` form.
  // startLine=1, startCol = 10 - 0 + 1 = 11 (byte-based).
  assert.equal(
    result.formattedStdout,
    joinSections([[file, "  1:11 literal [eslint(some-rule)]", "    'あいう'"]]),
  );
});

void test("no-unsafe-* diagnostic triggers the weak-typings hint block", (t) => {
  const dir = setupFixture(t, { "x.ts": "const x = foo;\n" });
  const file = join(dir, "x.ts");
  const stdout = makeStdout([
    {
      message: "Unsafe assignment",
      code: "typescript-eslint(no-unsafe-assignment)",
      severity: "error",
      filename: file,
      labels: [{ span: { offset: 6, length: 7, line: 1, column: 7 } }],
    },
  ]);

  const result = formatLintOutput({
    capturedStdout: stdout,
    unix: false,
    weakTypingsDocPath: HINT_PATH,
  });

  assert.equal(
    result.formattedStdout,
    joinSections([
      [file, "  1:7 Unsafe assignment [typescript-eslint(no-unsafe-assignment)]", "    x = foo"],
      [
        "Hint on the `no-unsafe-*` diagnostics:",
        "- Remedies: `*.d.ts` augmentation, `unknown` + type predicates, or boundary module with typed wrappers.",
        "- Inline disable (`// oxlint-disable-next-line`) is not a fix; use only when explicitly permitted by the project maintainer.",
        `- See: ${HINT_PATH}`,
      ],
    ]),
  );
  assert.equal(result.linterSummary, "Found 1 unfixed issue in 1 file.");
});

void test("tsgolint-style typescript(TS\\d+) code is rendered raw inside the brackets", (t) => {
  // tsgolint emits TypeScript compile errors with `code: typescript(TS<NNNN>)`. The whole `code`
  // is passed through as the error-code (no inner-paren extraction), preserving the `typescript`
  // plugin prefix. The bare numeric `TS2591` is opaque on its own, so the head-line message
  // carries the actual diagnostic content.
  const dir = setupFixture(t, { "x.ts": "import 'node:fs';\n" });
  const file = join(dir, "x.ts");
  const stdout = makeStdout([
    {
      message: "Cannot find name 'node:fs'.",
      code: "typescript(TS2591)",
      severity: "error",
      filename: file,
      // 'node:fs' starts at byte 8, length 7
      labels: [{ span: { offset: 8, length: 7, line: 1, column: 9 } }],
    },
  ]);

  const result = formatLintOutput({
    capturedStdout: stdout,
    unix: false,
    weakTypingsDocPath: HINT_PATH,
  });

  assert.equal(
    result.formattedStdout,
    joinSections([[file, "  1:9 Cannot find name 'node:fs'. [typescript(TS2591)]", "    node:fs"]]),
  );
});

void test("newlines in message are collapsed to single spaces on the head line", (t) => {
  const dir = setupFixture(t, { "x.ts": "debugger;\n" });
  const file = join(dir, "x.ts");
  const stdout = makeStdout([
    {
      message: "first line\nsecond line\r\nthird line",
      code: "eslint(no-debugger)",
      severity: "error",
      filename: file,
      labels: [{ span: { offset: 0, length: 8, line: 1, column: 1 } }],
    },
  ]);

  const result = formatLintOutput({
    capturedStdout: stdout,
    unix: false,
    weakTypingsDocPath: HINT_PATH,
  });

  assert.equal(
    result.formattedStdout,
    joinSections([
      [file, "  1:1 first line second line third line [eslint(no-debugger)]", "    debugger"],
    ]),
  );
});

void test("diagnostic without `code` renders as [parse-error]", (t) => {
  const dir = setupFixture(t, { "x.ts": "const x = ;\n" });
  const file = join(dir, "x.ts");
  const stdout = makeStdout([
    {
      // No `code` field — simulate oxc parser error.
      message: "Unexpected token",
      severity: "error",
      filename: file,
      labels: [{ span: { offset: 10, length: 1, line: 1, column: 11 } }],
    },
  ]);

  const result = formatLintOutput({
    capturedStdout: stdout,
    unix: false,
    weakTypingsDocPath: HINT_PATH,
  });

  assert.equal(
    result.formattedStdout,
    joinSections([[file, "  1:11 Unexpected token [parse-error]", "    ;"]]),
  );
});

void test("zero diagnostics yields empty formattedStdout and null linterSummary", () => {
  const stdout = makeStdout([]);

  const result = formatLintOutput({
    capturedStdout: stdout,
    unix: false,
    weakTypingsDocPath: HINT_PATH,
  });

  assert.equal(result.formattedStdout, "");
  assert.equal(result.linterSummary, null);
  assert.equal(result.schemaMismatch, null);
});

void test("valid JSON without `diagnostics` array flags schemaMismatch and relays raw", () => {
  // Simulate a hypothetical schema change (e.g. a fatal payload at the top level).
  const raw = JSON.stringify({ fatal: "internal error", number_of_files: 0 });

  const result = formatLintOutput({
    capturedStdout: raw,
    unix: false,
    weakTypingsDocPath: HINT_PATH,
  });

  assert.equal(
    result.formattedStdout,
    raw,
    "raw payload must be relayed verbatim so the actual cause is visible",
  );
  assert.equal(result.linterSummary, null);
  assert.notEqual(result.schemaMismatch, null);
  assert.match(result.schemaMismatch?.reason ?? "", /diagnostics/);
});

void test("valid JSON with non-array `diagnostics` is treated as schemaMismatch", () => {
  const raw = JSON.stringify({ diagnostics: "oops not an array" });

  const result = formatLintOutput({
    capturedStdout: raw,
    unix: false,
    weakTypingsDocPath: HINT_PATH,
  });

  assert.equal(result.formattedStdout, raw);
  assert.notEqual(result.schemaMismatch, null);
});

void test("non-object JSON (e.g. bare array) is treated as schemaMismatch", () => {
  const raw = "[]";

  const result = formatLintOutput({
    capturedStdout: raw,
    unix: false,
    weakTypingsDocPath: HINT_PATH,
  });

  assert.equal(result.formattedStdout, raw);
  assert.notEqual(result.schemaMismatch, null);
});

void test("non-empty broken JSON flags schemaMismatch (output-contract failure)", () => {
  const result = formatLintOutput({
    capturedStdout: "{not valid json",
    unix: false,
    weakTypingsDocPath: HINT_PATH,
  });

  assert.notEqual(result.schemaMismatch, null);
  assert.match(
    result.schemaMismatch?.reason ?? "",
    /JSON/,
    "reason should identify the failure as a JSON parse problem",
  );
});

void test("empty stdout in JSON mode is clean-compatible (no schemaMismatch)", () => {
  // oxlint should always emit JSON in default mode, but empty stdout is a benign
  // edge case (no payload at all) and should not be escalated to a contract failure.
  const result = formatLintOutput({
    capturedStdout: "",
    unix: false,
    weakTypingsDocPath: HINT_PATH,
  });

  assert.equal(result.schemaMismatch, null);
  assert.equal(result.formattedStdout, "");
  assert.equal(result.linterSummary, null);
  assert.equal(result.noFilesMatched, false);
});

void test('"No files found to lint." prefix is treated as a clean no-files run', () => {
  // oxlint ≥1.61 prepends "No files found to lint." to stdout when no files match the targets,
  // breaking JSON parsing. Surfaced as `noFilesMatched`.
  const result = formatLintOutput({
    capturedStdout:
      'No files found to lint. Please check your paths and ignore patterns.\n{ "diagnostics": [], "number_of_files": 0 }\n',
    unix: false,
    weakTypingsDocPath: HINT_PATH,
  });

  assert.equal(result.noFilesMatched, true);
  assert.equal(result.schemaMismatch, null);
  assert.equal(result.formattedStdout, "");
  assert.equal(result.linterSummary, null);
});

void test('"No files found to lint." prefix sets noFilesMatched in --unix mode too', () => {
  // The same prefix appears in --format=unix output, so the detection must run
  // before the unix passthrough branch.
  const raw = "No files found to lint. Please check your paths and ignore patterns.\n";
  const result = formatLintOutput({
    capturedStdout: raw,
    unix: true,
    weakTypingsDocPath: HINT_PATH,
  });

  assert.equal(result.noFilesMatched, true);
  assert.equal(result.schemaMismatch, null);
  assert.equal(result.formattedStdout, raw, "unix mode keeps the raw payload as passthrough");
  assert.equal(result.linterSummary, null);
});

void test("entry missing `filename` is treated as schemaMismatch with index in reason", () => {
  const raw = JSON.stringify({
    diagnostics: [
      {
        code: "eslint(no-debugger)",
        message: "x",
        labels: [{ span: { offset: 0, length: 1, line: 1, column: 1 } }],
        // filename absent
      },
    ],
  });

  const result = formatLintOutput({
    capturedStdout: raw,
    unix: false,
    weakTypingsDocPath: HINT_PATH,
  });

  assert.equal(result.formattedStdout, raw, "raw payload must be relayed");
  assert.notEqual(result.schemaMismatch, null);
  assert.match(result.schemaMismatch?.reason ?? "", /diagnostics\[0\]/);
  assert.match(result.schemaMismatch?.reason ?? "", /filename/);
});

void test("entry missing `labels[0].span` is treated as schemaMismatch", () => {
  const raw = JSON.stringify({
    diagnostics: [
      {
        filename: "/x.ts",
        code: "eslint(no-debugger)",
        message: "x",
        labels: [{}],
      },
    ],
  });

  const result = formatLintOutput({
    capturedStdout: raw,
    unix: false,
    weakTypingsDocPath: HINT_PATH,
  });

  assert.notEqual(result.schemaMismatch, null);
  assert.match(result.schemaMismatch?.reason ?? "", /span/);
});

void test("entry with non-numeric span field is treated as schemaMismatch", () => {
  const raw = JSON.stringify({
    diagnostics: [
      {
        filename: "/x.ts",
        code: "eslint(no-debugger)",
        message: "x",
        labels: [{ span: { offset: "0", length: 1, line: 1, column: 1 } }],
      },
    ],
  });

  const result = formatLintOutput({
    capturedStdout: raw,
    unix: false,
    weakTypingsDocPath: HINT_PATH,
  });

  assert.notEqual(result.schemaMismatch, null);
  assert.match(result.schemaMismatch?.reason ?? "", /offset/);
});

void test("entry with negative span.offset is treated as schemaMismatch", () => {
  const raw = JSON.stringify({
    diagnostics: [
      {
        filename: "/x.ts",
        code: "eslint(no-debugger)",
        message: "x",
        labels: [{ span: { offset: -1, length: 1, line: 1, column: 1 } }],
      },
    ],
  });

  const result = formatLintOutput({
    capturedStdout: raw,
    unix: false,
    weakTypingsDocPath: HINT_PATH,
  });

  assert.notEqual(result.schemaMismatch, null);
  assert.match(result.schemaMismatch?.reason ?? "", /offset.*non-negative/);
});

void test("entry with fractional span.length is treated as schemaMismatch", () => {
  const raw = JSON.stringify({
    diagnostics: [
      {
        filename: "/x.ts",
        code: "eslint(no-debugger)",
        message: "x",
        labels: [{ span: { offset: 0, length: 1.5, line: 1, column: 1 } }],
      },
    ],
  });

  const result = formatLintOutput({
    capturedStdout: raw,
    unix: false,
    weakTypingsDocPath: HINT_PATH,
  });

  assert.notEqual(result.schemaMismatch, null);
  assert.match(result.schemaMismatch?.reason ?? "", /length.*non-negative/);
});

void test("entry with span.line below 1 is treated as schemaMismatch", () => {
  const raw = JSON.stringify({
    diagnostics: [
      {
        filename: "/x.ts",
        code: "eslint(no-debugger)",
        message: "x",
        labels: [{ span: { offset: 0, length: 1, line: 0, column: 1 } }],
      },
    ],
  });

  const result = formatLintOutput({
    capturedStdout: raw,
    unix: false,
    weakTypingsDocPath: HINT_PATH,
  });

  assert.notEqual(result.schemaMismatch, null);
  assert.match(result.schemaMismatch?.reason ?? "", /line.*positive/);
});

void test("entry with span.column below 1 is treated as schemaMismatch", () => {
  const raw = JSON.stringify({
    diagnostics: [
      {
        filename: "/x.ts",
        code: "eslint(no-debugger)",
        message: "x",
        labels: [{ span: { offset: 0, length: 1, line: 1, column: 0 } }],
      },
    ],
  });

  const result = formatLintOutput({
    capturedStdout: raw,
    unix: false,
    weakTypingsDocPath: HINT_PATH,
  });

  assert.notEqual(result.schemaMismatch, null);
  assert.match(result.schemaMismatch?.reason ?? "", /column.*positive/);
});

void test("entry missing `message` is treated as schemaMismatch (even when `code` is present)", () => {
  // `message` is contractually required: oxlint is observed to always emit it. Tightening this
  // ensures any upstream drift that drops the field surfaces as a contract failure rather than
  // silently degrading to a rule-line-only render.
  const raw = JSON.stringify({
    diagnostics: [
      {
        filename: "/x.ts",
        code: "eslint(no-debugger)",
        labels: [{ span: { offset: 0, length: 1, line: 1, column: 1 } }],
      },
    ],
  });

  const result = formatLintOutput({
    capturedStdout: raw,
    unix: false,
    weakTypingsDocPath: HINT_PATH,
  });

  assert.equal(result.formattedStdout, raw, "raw payload must be relayed");
  assert.notEqual(result.schemaMismatch, null);
  assert.match(result.schemaMismatch?.reason ?? "", /message.*missing|missing.*message/);
});

void test("entry with non-string `code` (object) is treated as schemaMismatch", () => {
  // Even with a valid `message`, a wrong-typed `code` must not be silently dropped:
  // upstream schema drift (e.g. `code` becoming a structured object) should surface.
  const raw = JSON.stringify({
    diagnostics: [
      {
        filename: "/x.ts",
        code: { plugin: "eslint", rule: "no-debugger" },
        message: "ok",
        labels: [{ span: { offset: 0, length: 1, line: 1, column: 1 } }],
      },
    ],
  });

  const result = formatLintOutput({
    capturedStdout: raw,
    unix: false,
    weakTypingsDocPath: HINT_PATH,
  });

  assert.equal(result.formattedStdout, raw, "raw payload must be relayed");
  assert.notEqual(result.schemaMismatch, null);
  assert.match(result.schemaMismatch?.reason ?? "", /code/);
});

void test("entry with non-string `message` (number) is treated as schemaMismatch", () => {
  // Same idea on the message side.
  const raw = JSON.stringify({
    diagnostics: [
      {
        filename: "/x.ts",
        code: "eslint(no-debugger)",
        message: 42,
        labels: [{ span: { offset: 0, length: 1, line: 1, column: 1 } }],
      },
    ],
  });

  const result = formatLintOutput({
    capturedStdout: raw,
    unix: false,
    weakTypingsDocPath: HINT_PATH,
  });

  assert.equal(result.formattedStdout, raw, "raw payload must be relayed");
  assert.notEqual(result.schemaMismatch, null);
  assert.match(result.schemaMismatch?.reason ?? "", /message/);
});

void test("entry with explicit null `code` (and valid `message`) renders the parse-error placeholder", (t) => {
  // `null` is treated as equivalent to absent: the contract permits null `code`, and the
  // formatter substitutes the `parse-error` placeholder. Only present-but-wrong-typed
  // values are rejected.
  const dir = setupFixture(t, { "x.ts": "const x = ;\n" });
  const file = join(dir, "x.ts");
  const raw = JSON.stringify({
    diagnostics: [
      {
        filename: file,
        code: null,
        message: "Unexpected token",
        labels: [{ span: { offset: 10, length: 1, line: 1, column: 11 } }],
      },
    ],
  });

  const result = formatLintOutput({
    capturedStdout: raw,
    unix: false,
    weakTypingsDocPath: HINT_PATH,
  });

  assert.equal(result.schemaMismatch, null);
  assert.equal(
    result.formattedStdout,
    joinSections([[file, "  1:11 Unexpected token [parse-error]", "    ;"]]),
  );
});

void test("schemaMismatch reports the first failing entry index when later entries are valid", (t) => {
  const dir = setupFixture(t, { "x.ts": "debugger;\n" });
  const file = join(dir, "x.ts");
  const raw = JSON.stringify({
    diagnostics: [
      {
        filename: file,
        code: "eslint(no-debugger)",
        message: "ok",
        labels: [{ span: { offset: 0, length: 8, line: 1, column: 1 } }],
      },
      {
        // second entry malformed: missing labels
        filename: file,
        code: "eslint(no-debugger)",
        message: "broken",
      },
    ],
  });

  const result = formatLintOutput({
    capturedStdout: raw,
    unix: false,
    weakTypingsDocPath: HINT_PATH,
  });

  assert.notEqual(result.schemaMismatch, null);
  assert.match(result.schemaMismatch?.reason ?? "", /diagnostics\[1\]/);
  assert.match(result.schemaMismatch?.reason ?? "", /labels/);
  assert.equal(result.formattedStdout, raw, "fail-fast: raw relay, no partial render");
});

void test("unreadable source file falls back to placeholder slice and reported L:C", () => {
  const file = "/nonexistent/path/to/file.ts";
  const stdout = makeStdout([
    {
      message: "something",
      code: "eslint(no-debugger)",
      severity: "error",
      filename: file,
      labels: [{ span: { offset: 0, length: 8, line: 3, column: 5 } }],
    },
  ]);

  const result = formatLintOutput({
    capturedStdout: stdout,
    unix: false,
    weakTypingsDocPath: HINT_PATH,
  });

  assert.equal(
    result.formattedStdout,
    joinSections([[file, "  3:5 something [eslint(no-debugger)]", "    <unreadable>"]]),
  );
  assert.equal(result.linterSummary, "Found 1 unfixed issue in 1 file.");
});

void test("out-of-bounds span falls back to placeholder", (t) => {
  const dir = setupFixture(t, { "x.ts": "debugger;\n" });
  const file = join(dir, "x.ts");
  const stdout = makeStdout([
    {
      message: "oob",
      code: "eslint(no-debugger)",
      severity: "error",
      filename: file,
      labels: [{ span: { offset: 0, length: 9999, line: 1, column: 1 } }],
    },
  ]);

  const result = formatLintOutput({
    capturedStdout: stdout,
    unix: false,
    weakTypingsDocPath: HINT_PATH,
  });

  assert.equal(
    result.formattedStdout,
    joinSections([[file, "  1:1 oob [eslint(no-debugger)]", "    <unreadable>"]]),
  );
});

void test("broken JSON is relayed verbatim and surfaced via schemaMismatch", () => {
  const broken = "{not valid json";

  const result = formatLintOutput({
    capturedStdout: broken,
    unix: false,
    weakTypingsDocPath: HINT_PATH,
  });

  assert.equal(result.formattedStdout, broken);
  assert.equal(result.linterSummary, null);
  assert.notEqual(result.schemaMismatch, null);
});

void test("--unix mode passes stdout through unchanged", () => {
  const raw = "path/to/file.ts:3:1: message [rule-id]\n";

  const result = formatLintOutput({
    capturedStdout: raw,
    unix: true,
    weakTypingsDocPath: HINT_PATH,
  });

  assert.equal(result.formattedStdout, raw);
  assert.equal(result.linterSummary, null);
});
