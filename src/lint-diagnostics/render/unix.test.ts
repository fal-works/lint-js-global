import assert from "node:assert/strict";
import test from "node:test";

import { makeProject, makeResolved } from "../../../test/lint-diagnostics-helpers.ts";
import { formatProjectUnixLine, formatUnixLine, renderUnix } from "./unix.ts";

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

void test("formatUnixLine: keeps L:C even for a multi-line span (no range form)", () => {
  // Unix mode never widens to L:C-L:C, regardless of span shape.
  const result = formatUnixLine(
    makeResolved({
      endLine: 3,
      endCol: 1,
      spanText: "function foo() {\n  return 1;\n}",
    }),
  );
  assert.equal(result, "/x.ts:1:1: msg [eslint(no-debugger)]");
});

void test("formatProjectUnixLine: emits <heading>: <message> [<code>] without L:C", () => {
  const result = formatProjectUnixLine(makeProject({ message: "msg" }));
  assert.equal(result, "tsconfig.json: msg [typescript(tsconfig-error)]");
});

void test("formatProjectUnixLine: empty filename uses the (project) placeholder", () => {
  const result = formatProjectUnixLine(makeProject({ filename: "", message: "msg" }));
  assert.equal(result, "(project): msg [typescript(tsconfig-error)]");
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
