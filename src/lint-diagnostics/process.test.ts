import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { HINT_PATH, makeStdout, setupFixture } from "../../test/lint-diagnostics-helpers.ts";
import { processLintRun, type ProcessLintRunOptions } from "./process.ts";

const OPTIONS: ProcessLintRunOptions = {
  outputMode: "stylish",
  check: false,
  weakTypingsDocPath: HINT_PATH,
};

void test("processLintRun: no-files signal from oxlint surfaces as no-files", () => {
  const result = processLintRun(
    "No files found to lint. Please check your paths and ignore patterns.\n",
    "/",
    OPTIONS,
  );
  assert.deepEqual(result, { kind: "no-files" });
});

void test("processLintRun: empty diagnostics array surfaces as clean", () => {
  const result = processLintRun(makeStdout([]), "/", OPTIONS);
  assert.deepEqual(result, { kind: "clean" });
});

void test("processLintRun: classify-stage contract failure carries the raw stdout through", () => {
  const broken = "{not valid json";
  const result = processLintRun(broken, "/", OPTIONS);

  assert.equal(result.kind, "contract-failure");
  if (result.kind !== "contract-failure") return;
  assert.equal(result.rawStdout, broken);
  assert.match(result.reason, /JSON/);
});

void test("processLintRun: resolve-stage span failure surfaces as contract-failure with raw stdout", () => {
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
  const result = processLintRun(stdout, "/", OPTIONS);

  assert.equal(result.kind, "contract-failure");
  if (result.kind !== "contract-failure") return;
  assert.equal(result.rawStdout, stdout);
  assert.match(result.reason, /^failed to resolve span/);
});

void test("processLintRun: full findings flow renders all blocks end-to-end", (t) => {
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

  const result = processLintRun(stdout, dir, OPTIONS);

  assert.equal(result.kind, "findings");
  if (result.kind !== "findings") return;
  assert.match(result.rendered.fileBlock, /\[eslint\(no-debugger\)\]/);
  assert.match(result.rendered.fileBlock, /debugger/);
  assert.equal(result.rendered.projectBlock, "");
  assert.equal(result.rendered.weakTypingsHint, "");
  assert.equal(result.rendered.summaryLine, "1 unfixed lint issue.");
});
