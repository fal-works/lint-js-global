import assert from "node:assert/strict";
import test from "node:test";

import { makeFileFinding, makeProjectFinding } from "../../../test/lint-diagnostics-helpers.ts";
import { compareFileFindings, compareProjectFindings, displayCode } from "./shared.ts";

void test("displayCode: passes a non-null code through unchanged", () => {
  assert.equal(displayCode("eslint(no-debugger)"), "eslint(no-debugger)");
});

void test("displayCode: collapses null to the parse-error placeholder", () => {
  assert.equal(displayCode(null), "parse-error");
});

void test("compareFileFindings: same file sorts by (line, column, displayed code)", () => {
  const a = makeFileFinding({ startLine: 1, startCol: 7, code: "eslint(no-unused-vars)" });
  const b = makeFileFinding({ startLine: 2, startCol: 7, code: "eslint(no-unused-vars)" });
  const c = makeFileFinding({ startLine: 3, startCol: 1, code: "eslint(no-debugger)" });

  // Feed in non-sorted order.
  const sorted = [c, b, a].sort(compareFileFindings);

  assert.deepEqual(
    sorted.map((d) => `${d.startLine}:${d.startCol}`),
    ["1:7", "2:7", "3:1"],
  );
});

void test("compareFileFindings: different files sort lexicographically", () => {
  const a = makeFileFinding({ filename: "/a.ts" });
  const b = makeFileFinding({ filename: "/b.ts" });

  const sorted = [b, a].sort(compareFileFindings);
  assert.deepEqual(
    sorted.map((d) => d.filename),
    ["/a.ts", "/b.ts"],
  );
});

void test("compareProjectFindings: orders by heading, then displayed code, then message", () => {
  const a = makeProjectFinding({ filename: "tsconfig.json", code: "X", message: "a" });
  const b = makeProjectFinding({ filename: "tsconfig.json", code: "X", message: "b" });
  const c = makeProjectFinding({ filename: "tsconfig.json", code: "Y", message: "a" });
  const d = makeProjectFinding({ filename: "z.json", code: "X", message: "a" });

  const sorted = [d, c, b, a].sort(compareProjectFindings);

  assert.deepEqual(
    sorted.map((p) => `${p.filename}|${p.code ?? ""}|${p.message}`),
    ["tsconfig.json|X|a", "tsconfig.json|X|b", "tsconfig.json|Y|a", "z.json|X|a"],
  );
});
