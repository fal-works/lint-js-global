import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { createConsoleLogger } from "../../src/log.ts";

function captureConsole(t: TestContext): { stdout(): string; stderr(): string } {
  let stdout = "";
  let stderr = "";
  t.mock.method(process.stdout, "write", ((chunk: string | Uint8Array) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write);
  t.mock.method(process.stderr, "write", ((chunk: string | Uint8Array) => {
    stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write);
  return {
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

void test("markBlankSeparator alone writes nothing", (t) => {
  const captured = captureConsole(t);
  const logger = createConsoleLogger();

  logger.markBlankSeparator();

  assert.equal(captured.stdout(), "");
  assert.equal(captured.stderr(), "");
});

void test("separator is emitted before the next non-empty write", (t) => {
  const captured = captureConsole(t);
  const logger = createConsoleLogger();

  logger.writeErr("first\n");
  logger.markBlankSeparator();
  logger.writeErr("second\n");

  assert.equal(captured.stdout(), "");
  assert.equal(captured.stderr(), "first\n\nsecond\n");
});

void test("consecutive separators collapse to one blank line", (t) => {
  const captured = captureConsole(t);
  const logger = createConsoleLogger();

  logger.writeErr("first\n");
  logger.markBlankSeparator();
  logger.markBlankSeparator();
  logger.writeErr("second\n");

  assert.equal(captured.stdout(), "");
  assert.equal(captured.stderr(), "first\n\nsecond\n");
});

void test("empty write does not create or flush a separator", (t) => {
  const captured = captureConsole(t);
  const logger = createConsoleLogger();

  logger.writeOut("");
  logger.writeErr("first\n");
  logger.markBlankSeparator();
  logger.writeErr("");
  logger.writeErr("second\n");

  assert.equal(captured.stdout(), "");
  assert.equal(captured.stderr(), "first\n\nsecond\n");
});

void test("separator applies before tagged stderr blocks", (t) => {
  const captured = captureConsole(t);
  const logger = createConsoleLogger();

  logger.writeErr("first\n");
  logger.markBlankSeparator();
  logger.writeErrTagged("Failed.", "detail");

  assert.equal(captured.stdout(), "");
  assert.equal(captured.stderr(), "first\n\nlint-js: Failed.\n  detail\n");
});

void test("separator before the first tagged block is dropped", (t) => {
  const captured = captureConsole(t);
  const logger = createConsoleLogger();

  logger.markBlankSeparator();
  logger.writeErrTagged("Failed.", "detail");

  assert.equal(captured.stdout(), "");
  assert.equal(captured.stderr(), "lint-js: Failed.\n  detail\n");
});
