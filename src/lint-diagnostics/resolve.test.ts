import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { setupFixture } from "../../test/lint-diagnostics-helpers.ts";
import { createSourceCache } from "../system/source-cache.ts";
import { resolveAll } from "./resolve.ts";
import type { ValidatedFileDiagnostic, ValidatedProjectDiagnostic } from "./schema.ts";

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

function makeValidatedProject(
  overrides: Partial<ValidatedProjectDiagnostic> = {},
): ValidatedProjectDiagnostic {
  return {
    kind: "project",
    filename: "tsconfig.json",
    code: "typescript(tsconfig-error)",
    message: "msg",
    ...overrides,
  };
}

void test("resolveAll: empty payload yields an ok result with both arrays empty", () => {
  const cache = createSourceCache("/");
  const result = resolveAll({ file: [], project: [] }, cache);
  assert.deepEqual(result, { kind: "ok", file: [], project: [] });
});

void test("resolveAll: file diagnostic resolved against the source cache flows through to ok.file", (t) => {
  const dir = setupFixture(t, { "x.ts": "debugger;\n" });
  const file = join(dir, "x.ts");
  const cache = createSourceCache(dir);

  const result = resolveAll({ file: [makeValidated({ filename: file })], project: [] }, cache);

  assert.equal(result.kind, "ok");
  if (result.kind !== "ok") return;
  assert.equal(result.project.length, 0);
  assert.deepEqual(result.file, [
    {
      filename: file,
      errorCode: "eslint(no-debugger)",
      message: "msg",
      startLine: 1,
      startCol: 1,
      endLine: 1,
      endCol: 8,
      spanText: "debugger",
    },
  ]);
});

void test("resolveAll: project diagnostics pass through resolveProjectDiagnostic into ok.project", () => {
  const cache = createSourceCache("/");
  const result = resolveAll(
    {
      file: [],
      project: [
        makeValidatedProject({
          filename: "tsconfig.json",
          code: "typescript(tsconfig-error)",
          message: "tsconfig msg",
        }),
      ],
    },
    cache,
  );

  assert.equal(result.kind, "ok");
  if (result.kind !== "ok") return;
  assert.equal(result.file.length, 0);
  assert.deepEqual(result.project, [
    {
      filename: "tsconfig.json",
      errorCode: "typescript(tsconfig-error)",
      message: "tsconfig msg",
    },
  ]);
});

void test("resolveAll: span-resolution failure short-circuits as contract-failure with filename/offset/length in the reason", () => {
  const cache = createSourceCache("/");
  const filename = "/nonexistent/path/to/file.ts";

  const result = resolveAll(
    {
      file: [
        makeValidated({
          filename,
          labels: [{ span: { offset: 7, length: 3 } }],
        }),
      ],
      project: [],
    },
    cache,
  );

  assert.equal(result.kind, "contract-failure");
  if (result.kind !== "contract-failure") return;
  assert.match(result.reason, /^failed to resolve span/);
  assert.ok(result.reason.includes(`filename=${filename}`));
  assert.ok(result.reason.includes("offset=7"));
  assert.ok(result.reason.includes("length=3"));
});

void test("resolveAll: stops at the first failing file diagnostic and never resolves later entries", (t) => {
  // Second entry is well-formed against an existing fixture file, but resolveAll must short-circuit
  // on the first failure and surface its filename — not the second one — in the reason.
  const dir = setupFixture(t, { "ok.ts": "debugger;\n" });
  const okFile = join(dir, "ok.ts");
  const cache = createSourceCache(dir);

  const result = resolveAll(
    {
      file: [
        makeValidated({
          filename: "/nonexistent.ts",
          labels: [{ span: { offset: 0, length: 1 } }],
        }),
        makeValidated({ filename: okFile }),
      ],
      project: [],
    },
    cache,
  );

  assert.equal(result.kind, "contract-failure");
  if (result.kind !== "contract-failure") return;
  assert.ok(result.reason.includes("/nonexistent.ts"));
  assert.ok(!result.reason.includes(okFile));
});
