import assert from "node:assert/strict";
import test from "node:test";

import { makeStdout } from "../../../test/lint-diagnostics-helpers.ts";
import { classifyLintRun } from "./classify.ts";

void test("classifyLintRun: 'No files found to lint.' prefix routes to no-files", () => {
  const result = classifyLintRun(
    'No files found to lint. Please check your paths and ignore patterns.\n{ "diagnostics": [], "number_of_files": 0 }\n',
  );
  assert.deepEqual(result, { kind: "no-files" });
});

void test("classifyLintRun: bare 'No files found to lint.' line routes to no-files", () => {
  const result = classifyLintRun(
    "No files found to lint. Please check your paths and ignore patterns.\n",
  );
  assert.deepEqual(result, { kind: "no-files" });
});

void test("classifyLintRun: empty stdout routes to clean", () => {
  assert.deepEqual(classifyLintRun(""), { kind: "clean" });
});

void test("classifyLintRun: empty diagnostics array routes to clean", () => {
  assert.deepEqual(classifyLintRun(makeStdout([])), { kind: "clean" });
});

void test("classifyLintRun: broken JSON surfaces as contract-failure carrying the raw payload", () => {
  const broken = "{not valid json";
  const result = classifyLintRun(broken);

  assert.equal(result.kind, "contract-failure");
  if (result.kind !== "contract-failure") return;
  assert.equal(result.rawStdout, broken);
  assert.match(result.reason, /JSON/);
});

void test("classifyLintRun: free-form tool-failure text is not parseable as JSON and surfaces as contract-failure", () => {
  // oxlint can emit free-form text on tsgolint resolution failure. The classifier must not
  // pass it through as a fake lint finding.
  const broken = "Failed to find tsconfig.json for src/index.ts.\n";
  const result = classifyLintRun(broken);

  assert.equal(result.kind, "contract-failure");
  if (result.kind !== "contract-failure") return;
  assert.equal(result.rawStdout, broken);
  assert.match(result.reason, /JSON/);
});

void test("classifyLintRun: schema mismatch from validator surfaces as contract-failure with the validator's reason", () => {
  const raw = JSON.stringify({ fatal: "internal error", number_of_files: 0 });
  const result = classifyLintRun(raw);

  assert.equal(result.kind, "contract-failure");
  if (result.kind !== "contract-failure") return;
  assert.equal(result.rawStdout, raw);
  assert.match(result.reason, /diagnostics/);
});

void test("classifyLintRun: file-only payload routes to findings with the project array empty", () => {
  const stdout = makeStdout([
    {
      message: "msg",
      code: "eslint(no-debugger)",
      severity: "error",
      filename: "/x.ts",
      labels: [{ span: { offset: 0, length: 8 } }],
    },
  ]);
  const result = classifyLintRun(stdout);

  assert.equal(result.kind, "findings");
  if (result.kind !== "findings") return;
  assert.equal(result.project.length, 0);
  assert.deepEqual(result.file, [
    {
      kind: "file",
      filename: "/x.ts",
      code: "eslint(no-debugger)",
      message: "msg",
      labels: [{ span: { offset: 0, length: 8 } }],
    },
  ]);
});

void test("classifyLintRun: project-only payload (empty labels) routes to findings with the file array empty", () => {
  const stdout = makeStdout([
    {
      message: "Cannot find type definition file for 'node'.",
      code: "typescript(tsconfig-error)",
      severity: "error",
      filename: "tsconfig.json",
      labels: [],
    },
  ]);
  const result = classifyLintRun(stdout);

  assert.equal(result.kind, "findings");
  if (result.kind !== "findings") return;
  assert.equal(result.file.length, 0);
  assert.deepEqual(result.project, [
    {
      kind: "project",
      filename: "tsconfig.json",
      code: "typescript(tsconfig-error)",
      message: "Cannot find type definition file for 'node'.",
      help: null,
    },
  ]);
});

void test("classifyLintRun: project-only payload with omitted `labels` field accepted as project", () => {
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
  const result = classifyLintRun(raw);

  assert.equal(result.kind, "findings");
  if (result.kind !== "findings") return;
  assert.equal(result.file.length, 0);
  assert.deepEqual(result.project, [
    {
      kind: "project",
      filename: "tsconfig.json",
      code: "typescript(tsconfig-error)",
      message: "msg",
      help: null,
    },
  ]);
});

void test("classifyLintRun: mixed payload splits diagnostics across file and project arrays", () => {
  const stdout = makeStdout([
    {
      message: "`debugger` statement is not allowed.",
      code: "eslint(no-debugger)",
      severity: "error",
      filename: "/x.ts",
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
  const result = classifyLintRun(stdout);

  assert.equal(result.kind, "findings");
  if (result.kind !== "findings") return;
  assert.equal(result.file.length, 1);
  assert.equal(result.project.length, 1);
  assert.equal(result.file.map((d) => d.filename).join(","), "/x.ts");
  assert.equal(result.project.map((d) => d.filename).join(","), "tsconfig.json");
});
