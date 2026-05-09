import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import {
  HINT_PATH,
  joinSections,
  makeStdout,
  setupFixture,
} from "../../test/lint-diagnostics-helpers.ts";
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
      labels: [{ span: { offset: 0, length: 8 } }],
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
    fileDiagnostics: joinSections([
      [file, "  1:1 `debugger` statement is not allowed. [eslint(no-debugger)]", "    debugger"],
    ]),
    projectDiagnostics: "",
    weakTypingsHint: null,
    linterSummary: "1 unfixed lint issue.",
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
      labels: [{ span: { offset: 0, length: 8 } }],
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
    fileDiagnostics: `${file}:1:1: \`debugger\` statement is not allowed. [eslint(no-debugger)]\n`,
    projectDiagnostics: "",
    weakTypingsHint: null,
    linterSummary: "1 unfixed lint issue.",
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
      labels: [{ span: { offset: 14, length: 3 } }],
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
  assert.match(result.fileDiagnostics, /no-unsafe-member-access/);
  assert.ok(!result.fileDiagnostics.includes("Hint on the"));
  assert.ok(result.weakTypingsHint !== null);
  assert.match(result.weakTypingsHint, /^Hint on the `no-unsafe-\*` diagnostics:/);
  assert.match(result.weakTypingsHint, new RegExp(`- See: ${HINT_PATH}\\n$`));
  assert.equal(result.linterSummary, "1 unfixed lint issue.");
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
      labels: [{ span: { offset: 14, length: 3 } }],
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
    result.fileDiagnostics,
    `${file}:2:5: Unsafe member access .foo on an \`any\` value. [typescript-eslint(no-unsafe-member-access)]\n`,
  );
  assert.ok(result.weakTypingsHint !== null);
  assert.match(result.weakTypingsHint, /^Hint on the `no-unsafe-\*` diagnostics:/);
  assert.equal(result.linterSummary, "1 unfixed lint issue.");
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
    fileDiagnostics: "",
    projectDiagnostics: "",
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
    fileDiagnostics: "",
    projectDiagnostics: "",
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
    fileDiagnostics: "",
    projectDiagnostics: "",
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

void test("span-resolution failure surfaces as contract-failure with filename/offset/length in reason", () => {
  const filename = "/nonexistent/path/to/file.ts";
  const stdout = makeStdout([
    {
      message: "msg",
      code: "eslint(no-debugger)",
      severity: "error",
      filename,
      labels: [{ span: { offset: 7, length: 3 } }],
    },
  ]);

  const result = formatLintOutput({
    capturedStdout: stdout,
    check: false,
    outputMode: "stylish",
    weakTypingsDocPath: HINT_PATH,
  });

  assert.equal(result.kind, "contract-failure");
  if (result.kind !== "contract-failure") return;
  assert.equal(result.rawStdout, stdout);
  assert.match(result.reason, /failed to resolve span/);
  assert.ok(result.reason.includes(`filename=${filename}`));
  assert.ok(result.reason.includes("offset=7"));
  assert.ok(result.reason.includes("length=3"));
});

void test("schema-mismatch from validator surfaces as contract-failure with the validator's reason", () => {
  // Smoke test that the validator's failure reason flows through to contract-failure.reason.
  // Detail-level cases live in schema.test.ts.
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
      labels: [{ span: { offset: 10, length: 1 } }],
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
  assert.match(result.fileDiagnostics, /\[parse-error\]/);
  assert.equal(result.linterSummary, "1 unfixed lint issue.");
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
      labels: [{ span: { offset: 10, length: 1 } }],
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
    fileDiagnostics: `${file}:1:11: Unexpected token. [parse-error]\n`,
    projectDiagnostics: "",
    weakTypingsHint: null,
    linterSummary: "1 unfixed lint issue.",
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

void test("project-level diagnostic (empty labels) renders into the project block (stylish mode)", () => {
  // Surfaces as an ordinary lint finding rather than escalating to a contract failure.
  const stdout = makeStdout([
    {
      message: "Cannot find type definition file for 'node'.",
      code: "typescript(tsconfig-error)",
      severity: "error",
      filename: "tsconfig.json",
      labels: [],
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
    fileDiagnostics: "",
    projectDiagnostics:
      "tsconfig.json\n  Cannot find type definition file for 'node'. [typescript(tsconfig-error)]\n",
    weakTypingsHint: null,
    linterSummary: "1 unfixed lint issue.",
  });
});

void test("project-level diagnostic with empty filename uses the (project) placeholder (stylish mode)", () => {
  const stdout = makeStdout([
    {
      message: "Cannot find type definition file for 'node'.",
      code: "typescript(tsconfig-error)",
      severity: "error",
      filename: "",
      labels: [],
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
  assert.equal(
    result.projectDiagnostics,
    "(project)\n  Cannot find type definition file for 'node'. [typescript(tsconfig-error)]\n",
  );
  assert.equal(result.fileDiagnostics, "");
});

void test("project-level diagnostic renders one location-less line in unix mode", () => {
  const stdout = makeStdout([
    {
      message: "msg",
      code: "typescript(tsconfig-error)",
      severity: "error",
      filename: "tsconfig.json",
      labels: [],
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
  assert.equal(result.projectDiagnostics, "tsconfig.json: msg [typescript(tsconfig-error)]\n");
  assert.equal(result.fileDiagnostics, "");
});

void test("mixed payload splits project and file blocks across separate fields (stylish mode)", (t) => {
  const dir = setupFixture(t, { "x.ts": "debugger;\n" });
  const file = join(dir, "x.ts");
  const stdout = makeStdout([
    {
      message: "`debugger` statement is not allowed.",
      code: "eslint(no-debugger)",
      severity: "error",
      filename: file,
      labels: [{ span: { offset: 0, length: 8 } }],
    },
    {
      message: "Cannot find type definition file for 'node'.",
      code: "typescript(tsconfig-error)",
      severity: "error",
      filename: "tsconfig.json",
      labels: [],
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
    fileDiagnostics: joinSections([
      [file, "  1:1 `debugger` statement is not allowed. [eslint(no-debugger)]", "    debugger"],
    ]),
    projectDiagnostics:
      "tsconfig.json\n  Cannot find type definition file for 'node'. [typescript(tsconfig-error)]\n",
    weakTypingsHint: null,
    linterSummary: "2 unfixed lint issues.",
  });
});

void test("project-level diagnostic with omitted `labels` field is accepted just like an empty array", () => {
  // Hand-crafted raw stdout because `makeStdout` always carries a `labels` field.
  const raw = JSON.stringify({
    diagnostics: [
      {
        filename: "tsconfig.json",
        code: "typescript(tsconfig-error)",
        message: "msg",
      },
    ],
    number_of_files: 0,
    number_of_rules: 0,
    threads_count: 1,
    start_time: 0,
  });

  const result = formatLintOutput({
    capturedStdout: raw,
    check: false,
    outputMode: "unix",
    weakTypingsDocPath: HINT_PATH,
  });

  assert.equal(result.kind, "diagnostics");
  if (result.kind !== "diagnostics") return;
  assert.equal(result.projectDiagnostics, "tsconfig.json: msg [typescript(tsconfig-error)]\n");
  assert.equal(result.fileDiagnostics, "");
  assert.equal(result.linterSummary, "1 unfixed lint issue.");
});
