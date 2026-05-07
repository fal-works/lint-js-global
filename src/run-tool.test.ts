import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { LintJsError } from "./error.ts";
import { runToolCapturingOutput } from "./run-tool.ts";

/**
 * Drop a tmp JS file `script.js` containing the given source, and clean up at teardown.
 *
 * @returns Absolute path to the script.
 */
function makeScript(t: TestContext, source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "lint-js-runtool-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "script.js");
  writeFileSync(path, source);
  return path;
}

void test("runToolCapturingOutput: signal-driven termination throws LintJsError", (t) => {
  // Self-kill via SIGTERM. Linux only; project test target is WSL2.
  const bin = makeScript(t, "process.kill(process.pid, 'SIGTERM');\n");

  assert.throws(
    () => runToolCapturingOutput({ name: "self-killer", bin, args: [] }),
    (err) =>
      err instanceof LintJsError &&
      /self-killer was terminated by signal SIGTERM/.test(err.message),
  );
});

void test("runToolCapturingOutput: non-zero exit propagates via result.status (no throw)", (t) => {
  const bin = makeScript(t, "process.exit(7);\n");

  const { result } = runToolCapturingOutput({ name: "exit7", bin, args: [] });

  assert.equal(result.status, 7, "non-zero status passes through to the caller");
  assert.equal(result.signal, null);
});

void test("runToolCapturingOutput: clean exit returns captured streams", (t) => {
  const bin = makeScript(
    t,
    "process.stdout.write('hello-out');\nprocess.stderr.write('hello-err');\n",
  );

  const { result, capturedStdout, capturedStderr } = runToolCapturingOutput({
    name: "echo",
    bin,
    args: [],
  });

  assert.equal(result.status, 0);
  assert.equal(capturedStdout, "hello-out");
  assert.equal(capturedStderr, "hello-err");
});
