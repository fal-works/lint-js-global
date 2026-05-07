import assert from "node:assert/strict";
import test from "node:test";

import { validatePayload } from "./oxlint-json-schema.ts";

void test("valid payload with one diagnostic resolves to ValidatedDiagnostic[]", () => {
  const result = validatePayload({
    diagnostics: [
      {
        filename: "/x.ts",
        code: "eslint(no-debugger)",
        message: "ok",
        labels: [{ span: { offset: 0, length: 8, line: 1, column: 1 } }],
      },
    ],
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok ? result.value : null, [
    {
      filename: "/x.ts",
      code: "eslint(no-debugger)",
      message: "ok",
      span: { offset: 0, length: 8, line: 1, column: 1 },
    },
  ]);
});

void test("empty diagnostics array resolves to []", () => {
  const result = validatePayload({ diagnostics: [] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok ? result.value : null, []);
});

void test("explicit null code is accepted and surfaces as null", () => {
  // The contract permits null `code` (oxc parser-error diagnostics omit it).
  const result = validatePayload({
    diagnostics: [
      {
        filename: "/x.ts",
        code: null,
        message: "Unexpected token",
        labels: [{ span: { offset: 0, length: 1, line: 1, column: 1 } }],
      },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.value[0]?.code : "x", null);
});

void test("missing code field is treated as null (omitted, not absent contract)", () => {
  const result = validatePayload({
    diagnostics: [
      {
        filename: "/x.ts",
        message: "Unexpected token",
        labels: [{ span: { offset: 0, length: 1, line: 1, column: 1 } }],
      },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.value[0]?.code : "x", null);
});

void test("non-object top-level value is rejected (bare null)", () => {
  const result = validatePayload(null);
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /top-level/);
});

void test("missing diagnostics field is rejected", () => {
  const result = validatePayload({ fatal: "internal error", number_of_files: 0 });
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /diagnostics/);
});

void test("non-array diagnostics field is rejected", () => {
  const result = validatePayload({ diagnostics: "oops not an array" });
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /diagnostics/);
});

void test("entry missing filename is rejected with index", () => {
  const result = validatePayload({
    diagnostics: [
      {
        code: "eslint(no-debugger)",
        message: "x",
        labels: [{ span: { offset: 0, length: 1, line: 1, column: 1 } }],
      },
    ],
  });

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /diagnostics\[0\]/);
  assert.match(result.ok ? "" : result.reason, /filename/);
});

void test("entry missing message is rejected", () => {
  // `message` is contractually required: oxlint always emits it. Tightening this ensures
  // any upstream drift that drops the field surfaces as a contract failure.
  const result = validatePayload({
    diagnostics: [
      {
        filename: "/x.ts",
        code: "eslint(no-debugger)",
        labels: [{ span: { offset: 0, length: 1, line: 1, column: 1 } }],
      },
    ],
  });

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /message.*missing|missing.*message/);
});

void test("entry with non-string code (object) is rejected", () => {
  // Even with a valid `message`, a wrong-typed `code` must not be silently dropped:
  // upstream schema drift (e.g. `code` becoming a structured object) should surface.
  const result = validatePayload({
    diagnostics: [
      {
        filename: "/x.ts",
        code: { plugin: "eslint", rule: "no-debugger" },
        message: "ok",
        labels: [{ span: { offset: 0, length: 1, line: 1, column: 1 } }],
      },
    ],
  });

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /code/);
});

void test("entry with non-string message (number) is rejected", () => {
  const result = validatePayload({
    diagnostics: [
      {
        filename: "/x.ts",
        code: "eslint(no-debugger)",
        message: 42,
        labels: [{ span: { offset: 0, length: 1, line: 1, column: 1 } }],
      },
    ],
  });

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /message/);
});

void test("entry missing labels[0].span is rejected", () => {
  const result = validatePayload({
    diagnostics: [
      {
        filename: "/x.ts",
        code: "eslint(no-debugger)",
        message: "x",
        labels: [{}],
      },
    ],
  });

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /span/);
});

void test("entry with non-numeric span.offset is rejected", () => {
  const result = validatePayload({
    diagnostics: [
      {
        filename: "/x.ts",
        code: "eslint(no-debugger)",
        message: "x",
        labels: [{ span: { offset: "0", length: 1, line: 1, column: 1 } }],
      },
    ],
  });

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /offset/);
});

void test("entry with negative span.offset is rejected", () => {
  const result = validatePayload({
    diagnostics: [
      {
        filename: "/x.ts",
        code: "eslint(no-debugger)",
        message: "x",
        labels: [{ span: { offset: -1, length: 1, line: 1, column: 1 } }],
      },
    ],
  });

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /offset.*non-negative/);
});

void test("entry with fractional span.length is rejected", () => {
  const result = validatePayload({
    diagnostics: [
      {
        filename: "/x.ts",
        code: "eslint(no-debugger)",
        message: "x",
        labels: [{ span: { offset: 0, length: 1.5, line: 1, column: 1 } }],
      },
    ],
  });

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /length.*non-negative/);
});

void test("entry with span.line below 1 is rejected", () => {
  const result = validatePayload({
    diagnostics: [
      {
        filename: "/x.ts",
        code: "eslint(no-debugger)",
        message: "x",
        labels: [{ span: { offset: 0, length: 1, line: 0, column: 1 } }],
      },
    ],
  });

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /line.*positive/);
});

void test("entry with span.column below 1 is rejected", () => {
  const result = validatePayload({
    diagnostics: [
      {
        filename: "/x.ts",
        code: "eslint(no-debugger)",
        message: "x",
        labels: [{ span: { offset: 0, length: 1, line: 1, column: 0 } }],
      },
    ],
  });

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /column.*positive/);
});

void test("first failing entry's index is reported", () => {
  const result = validatePayload({
    diagnostics: [
      {
        filename: "/x.ts",
        code: "eslint(no-debugger)",
        message: "ok",
        labels: [{ span: { offset: 0, length: 8, line: 1, column: 1 } }],
      },
      {
        // second entry malformed: missing labels
        filename: "/x.ts",
        code: "eslint(no-debugger)",
        message: "broken",
      },
    ],
  });

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /diagnostics\[1\]/);
  assert.match(result.ok ? "" : result.reason, /labels/);
});
