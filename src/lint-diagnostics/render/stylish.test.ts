import assert from "node:assert/strict";
import test from "node:test";

import { joinSections, makeProject, makeResolved } from "../../../test/lint-diagnostics-helpers.ts";
import { formatProjectStylishEntry, formatStylishEntry, renderStylish } from "./stylish.ts";

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

void test("formatStylishEntry: switches to L:C-L:C when the slice gets truncated", () => {
  // Multi-line span: formatCodeSlice keeps only the first line and appends ' ...';
  // the head line discloses the full range so the hidden portion is still visible.
  const result = formatStylishEntry(
    makeResolved({
      endLine: 3,
      endCol: 1,
      spanText: "function foo() {\n  return 1;\n}",
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
      spanText: "node:fs",
    }),
  );
  assert.equal(result, "  1:9 Cannot find name 'node:fs'. [typescript(TS2591)]\n    node:fs");
});

void test("formatProjectStylishEntry: indented one-line shape with no L:C and no slice", () => {
  const result = formatProjectStylishEntry(makeProject({ message: "tsconfig msg" }));
  assert.equal(result, "  tsconfig msg [typescript(tsconfig-error)]");
});

void test("formatProjectStylishEntry: collapses newlines in the message to single spaces", () => {
  const result = formatProjectStylishEntry(makeProject({ message: "first\nsecond\r\nthird" }));
  assert.equal(result, "  first second third [typescript(tsconfig-error)]");
});

void test("renderStylish: groups by filename and sorts within each group", () => {
  // Feed in non-sorted, multi-file order.
  const a1 = makeResolved({ filename: "/a.ts", message: "a" });
  const a2 = makeResolved({
    filename: "/a.ts",
    message: "b",
    startLine: 2,
    startCol: 1,
    spanText: "x",
  });
  const b1 = makeResolved({
    filename: "/b.ts",
    message: "c",
    startLine: 3,
    startCol: 5,
    spanText: "y",
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
