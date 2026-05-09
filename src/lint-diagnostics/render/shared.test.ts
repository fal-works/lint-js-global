import assert from "node:assert/strict";
import test from "node:test";

import { makeProject, makeResolved } from "../../../test/lint-diagnostics-helpers.ts";
import { compareDiagnostics, compareProjectDiagnostics } from "./shared.ts";

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
