import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { setupFixture } from "../../test/lint-diagnostics-helpers.ts";
import { createSourceCache } from "../system/source-cache.ts";
import { resolveDiagnostic, resolveProjectDiagnostic } from "./resolve-diagnostic.ts";
import type { ValidatedFileDiagnostic } from "./schema.ts";

function makeValidated(overrides: Partial<ValidatedFileDiagnostic> = {}): ValidatedFileDiagnostic {
  return {
    kind: "file",
    filename: "/x.ts",
    code: "eslint(no-debugger)",
    message: "msg",
    labels: [{ span: { offset: 0, length: 8 } }],
    ...overrides,
  };
}

void test("resolveDiagnostic: happy path exposes start/end position and the raw span text", (t) => {
  const dir = setupFixture(t, { "x.ts": "debugger;\n" });
  const file = join(dir, "x.ts");
  const cache = createSourceCache(dir);

  const result = resolveDiagnostic(makeValidated({ filename: file }), cache);

  assert.ok(result !== null);
  assert.equal(result.filename, file);
  assert.equal(result.errorCode, "eslint(no-debugger)");
  assert.equal(result.message, "msg");
  assert.equal(result.startLine, 1);
  assert.equal(result.startCol, 1);
  assert.equal(result.endLine, 1);
  assert.equal(result.endCol, 8);
  assert.equal(result.spanText, "debugger");
});

void test("resolveDiagnostic: null code is replaced with the parse-error placeholder", (t) => {
  const dir = setupFixture(t, { "x.ts": "const x = ;\n" });
  const file = join(dir, "x.ts");
  const cache = createSourceCache(dir);

  const result = resolveDiagnostic(
    makeValidated({
      filename: file,
      code: null,
      labels: [{ span: { offset: 10, length: 1 } }],
    }),
    cache,
  );

  assert.ok(result !== null);
  assert.equal(result.errorCode, "parse-error");
  assert.equal(result.spanText, ";");
});

void test("resolveDiagnostic: multi-line span exposes the full raw text and end position", (t) => {
  const dir = setupFixture(t, { "x.ts": "function foo() {\n  return 1;\n}\n" });
  const file = join(dir, "x.ts");
  const cache = createSourceCache(dir);

  const result = resolveDiagnostic(
    makeValidated({
      filename: file,
      labels: [{ span: { offset: 0, length: 30 } }],
    }),
    cache,
  );

  assert.ok(result !== null);
  assert.equal(result.startLine, 1);
  assert.equal(result.startCol, 1);
  assert.equal(result.endLine, 3);
  assert.equal(result.endCol, 1);
  assert.equal(result.spanText, "function foo() {\n  return 1;\n}");
});

void test("resolveDiagnostic: unreadable source returns null", () => {
  const cache = createSourceCache("/");
  const result = resolveDiagnostic(
    makeValidated({
      filename: "/nonexistent/path/to/file.ts",
      labels: [{ span: { offset: 0, length: 8 } }],
    }),
    cache,
  );

  assert.equal(result, null);
});

void test("resolveDiagnostic: out-of-bounds span returns null", (t) => {
  const dir = setupFixture(t, { "x.ts": "debugger;\n" });
  const file = join(dir, "x.ts");
  const cache = createSourceCache(dir);

  const result = resolveDiagnostic(
    makeValidated({
      filename: file,
      labels: [{ span: { offset: 0, length: 9999 } }],
    }),
    cache,
  );

  assert.equal(result, null);
});

void test("resolveProjectDiagnostic: passes filename and message through; substitutes parse-error for null code", () => {
  const result = resolveProjectDiagnostic({
    kind: "project",
    filename: "tsconfig.json",
    code: null,
    message: "Cannot find type definition file for 'node'.",
  });

  assert.deepEqual(result, {
    filename: "tsconfig.json",
    errorCode: "parse-error",
    message: "Cannot find type definition file for 'node'.",
  });
});

void test("resolveProjectDiagnostic: keeps a non-null code as the errorCode", () => {
  const result = resolveProjectDiagnostic({
    kind: "project",
    filename: "",
    code: "typescript(tsconfig-error)",
    message: "msg",
  });

  assert.equal(result.errorCode, "typescript(tsconfig-error)");
  assert.equal(result.filename, "");
});
