import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { LintJsError } from "../error.ts";
import {
  runCommandCapturingOutput,
  runToolCapturingCombined,
  runToolCapturingOutput,
} from "./subprocess.ts";

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

void test("runToolCapturingOutput: signal-driven termination throws LintJsError", async (t) => {
  // Self-kill via SIGTERM. Linux only; project test target is WSL2.
  const bin = makeScript(t, "process.kill(process.pid, 'SIGTERM');\n");

  await assert.rejects(
    () => runToolCapturingOutput({ name: "self-killer", bin, args: [] }),
    (err) =>
      err instanceof LintJsError &&
      /self-killer was terminated by signal SIGTERM/.test(err.message),
  );
});

void test("runToolCapturingOutput: non-zero exit propagates via result.status (no throw)", async (t) => {
  const bin = makeScript(t, "process.exit(7);\n");

  const { result } = await runToolCapturingOutput({ name: "exit7", bin, args: [] });

  assert.equal(result.status, 7, "non-zero status passes through to the caller");
  assert.equal(result.signal, null);
});

void test("runToolCapturingOutput: clean exit returns captured streams", async (t) => {
  const bin = makeScript(
    t,
    "process.stdout.write('hello-out');\nprocess.stderr.write('hello-err');\n",
  );

  const { result, capturedStdout, capturedStderr } = await runToolCapturingOutput({
    name: "echo",
    bin,
    args: [],
  });

  assert.equal(result.status, 0);
  assert.equal(capturedStdout, "hello-out");
  assert.equal(capturedStderr, "hello-err");
});

void test("runCommandCapturingOutput: clean exit returns captured streams", async (t) => {
  const bin = makeScript(t, "process.stdout.write('cmd-out');\nprocess.stderr.write('cmd-err');\n");

  const { result, capturedStdout, capturedStderr } = await runCommandCapturingOutput({
    name: "command-echo",
    command: process.execPath,
    args: [bin],
  });

  assert.equal(result.status, 0);
  assert.equal(capturedStdout, "cmd-out");
  assert.equal(capturedStderr, "cmd-err");
});

void test("runCommandCapturingOutput: launch failure throws LintJsError", async () => {
  await assert.rejects(
    () =>
      runCommandCapturingOutput({
        name: "missing-command",
        command: join(tmpdir(), "lint-js-runtool-missing-command"),
        args: [],
      }),
    (err) => err instanceof LintJsError && /failed to launch missing-command:/.test(err.message),
  );
});

void test("runToolCapturingCombined: clean exit returns combined output", async (t) => {
  const bin = makeScript(
    t,
    "process.stdout.write('combined-out');\nprocess.stderr.write('combined-err');\n",
  );

  const { result, captured } = await runToolCapturingCombined({ name: "combined", bin, args: [] });

  assert.equal(result.status, 0);
  assert.equal(captured, "combined-outcombined-err");
});

void test("runToolCapturingOutput: child sees NO_COLOR=1 and no FORCE_COLOR/CLICOLOR_FORCE", async (t) => {
  const bin = makeScript(
    t,
    `process.stdout.write(JSON.stringify({
       hasForceColor: 'FORCE_COLOR' in process.env,
       hasCliColorForce: 'CLICOLOR_FORCE' in process.env,
       noColor: process.env.NO_COLOR ?? null,
     }));`,
  );

  const env: NodeJS.ProcessEnv = { ...process.env, FORCE_COLOR: "3", CLICOLOR_FORCE: "1" };
  const { capturedStdout } = await runToolCapturingOutput({
    name: "envcheck",
    bin,
    args: [],
    env,
  });

  assert.deepEqual(JSON.parse(capturedStdout), {
    hasForceColor: false,
    hasCliColorForce: false,
    noColor: "1",
  });
});
