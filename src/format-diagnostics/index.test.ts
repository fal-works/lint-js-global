import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import {
  HINT_PATH,
  joinSections,
  makeStdout,
  setupFixture,
} from "../../test/format-diagnostics-helpers.ts";
import { formatLintOutput } from "./index.ts";

void test("stylish mode: single file, single diagnostic produces grouped output and summary", (t) => {
  const dir = setupFixture(t, { "x.ts": "debugger;\n" });
  const file = join(dir, "x.ts");
  const stdout = makeStdout([
    {
      message: "`debugger` statement is not allowed.",
      code: "eslint(no-debugger)",
      severity: "error",
      filename: file,
      labels: [{ span: { offset: 0, length: 8, line: 1, column: 1 } }],
    },
  ]);

  const result = formatLintOutput({
    capturedStdout: stdout,
    check: false,
    outputMode: "stylish",
    weakTypingsDocPath: HINT_PATH,
  });

  assert.deepEqual(result, {
    kind: "diagnostics",
    formattedDiagnostics: joinSections([
      [file, "  1:1 `debugger` statement is not allowed. [eslint(no-debugger)]", "    debugger"],
    ]),
    weakTypingsHint: null,
    linterSummary: "1 unfixed lint issue in 1 file.",
  });
});

void test("unix mode: single file, single diagnostic produces a single flat line and summary", (t) => {
  const dir = setupFixture(t, { "x.ts": "debugger;\n" });
  const file = join(dir, "x.ts");
  const stdout = makeStdout([
    {
      message: "`debugger` statement is not allowed.",
      code: "eslint(no-debugger)",
      severity: "error",
      filename: file,
      labels: [{ span: { offset: 0, length: 8, line: 1, column: 1 } }],
    },
  ]);

  const result = formatLintOutput({
    capturedStdout: stdout,
    check: false,
    outputMode: "unix",
    weakTypingsDocPath: HINT_PATH,
  });

  assert.deepEqual(result, {
    kind: "diagnostics",
    formattedDiagnostics: `${file}:1:1: \`debugger\` statement is not allowed. [eslint(no-debugger)]\n`,
    weakTypingsHint: null,
    linterSummary: "1 unfixed lint issue in 1 file.",
  });
});

void test("no-unsafe-* diagnostic surfaces weakTypingsHint alongside the diagnostics (stylish mode)", (t) => {
  const dir = setupFixture(t, { "x.ts": "let data;\ndata.foo;\n" });
  const file = join(dir, "x.ts");
  const stdout = makeStdout([
    {
      message: "Unsafe member access .foo on an `any` value.",
      code: "typescript-eslint(no-unsafe-member-access)",
      severity: "error",
      filename: file,
      labels: [{ span: { offset: 14, length: 3, line: 2, column: 6 } }],
    },
  ]);

  const result = formatLintOutput({
    capturedStdout: stdout,
    check: false,
    outputMode: "stylish",
    weakTypingsDocPath: HINT_PATH,
  });

  assert.equal(result.kind, "diagnostics");
  if (result.kind !== "diagnostics") return;
  assert.match(result.formattedDiagnostics, /no-unsafe-member-access/);
  assert.ok(!result.formattedDiagnostics.includes("Hint on the"));
  assert.ok(result.weakTypingsHint !== null);
  assert.match(result.weakTypingsHint, /^Hint on the `no-unsafe-\*` diagnostics:/);
  assert.match(result.weakTypingsHint, new RegExp(`- See: ${HINT_PATH}\\n$`));
  assert.equal(result.linterSummary, "1 unfixed lint issue in 1 file.");
});

void test("no-unsafe-* diagnostic surfaces weakTypingsHint under unix mode too", (t) => {
  // Hint and summary are mode-independent: unix mode gets the same auxiliary text.
  const dir = setupFixture(t, { "x.ts": "let data;\ndata.foo;\n" });
  const file = join(dir, "x.ts");
  const stdout = makeStdout([
    {
      message: "Unsafe member access .foo on an `any` value.",
      code: "typescript-eslint(no-unsafe-member-access)",
      severity: "error",
      filename: file,
      labels: [{ span: { offset: 14, length: 3, line: 2, column: 6 } }],
    },
  ]);

  const result = formatLintOutput({
    capturedStdout: stdout,
    check: false,
    outputMode: "unix",
    weakTypingsDocPath: HINT_PATH,
  });

  assert.equal(result.kind, "diagnostics");
  if (result.kind !== "diagnostics") return;
  assert.equal(
    result.formattedDiagnostics,
    `${file}:2:5: Unsafe member access .foo on an \`any\` value. [typescript-eslint(no-unsafe-member-access)]\n`,
  );
  assert.ok(result.weakTypingsHint !== null);
  assert.match(result.weakTypingsHint, /^Hint on the `no-unsafe-\*` diagnostics:/);
  assert.equal(result.linterSummary, "1 unfixed lint issue in 1 file.");
});

void test("zero diagnostics yields empty payload and null aux fields (stylish mode)", () => {
  const result = formatLintOutput({
    capturedStdout: makeStdout([]),
    check: false,
    outputMode: "stylish",
    weakTypingsDocPath: HINT_PATH,
  });

  assert.deepEqual(result, {
    kind: "diagnostics",
    formattedDiagnostics: "",
    weakTypingsHint: null,
    linterSummary: null,
  });
});

