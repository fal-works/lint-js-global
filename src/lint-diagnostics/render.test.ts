import assert from "node:assert/strict";
import test from "node:test";

import { joinSections } from "../../test/lint-diagnostics-helpers.ts";
import {
  compareDiagnostics,
  countFiles,
  formatStylishEntry,
  formatSummary,
  formatUnixLine,
  hasUnsafeDiagnostic,
  renderStylish,
  renderUnix,
  renderWeakTypingsHint,
} from "./render.ts";
import type { ResolvedDiagnostic } from "./resolve.ts";

function makeResolved(overrides: Partial<ResolvedDiagnostic> = {}): ResolvedDiagnostic {
  return {
    filename: "/x.ts",
    errorCode: "eslint(no-debugger)",
    message: "msg",
    startLine: 1,
    startCol: 1,
    endLine: 1,
    endCol: 8,
    slice: "debugger",
    sliceTruncated: false,
    ...overrides,
  };
}

void test("formatStylishEntry: emits the head line and indented slice line", () => {
  const result = formatStylishEntry(makeResolved({ message: "say something" }));
  assert.equal(result, "  1:1 say something [eslint(no-debugger)]\n    debugger");
});

void test("formatStylishEntry: collapses newlines in the message to single spaces", () => {
  const result = formatStylishEntry(
    makeResolved({ message: "first line\nsecond line\r\nthird line" }),
  );
  assert.equal(
    result,
    "  1:1 first line second line third line [eslint(no-debugger)]\n    debugger",
  );
});

void test("formatStylishEntry: switches to L:C-L:C when slice is truncated", () => {
  // Truncation hides part of the original span, so the head line discloses the full range.
  const result = formatStylishEntry(
    makeResolved({
      sliceTruncated: true,
      endLine: 3,
      endCol: 1,
      slice: "function foo() { ...",
    }),
  );
  assert.equal(result, "  1:1-3:1 msg [eslint(no-debugger)]\n    function foo() { ...");
});

void test("formatStylishEntry: passes tsgolint typescript(TS\\d+) code through as-is", () => {
  // tsgolint emits TypeScript compile errors with `code: typescript(TS<NNNN>)`. The whole `code`
  // is rendered raw inside the brackets (no inner-paren extraction).
  const result = formatStylishEntry(
    makeResolved({
      message: "Cannot find name 'node:fs'.",
      errorCode: "typescript(TS2591)",
      startCol: 9,
      endCol: 16,
      slice: "node:fs",
    }),
  );
  assert.equal(result, "  1:9 Cannot find name 'node:fs'. [typescript(TS2591)]\n    node:fs");
});

void test("formatUnixLine: emits filename:line:col plus message and bracketed code", () => {
  const result = formatUnixLine(
    makeResolved({
      filename: "/path/to/file.ts",
      startLine: 5,
      startCol: 1,
      message: "Promises must be awaited.",
      errorCode: "typescript-eslint(no-floating-promises)",
    }),
  );
  assert.equal(
    result,
    "/path/to/file.ts:5:1: Promises must be awaited. [typescript-eslint(no-floating-promises)]",
  );
});

void test("formatUnixLine: collapses newlines in the message to single spaces", () => {
  const result = formatUnixLine(
    makeResolved({
      filename: "/x.ts",
      message: "first\nsecond\r\nthird",
    }),
  );
  assert.equal(result, "/x.ts:1:1: first second third [eslint(no-debugger)]");
});

void test("formatUnixLine: keeps L:C even when the slice is truncated (no range form)", () => {
  // Unix mode never widens to L:C-L:C, regardless of truncation state.
  const result = formatUnixLine(
    makeResolved({
      sliceTruncated: true,
      endLine: 3,
      endCol: 1,
    }),
  );
  assert.equal(result, "/x.ts:1:1: msg [eslint(no-debugger)]");
});

void test("compareDiagnostics: same file sorts by (line, column, errorCode)", () => {
  const a = makeResolved({ startLine: 1, startCol: 7, errorCode: "eslint(no-unused-vars)" });
  const b = makeResolved({ startLine: 2, startCol: 7, errorCode: "eslint(no-unused-vars)" });
  const c = makeResolved({ startLine: 3, startCol: 1, errorCode: "eslint(no-debugger)" });

  // Feed in non-sorted order.
  const sorted = [c, b, a].sort(compareDiagnostics);

  assert.deepEqual(
    sorted.map((d) => `${d.startLine}:${d.startCol}`),
    ["1:7", "2:7", "3:1"],
  );
});

