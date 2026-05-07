import assert from "node:assert/strict";
import test from "node:test";

import { HINT_PATH, joinSections } from "../../test/format-diagnostics-helpers.ts";
import {
  compareDiagnostics,
  formatDiagLine,
  formatSummary,
  renderDiagnostics,
  renderWeakTypingsHint,
} from "./render.ts";
import type { ResolvedDiagnostic } from "./resolve.ts";

function makeResolved(overrides: Partial<ResolvedDiagnostic> = {}): ResolvedDiagnostic {
  return {
    filename: "/x.ts",
    errorCode: "eslint(no-debugger)",
    message: "msg",
    sortLine: 1,
    sortCol: 1,
    location: "1:1",
    slice: "debugger",
    ...overrides,
  };
}

void test("formatDiagLine: emits the head line and indented slice line", () => {
  const result = formatDiagLine(makeResolved({ message: "say something" }));
  assert.equal(result, "  1:1 say something [eslint(no-debugger)]\n    debugger");
});

void test("formatDiagLine: collapses newlines in the message to single spaces", () => {
  const result = formatDiagLine(makeResolved({ message: "first line\nsecond line\r\nthird line" }));
  assert.equal(
    result,
    "  1:1 first line second line third line [eslint(no-debugger)]\n    debugger",
  );
});

void test("formatDiagLine: passes tsgolint typescript(TS\\d+) code through as-is", () => {
  // tsgolint emits TypeScript compile errors with `code: typescript(TS<NNNN>)`. The whole `code`
  // is rendered raw inside the brackets (no inner-paren extraction).
  const result = formatDiagLine(
    makeResolved({
      message: "Cannot find name 'node:fs'.",
      errorCode: "typescript(TS2591)",
      location: "1:9",
      slice: "node:fs",
    }),
  );
  assert.equal(result, "  1:9 Cannot find name 'node:fs'. [typescript(TS2591)]\n    node:fs");
});

void test("compareDiagnostics: same file sorts by (line, column, errorCode)", () => {
  const a = makeResolved({ sortLine: 1, sortCol: 7, errorCode: "eslint(no-unused-vars)" });
  const b = makeResolved({ sortLine: 2, sortCol: 7, errorCode: "eslint(no-unused-vars)" });
  const c = makeResolved({ sortLine: 3, sortCol: 1, errorCode: "eslint(no-debugger)" });

  // Feed in non-sorted order.
  const sorted = [c, b, a].sort(compareDiagnostics);

  assert.deepEqual(
    sorted.map((d) => `${d.sortLine}:${d.sortCol}`),
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

void test("renderDiagnostics: groups by filename, sorts, returns fileCount", () => {
  // Feed in non-sorted, multi-file order.
  const a1 = makeResolved({ filename: "/a.ts", message: "a" });
  const a2 = makeResolved({
    filename: "/a.ts",
    message: "b",
    sortLine: 2,
    sortCol: 1,
    location: "2:1",
    slice: "x",
  });
  const b1 = makeResolved({
    filename: "/b.ts",
    message: "c",
    sortLine: 3,
    sortCol: 5,
    location: "3:5",
    slice: "y",
  });

  const result = renderDiagnostics([b1, a2, a1], HINT_PATH);

  assert.equal(result.fileCount, 2);
  assert.equal(
    result.formattedStdout,
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

void test("renderDiagnostics: appends weak-typings hint when any no-unsafe-* code is present", () => {
  const file = "/x.ts";
  const d = makeResolved({
    filename: file,
    message: "Unsafe assignment",
    errorCode: "typescript-eslint(no-unsafe-assignment)",
    location: "1:7",
    sortCol: 7,
    slice: "x = foo",
  });

  const result = renderDiagnostics([d], HINT_PATH);

  assert.equal(result.fileCount, 1);
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
});

void test("renderDiagnostics: omits the hint block when no no-unsafe-* code is present", () => {
  const result = renderDiagnostics([makeResolved()], HINT_PATH);
  // No "Hint on the" line in the output.
  assert.ok(!result.formattedStdout.includes("Hint on the"));
});
