import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { makeStdout, setupFixture } from "../../../test/lint-diagnostics-helpers.ts";
import { interpretOxlintOutput } from "./interpret.ts";

void test("interpretOxlintOutput: no-files signal from oxlint surfaces as no-files", () => {
  const result = interpretOxlintOutput(
    `No files found to lint. Please check your paths and ignore patterns.\n${JSON.stringify({
      diagnostics: [],
      number_of_files: 0,
    })}\n`,
    "/",
  );
  assert.deepEqual(result, { kind: "no-files" });
});

void test("interpretOxlintOutput: empty diagnostics array surfaces as clean", () => {
  const result = interpretOxlintOutput(makeStdout([]), "/");
  assert.deepEqual(result, { kind: "clean" });
});

void test("interpretOxlintOutput: classify-stage contract failure carries the raw stdout through", () => {
  const broken = "{not valid json";
  const result = interpretOxlintOutput(broken, "/");

  assert.equal(result.kind, "contract-failure");
  if (result.kind !== "contract-failure") return;
  assert.equal(result.rawStdout, broken);
  assert.match(result.reason, /JSON/);
});

void test("interpretOxlintOutput: resolve-stage span failure surfaces as contract-failure with raw stdout", () => {
  // Filename does not exist on disk, so span resolution fails and the run flips to contract-failure.
  const stdout = makeStdout([
    {
      message: "msg",
      code: "eslint(no-debugger)",
      severity: "error",
      filename: "/nonexistent/path/to/file.ts",
      labels: [{ span: { offset: 0, length: 1 } }],
    },
  ]);
  const result = interpretOxlintOutput(stdout, "/");

  assert.equal(result.kind, "contract-failure");
  if (result.kind !== "contract-failure") return;
  assert.equal(result.rawStdout, stdout);
  assert.match(result.reason, /^failed to resolve span/);
});

void test("interpretOxlintOutput: full findings flow yields IR with resolved span fields", (t) => {
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

  const result = interpretOxlintOutput(stdout, dir);

  assert.equal(result.kind, "findings");
  if (result.kind !== "findings") return;
  assert.equal(result.findings.project.length, 0);
  assert.deepEqual(result.findings.file, [
    {
      filename: file,
      code: "eslint(no-debugger)",
      message: "`debugger` statement is not allowed.",
      startLine: 1,
      startCol: 1,
      endLine: 1,
      endCol: 8,
      spanText: "debugger",
    },
  ]);
});

void test("interpretOxlintOutput: parse-error diagnostic preserves null code in the IR", (t) => {
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

  const result = interpretOxlintOutput(stdout, dir);

  assert.equal(result.kind, "findings");
  if (result.kind !== "findings") return;
  assert.equal(result.findings.file[0]?.code, null);
});