void test("compareDiagnostics: different files sort lexicographically", () => {
  const a = makeResolved({ filename: "/a.ts" });
  const b = makeResolved({ filename: "/b.ts" });

  const sorted = [b, a].sort(compareDiagnostics);
  assert.deepEqual(
    sorted.map((d) => d.filename),
    ["/a.ts", "/b.ts"],
  );
});

void test("renderWeakTypingsHint: 4-line block ending with the doc path", () => {
  const lines = renderWeakTypingsHint("/path/to/weak-typings.md");
  assert.equal(lines.length, 4);
  assert.equal(lines[0], "Hint on the `no-unsafe-*` diagnostics:");
  assert.equal(lines[3], "- See: /path/to/weak-typings.md");
});

void test("hasUnsafeDiagnostic: true when any errorCode matches typescript-eslint(no-unsafe-*)", () => {
  assert.equal(hasUnsafeDiagnostic([makeResolved()]), false);
  assert.equal(
    hasUnsafeDiagnostic([
      makeResolved(),
      makeResolved({ errorCode: "typescript-eslint(no-unsafe-assignment)" }),
    ]),
    true,
  );
});

void test("countFiles: counts distinct filenames", () => {
  assert.equal(
    countFiles([
      makeResolved({ filename: "/a.ts" }),
      makeResolved({ filename: "/a.ts", startLine: 2 }),
      makeResolved({ filename: "/b.ts" }),
    ]),
    2,
  );
});

void test("formatSummary: non-check plural form has 'unfixed' qualifier and plural words", () => {
  assert.equal(formatSummary(false, 3, 2), "3 unfixed lint issues in 2 files.");
});

void test("formatSummary: non-check singular form keeps 'unfixed' but uses singular words", () => {
  assert.equal(formatSummary(false, 1, 1), "1 unfixed lint issue in 1 file.");
});

void test("formatSummary: check mode drops the 'unfixed' qualifier (plural)", () => {
  assert.equal(formatSummary(true, 2, 1), "2 lint issues in 1 file.");
});

void test("formatSummary: check mode drops the 'unfixed' qualifier (singular)", () => {
  assert.equal(formatSummary(true, 1, 1), "1 lint issue in 1 file.");
});

void test("renderStylish: groups by filename and sorts within each group", () => {
  // Feed in non-sorted, multi-file order.
  const a1 = makeResolved({ filename: "/a.ts", message: "a" });
  const a2 = makeResolved({
    filename: "/a.ts",
    message: "b",
    startLine: 2,
    startCol: 1,
    slice: "x",
  });
  const b1 = makeResolved({
    filename: "/b.ts",
    message: "c",
    startLine: 3,
    startCol: 5,
    slice: "y",
  });

  const result = renderStylish([b1, a2, a1]);

  assert.equal(
    result,
    joinSections([
      [
        "/a.ts",
        "  1:1 a [eslint(no-debugger)]",
        "    debugger",
        "  2:1 b [eslint(no-debugger)]",
        "    x",
      ],
      ["/b.ts", "  3:5 c [eslint(no-debugger)]", "    y"],
    ]),
  );
});

void test("renderStylish: empty input produces empty output", () => {
  assert.equal(renderStylish([]), "");
});

void test("renderUnix: emits one line per diagnostic in sorted order", () => {
  const a1 = makeResolved({ filename: "/a.ts", message: "a" });
  const a2 = makeResolved({
    filename: "/a.ts",
    message: "b",
    startLine: 2,
    startCol: 1,
  });
  const b1 = makeResolved({
    filename: "/b.ts",
    message: "c",
    startLine: 3,
    startCol: 5,
  });

  const result = renderUnix([b1, a2, a1]);

  assert.equal(
    result,
    [
      "/a.ts:1:1: a [eslint(no-debugger)]",
      "/a.ts:2:1: b [eslint(no-debugger)]",
      "/b.ts:3:5: c [eslint(no-debugger)]",
      "",
    ].join("\n"),
  );
});

void test("renderUnix: empty input produces empty output", () => {
  assert.equal(renderUnix([]), "");
});
