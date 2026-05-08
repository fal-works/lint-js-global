import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { copyFixture, DIRTY_SOURCE, writeIgnoreFiles } from "../fixture-helpers.ts";
import { runRecording, streamText } from "../recording-helpers.ts";

const DEFAULT_TARGETS = ["."];

void test("positional path narrows scope but still honors ignore files", (t) => {
  const dir = copyFixture("basic");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const outside = join(dir, "outside.ts");
  writeFileSync(outside, DIRTY_SOURCE);

  const ignored = join(dir, "src", "ignored.ts");
  writeFileSync(ignored, DIRTY_SOURCE);
  writeIgnoreFiles(dir, "ignored.ts");

  const { events, exitCode } = runRecording(dir, {
    mode: "full",
    check: false,
    outputMode: "stylish",
    targets: ["src"],
  });

  assert.equal(exitCode, 1);
  assert.equal(readFileSync(outside, "utf8"), DIRTY_SOURCE, "outside target must not be touched");
  assert.equal(readFileSync(ignored, "utf8"), DIRTY_SOURCE, "ignored file must not be touched");
  assert.doesNotMatch(streamText(events, "out"), /no-debugger/);
});

void test("fully-ignored single-file target exits cleanly with the no-files summary", (t) => {
  const dir = copyFixture("basic");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const ignored = join(dir, "src", "ignored.ts");
  writeFileSync(ignored, DIRTY_SOURCE);
  writeIgnoreFiles(dir, "ignored.ts");

  const { events, exitCode } = runRecording(dir, {
    mode: "full",
    check: false,
    outputMode: "stylish",
    targets: ["src/ignored.ts"],
  });

  assert.equal(exitCode, 0);
  assert.equal(readFileSync(ignored, "utf8"), DIRTY_SOURCE);
  assert.equal(streamText(events, "out"), "");
  assert.match(
    streamText(events, "err"),
    /^lint-js: Completed successfully\. No lintable files matched\.$/m,
  );
});

void test("--check + fully-ignored target: fmt phase stays silent on success (ADR-0006)", (t) => {
  const dir = copyFixture("basic");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const ignored = join(dir, "src", "ignored.ts");
  writeFileSync(ignored, DIRTY_SOURCE);
  writeIgnoreFiles(dir, "ignored.ts");

  const { events, exitCode } = runRecording(dir, {
    mode: "full",
    check: true,
    outputMode: "stylish",
    targets: ["src/ignored.ts"],
  });

  assert.equal(exitCode, 0);
  const err = streamText(events, "err");
  // Per ADR-0006, the fmt phase is silent on success, including the zero-match case
  // (oxfmt exits 0 thanks to --no-error-on-unmatched-pattern).
  assert.doesNotMatch(err, /No files found matching the given patterns/);
  assert.equal(streamText(events, "out"), "");
  assert.match(err, /^lint-js: Completed successfully\. No lintable files matched\.$/m);
});

void test("target dir with no lintable files exits cleanly", (t) => {
  // oxlint ≥1.61's no-files signal also fires when a target simply contains no lintable files,
  // not only when ignore patterns filter every match out.
  const dir = copyFixture("basic");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "empty-dir"));

  const { events, exitCode } = runRecording(dir, {
    mode: "full",
    check: false,
    outputMode: "stylish",
    targets: ["empty-dir"],
  });

  assert.equal(exitCode, 0);
  assert.equal(streamText(events, "out"), "");
});

void test("node_modules is ignored", (t) => {
  const dir = copyFixture("with-node-modules");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const brokenDir = join(dir, "node_modules", "broken");
  mkdirSync(brokenDir, { recursive: true });
  const brokenFile = join(brokenDir, "index.js");
  const brokenContent = "const x=1;const y  =2\n";
  writeFileSync(brokenFile, brokenContent);

  const { exitCode } = runRecording(dir, {
    mode: "full",
    check: false,
    outputMode: "stylish",
    targets: DEFAULT_TARGETS,
  });

  assert.equal(exitCode, 0);
  assert.equal(readFileSync(brokenFile, "utf8"), brokenContent);
});

void test("missing package.json: LintJsError routes through the boundary as exit 2", (t) => {
  const dir = copyFixture("basic");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  rmSync(join(dir, "package.json"));

  const { events, exitCode } = runRecording(dir, {
    mode: "full",
    check: false,
    outputMode: "stylish",
    targets: DEFAULT_TARGETS,
  });

  assert.equal(exitCode, 2);
  assert.match(streamText(events, "err"), /no package\.json/);
});

void test("nonexistent target: LintJsError routes through the boundary as exit 2", (t) => {
  const dir = copyFixture("basic");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const { events, exitCode } = runRecording(dir, {
    mode: "full",
    check: false,
    outputMode: "stylish",
    targets: ["src/does-not-exist.ts"],
  });

  assert.equal(exitCode, 2);
  assert.match(streamText(events, "err"), /target not found/);
});
