// @ts-check

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { formatLintOutput } from "../../src/format-diagnostics.js";

const HINT_PATH = "/opt/lint-js/docs/weak-typings.md";

/**
 * @typedef {{
 *   message: string;
 *   code?: string | null;
 *   severity?: string;
 *   filename: string;
 *   labels: Array<{ span: { offset: number; length: number; line: number; column: number } }>;
 * }} FakeDiag
 */

/**
 * Wrap an array of fake diagnostics into the `{ "diagnostics": [...], ... }` shape
 * that oxlint emits from `--format=json`.
 *
 * @param {FakeDiag[]} diagnostics
 * @returns {string}
 */
function makeStdout(diagnostics) {
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
 *
 * @param {import("node:test").TestContext} t
 * @param {Record<string, string>} sources
 * @returns {string}
 */
function setupFixture(t, sources) {
  const dir = mkdtempSync(join(tmpdir(), "lint-js-fmt-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [relPath, content] of Object.entries(sources)) {
    writeFileSync(join(dir, relPath), content);
  }
  return dir;
}

/**
 * Assemble an expected formatted-stdout string from section arrays.
 *
 * @param {string[][]} sections
 * @returns {string}
 */
function joinSections(sections) {
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
      ["diagnostic legend: <location> `<code-slice>` [<rule-name>]"],
      [file, "  1:1 `debugger` [no-debugger]"],
    ]),
  );
  assert.equal(result.linterSummary, "Found 1 unfixed issues in 1 files.");
});

void test("single file, multiple diagnostics sort by (line, col, rule-name)", (t) => {
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
      ["diagnostic legend: <location> `<code-slice>` [<rule-name>]"],
      [
        file,
        "  1:7 `x` [no-unused-vars]",
        "  2:7 `y` [no-unused-vars]",
        "  3:1 `debugger` [no-debugger]",
      ],
    ]),
  );
  assert.equal(result.linterSummary, "Found 3 unfixed issues in 1 files.");
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
      ["diagnostic legend: <location> `<code-slice>` [<rule-name>]"],
      [fileA, "  1:1 `debugger` [no-debugger]"],
      [fileB, "  1:1 `debugger` [no-debugger]"],
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
    joinSections([
      ["diagnostic legend: <location> `<code-slice>` [<rule-name>]"],
      [file, `  1:1-1:45 \`${truncated}\` [no-unused-vars]`],
    ]),
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
      ["diagnostic legend: <location> `<code-slice>` [<rule-name>]"],
      [file, "  1:1-3:1 `function foo() { ...` [some-rule]"],
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
    joinSections([
      ["diagnostic legend: <location> `<code-slice>` [<rule-name>]"],
      [file, `  1:1-2:4 \`${truncated}\` [some-rule]`],
    ]),
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
    joinSections([
      ["diagnostic legend: <location> `<code-slice>` [<rule-name>]"],
      [file, "  1:11 `'あいう'` [some-rule]"],
    ]),
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
      ["diagnostic legend: <location> `<code-slice>` [<rule-name>]"],
      [file, "  1:7 `x = foo` [no-unsafe-assignment]"],
      [
        "Hint on the `no-unsafe-*` diagnostics:",
        "- Remedies: `*.d.ts` augmentation, `unknown` + type predicates, or boundary module with typed wrappers.",
        "- Inline disable (`// oxlint-disable-next-line`) is not a fix; use only when explicitly permitted by the project maintainer.",
        `- See: ${HINT_PATH}`,
      ],
    ]),
  );
  assert.equal(result.linterSummary, "Found 1 unfixed issues in 1 files.");
});

void test("diagnostic without `code` renders as [(message)]", (t) => {
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
    joinSections([
      ["diagnostic legend: <location> `<code-slice>` [<rule-name>]"],
      [file, "  1:11 `;` [(Unexpected token)]"],
    ]),
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
    joinSections([
      ["diagnostic legend: <location> `<code-slice>` [<rule-name>]"],
      [file, "  3:5 `<unreadable>` [no-debugger]"],
    ]),
  );
  assert.equal(result.linterSummary, "Found 1 unfixed issues in 1 files.");
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
    joinSections([
      ["diagnostic legend: <location> `<code-slice>` [<rule-name>]"],
      [file, "  1:1 `<unreadable>` [no-debugger]"],
    ]),
  );
});

void test("broken JSON is relayed verbatim as formattedStdout", () => {
  const broken = "{not valid json";

  const result = formatLintOutput({
    capturedStdout: broken,
    unix: false,
    weakTypingsDocPath: HINT_PATH,
  });

  assert.equal(result.formattedStdout, broken);
  assert.equal(result.linterSummary, null);
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
