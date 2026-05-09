import assert from "node:assert/strict";
import test from "node:test";

import { joinSections } from "../../test/lint-diagnostics-helpers.ts";
import {
  compareDiagnostics,
  compareProjectDiagnostics,
  formatProjectStylishEntry,
  formatProjectUnixLine,
  formatStylishEntry,
  formatSummary,
  formatUnixLine,
  hasUnsafeDiagnostic,
  renderStylish,
  renderUnix,
  renderWeakTypingsHint,
} from "./render.ts";
import type { ResolvedDiagnostic, ResolvedProjectDiagnostic } from "./resolve.ts";

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

function makeProject(
  overrides: Partial<ResolvedProjectDiagnostic> = {},
): ResolvedProjectDiagnostic {
  return {
    filename: "tsconfig.json",
    errorCode: "typescript(tsconfig-error)",
    message: "Cannot find type definition file for 'node'.",
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

void test("formatSummary: non-check plural form has 'unfixed' qualifier and plural word", () => {
  assert.equal(formatSummary(false, 3), "3 unfixed lint issues.");
});

void test("formatSummary: non-check singular form keeps 'unfixed' but uses the singular word", () => {
  assert.equal(formatSummary(false, 1), "1 unfixed lint issue.");
});

void test("formatSummary: check mode drops the 'unfixed' qualifier (plural)", () => {
  assert.equal(formatSummary(true, 2), "2 lint issues.");
});

void test("formatSummary: check mode drops the 'unfixed' qualifier (singular)", () => {
  assert.equal(formatSummary(true, 1), "1 lint issue.");
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

  const result = renderStylish([b1, a2, a1], []);

  assert.equal(
    result.file,
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
  assert.equal(result.project, "");
});

void test("renderStylish: project and file blocks are returned as parallel strings", () => {
  const fileDiag = makeResolved({ filename: "/src/foo.ts", message: "msg" });
  const projectDiag = makeProject({ filename: "tsconfig.json", message: "tsconfig msg" });

  const result = renderStylish([fileDiag], [projectDiag]);

  assert.equal(result.project, "tsconfig.json\n  tsconfig msg [typescript(tsconfig-error)]\n");
  assert.equal(result.file, "/src/foo.ts\n  1:1 msg [eslint(no-debugger)]\n    debugger\n");
});

void test("renderStylish: empty filename surfaces under the (project) placeholder heading", () => {
  const result = renderStylish([], [makeProject({ filename: "", message: "no path" })]);

  assert.equal(result.project, "(project)\n  no path [typescript(tsconfig-error)]\n");
  assert.equal(result.file, "");
});

void test("renderStylish: project entries with the same heading cluster under one section", () => {
  const a = makeProject({ filename: "tsconfig.json", message: "a" });
  const b = makeProject({ filename: "tsconfig.json", message: "b" });

  const result = renderStylish([], [b, a]);

  assert.equal(
    result.project,
    [
      "tsconfig.json",
      "  a [typescript(tsconfig-error)]",
      "  b [typescript(tsconfig-error)]",
      "",
    ].join("\n"),
  );
  assert.equal(result.file, "");
});

void test("renderStylish: empty input produces empty blocks", () => {
  const result = renderStylish([], []);
  assert.equal(result.file, "");
  assert.equal(result.project, "");
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

  const result = renderUnix([b1, a2, a1], []);

  assert.equal(
    result.file,
    [
      "/a.ts:1:1: a [eslint(no-debugger)]",
      "/a.ts:2:1: b [eslint(no-debugger)]",
      "/b.ts:3:5: c [eslint(no-debugger)]",
      "",
    ].join("\n"),
  );
  assert.equal(result.project, "");
});

void test("renderUnix: project block omits the L:C column and is returned separately", () => {
  const fileDiag = makeResolved({ filename: "/src/foo.ts", message: "msg" });
  const projectDiag = makeProject({ filename: "tsconfig.json", message: "tsconfig msg" });

  const result = renderUnix([fileDiag], [projectDiag]);

  assert.equal(result.project, "tsconfig.json: tsconfig msg [typescript(tsconfig-error)]\n");
  assert.equal(result.file, "/src/foo.ts:1:1: msg [eslint(no-debugger)]\n");
});

void test("renderUnix: empty filename in unix mode surfaces as the (project) placeholder", () => {
  const result = renderUnix([], [makeProject({ filename: "", message: "no path" })]);

  assert.equal(result.project, "(project): no path [typescript(tsconfig-error)]\n");
  assert.equal(result.file, "");
});

void test("renderUnix: empty input produces empty blocks", () => {
  const result = renderUnix([], []);
  assert.equal(result.file, "");
  assert.equal(result.project, "");
});

void test("formatProjectStylishEntry: indented one-line shape with no L:C and no slice", () => {
  const result = formatProjectStylishEntry(makeProject({ message: "tsconfig msg" }));
  assert.equal(result, "  tsconfig msg [typescript(tsconfig-error)]");
});

void test("formatProjectStylishEntry: collapses newlines in the message to single spaces", () => {
  const result = formatProjectStylishEntry(makeProject({ message: "first\nsecond\r\nthird" }));
  assert.equal(result, "  first second third [typescript(tsconfig-error)]");
});

void test("formatProjectUnixLine: emits <heading>: <message> [<code>] without L:C", () => {
  const result = formatProjectUnixLine(makeProject({ message: "msg" }));
  assert.equal(result, "tsconfig.json: msg [typescript(tsconfig-error)]");
});

void test("formatProjectUnixLine: empty filename uses the (project) placeholder", () => {
  const result = formatProjectUnixLine(makeProject({ filename: "", message: "msg" }));
  assert.equal(result, "(project): msg [typescript(tsconfig-error)]");
});

void test("compareProjectDiagnostics: orders by heading, then errorCode, then message", () => {
  const a = makeProject({ filename: "tsconfig.json", errorCode: "X", message: "a" });
  const b = makeProject({ filename: "tsconfig.json", errorCode: "X", message: "b" });
  const c = makeProject({ filename: "tsconfig.json", errorCode: "Y", message: "a" });
  const d = makeProject({ filename: "z.json", errorCode: "X", message: "a" });

  const sorted = [d, c, b, a].sort(compareProjectDiagnostics);

  assert.deepEqual(
    sorted.map((p) => `${p.filename}|${p.errorCode}|${p.message}`),
    ["tsconfig.json|X|a", "tsconfig.json|X|b", "tsconfig.json|Y|a", "z.json|X|a"],
  );
});
