import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { copyFixture } from "../fixture-helpers.ts";
import { runRecording, streamText } from "../recording-helpers.ts";

const DEFAULT_TARGETS = ["."];

void test("--check halt: fatal fmt under --check still halts before lint", (t) => {
  const dir = copyFixture("with-node-modules");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "broken.ts"), "const x = ;\n");

  const { events, exitCode } = runRecording(dir, {
    mode: "full",
    check: true,
    outputMode: "stylish",
    targets: DEFAULT_TARGETS,
  });

  assert.equal(exitCode, 1);
  assert.equal(streamText(events, "out"), "", "no stdout because lint phase is skipped");
  assert.match(streamText(events, "err"), /Unexpected token/);
  assert.match(
    streamText(events, "err"),
    /^lint-js: Halted\. Resolve format errors above and re-run\.$/m,
  );
});

void test("--format-only: fatal fmt failure surfaces the fmt-specific failure summary", (t) => {
  // Halt suppresses duplicate parse-error output across phases; with no downstream phase,
  // it has nothing to suppress and falls through to a regular failure with fmt-specific wording.
  const dir = copyFixture("with-node-modules");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "broken.ts"), "const x = ;\n");

  const { events, exitCode } = runRecording(dir, {
    mode: "format-only",
    check: false,
    outputMode: "stylish",
    targets: DEFAULT_TARGETS,
  });

  assert.equal(exitCode, 1);
  const err = streamText(events, "err");
  assert.match(err, /Unexpected token/);
  assert.doesNotMatch(err, /Halted\./, "halt summary must not fire under --format-only");
  assert.match(err, /^lint-js: Failed\. Format errors remain\.$/m);
});

void test("--format-only: rewrites sources and skips lint phase entirely", (t) => {
  const dir = copyFixture("basic");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const target = join(dir, "src", "index.ts");
  const before = readFileSync(target, "utf8");

  const { events, exitCode } = runRecording(dir, {
    mode: "format-only",
    check: false,
    outputMode: "stylish",
    targets: DEFAULT_TARGETS,
  });

  assert.equal(exitCode, 0);
  assert.notEqual(readFileSync(target, "utf8"), before, "expected source to be reformatted");
  assert.equal(streamText(events, "out"), "", "no lint diagnostics under --format-only");
  assert.match(
    streamText(events, "err"),
    /^lint-js: Completed successfully\. Issues fixed where possible\.$/m,
  );
});

void test("--lint-only: skips fmt phase, leaves source bytes untouched", (t) => {
  // Asserting bytes-equal is meaningful because the basic fixture has fmt violations
  // that the leading fmt pass would otherwise rewrite.
  const dir = copyFixture("basic");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const target = join(dir, "src", "index.ts");
  const before = readFileSync(target, "utf8");

  const { events, exitCode } = runRecording(dir, {
    mode: "lint-only",
    check: false,
    outputMode: "stylish",
    targets: DEFAULT_TARGETS,
  });

  assert.equal(exitCode, 1);
  assert.equal(readFileSync(target, "utf8"), before, "fmt phase must not run");
  assert.match(streamText(events, "out"), /no-floating-promises/);
});