void test("zero diagnostics yields empty payload and null aux fields (unix mode)", () => {
  const result = formatLintOutput({
    capturedStdout: makeStdout([]),
    check: false,
    outputMode: "unix",
    weakTypingsDocPath: HINT_PATH,
  });

  assert.deepEqual(result, {
    kind: "diagnostics",
    formattedDiagnostics: "",
    weakTypingsHint: null,
    linterSummary: null,
  });
});

void test("empty stdout is treated as a clean diagnostics run, not a contract failure", () => {
  const result = formatLintOutput({
    capturedStdout: "",
    check: false,
    outputMode: "stylish",
    weakTypingsDocPath: HINT_PATH,
  });

  assert.deepEqual(result, {
    kind: "diagnostics",
    formattedDiagnostics: "",
    weakTypingsHint: null,
    linterSummary: null,
  });
});

void test("broken JSON surfaces as contract-failure carrying the raw payload (stylish mode)", () => {
  const broken = "{not valid json";

  const result = formatLintOutput({
    capturedStdout: broken,
    check: false,
    outputMode: "stylish",
    weakTypingsDocPath: HINT_PATH,
  });

  assert.equal(result.kind, "contract-failure");
  if (result.kind !== "contract-failure") return;
  assert.equal(result.rawStdout, broken);
  assert.match(result.reason, /JSON/);
});

void test("broken JSON surfaces as contract-failure under unix mode (tool-failure path)", () => {
  // Free-form tool-failure text from oxlint (e.g. tsgolint resolution failure, missing config)
  // is not parseable as JSON, so unix mode must surface it through the same contract-failure
  // channel as stylish mode rather than passing it through to stdout as a fake lint finding.
  const broken = "Failed to find tsconfig.json for src/index.ts.\n";

  const result = formatLintOutput({
    capturedStdout: broken,
    check: false,
    outputMode: "unix",
    weakTypingsDocPath: HINT_PATH,
  });

  assert.equal(result.kind, "contract-failure");
  if (result.kind !== "contract-failure") return;
  assert.equal(result.rawStdout, broken);
  assert.match(result.reason, /JSON/);
});

void test("schema-mismatch from validator surfaces as contract-failure with the validator's reason", () => {
  // Smoke test that the validator's failure reason flows through to contract-failure.reason.
  // Detail-level cases live in oxlint-json-schema.test.ts.
  const raw = JSON.stringify({ fatal: "internal error", number_of_files: 0 });

  const result = formatLintOutput({
    capturedStdout: raw,
    check: false,
    outputMode: "stylish",
    weakTypingsDocPath: HINT_PATH,
  });

  assert.equal(result.kind, "contract-failure");
  if (result.kind !== "contract-failure") return;
  assert.equal(result.rawStdout, raw);
  assert.match(result.reason, /diagnostics/);
});

void test("oxc parse-error diagnostic stays a lint finding (stylish mode)", (t) => {
  // A diagnostic with `code: null` is the oxc parser-error shape. It must pass schema
  // validation (validateOptionalString accepts null) and render as a real lint finding,
  // not as a tool-failure escalation.
  const dir = setupFixture(t, { "x.ts": "const x = ;\n" });
  const file = join(dir, "x.ts");
  const stdout = makeStdout([
    {
      message: "Unexpected token.",
      code: null,
      severity: "error",
      filename: file,
      labels: [{ span: { offset: 10, length: 1, line: 1, column: 11 } }],
    },
  ]);

  const result = formatLintOutput({
    capturedStdout: stdout,
    check: false,
    outputMode: "stylish",
    weakTypingsDocPath: HINT_PATH,
  });

  assert.equal(result.kind, "diagnostics");
  if (result.kind !== "diagnostics") return;
  assert.match(result.formattedDiagnostics, /\[parse-error\]/);
  assert.equal(result.linterSummary, "1 unfixed lint issue in 1 file.");
});

void test("oxc parse-error diagnostic stays a lint finding (unix mode)", (t) => {
  const dir = setupFixture(t, { "x.ts": "const x = ;\n" });
  const file = join(dir, "x.ts");
  const stdout = makeStdout([
    {
      message: "Unexpected token.",
      code: null,
      severity: "error",
      filename: file,
      labels: [{ span: { offset: 10, length: 1, line: 1, column: 11 } }],
    },
  ]);

  const result = formatLintOutput({
    capturedStdout: stdout,
    check: false,
    outputMode: "unix",
    weakTypingsDocPath: HINT_PATH,
  });

  assert.deepEqual(result, {
    kind: "diagnostics",
    formattedDiagnostics: `${file}:1:11: Unexpected token. [parse-error]\n`,
    weakTypingsHint: null,
    linterSummary: "1 unfixed lint issue in 1 file.",
  });
});

void test('"No files found to lint." prefix is treated as a no-files run (stylish mode)', () => {
  const result = formatLintOutput({
    capturedStdout:
      'No files found to lint. Please check your paths and ignore patterns.\n{ "diagnostics": [], "number_of_files": 0 }\n',
    check: false,
    outputMode: "stylish",
    weakTypingsDocPath: HINT_PATH,
  });

  assert.deepEqual(result, { kind: "no-files" });
});

void test('"No files found to lint." prefix is treated as a no-files run (unix mode)', () => {
  const result = formatLintOutput({
    capturedStdout: "No files found to lint. Please check your paths and ignore patterns.\n",
    check: false,
    outputMode: "unix",
    weakTypingsDocPath: HINT_PATH,
  });

  assert.deepEqual(result, { kind: "no-files" });
});
