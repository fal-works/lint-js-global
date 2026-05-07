import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { DIRTY_SOURCE, copyFixture, runCli, writeIgnoreFiles } from "../helpers.ts";

void test("positional path narrows scope but still honors ignore files", (t) => {
  const dir = copyFixture("basic");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const outside = join(dir, "outside.ts");
  writeFileSync(outside, DIRTY_SOURCE);

  const ignored = join(dir, "src", "ignored.ts");
  writeFileSync(ignored, DIRTY_SOURCE);
  writeIgnoreFiles(dir, "ignored.ts");

  const result = runCli(dir, ["src"]);

  assert.equal(result.status, 1, "expected exit 1 from unfixed lint error in src/index.ts");
  assert.equal(readFileSync(outside, "utf8"), DIRTY_SOURCE, "outside target must not be touched");
  assert.equal(readFileSync(ignored, "utf8"), DIRTY_SOURCE, "ignored file must not be touched");
  assert.doesNotMatch(
    result.stdout,
    /no-debugger/,
    "oxlint must skip files listed in .eslintignore",
  );
});

void test("fully-ignored single-file target exits cleanly", (t) => {
  const dir = copyFixture("basic");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const ignored = join(dir, "src", "ignored.ts");
  writeFileSync(ignored, DIRTY_SOURCE);
  writeIgnoreFiles(dir, "ignored.ts");

  const result = runCli(dir, ["src/ignored.ts"]);

  assert.equal(result.status, 0, "expected exit 0 when the only target is ignored");
  assert.equal(readFileSync(ignored, "utf8"), DIRTY_SOURCE, "ignored file must not be touched");
  assert.equal(result.stdout, "", "stdout must stay empty when no diagnostic is produced");
  assert.match(result.stderr, /^lint-js: Completed successfully\. No lintable files matched\.$/m);
});

void test("--check + fully-ignored target: fmt phase stays silent on success (ADR-0006)", (t) => {
  const dir = copyFixture("basic");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const ignored = join(dir, "src", "ignored.ts");
  writeFileSync(ignored, DIRTY_SOURCE);
  writeIgnoreFiles(dir, "ignored.ts");

  const result = runCli(dir, ["--check", "src/ignored.ts"]);

  assert.equal(result.status, 0, "expected exit 0 when the only target is ignored");
  // Per ADR-0006 the fmt phase is silent on success, including the zero-match case
  // (oxfmt exits 0 thanks to --no-error-on-unmatched-pattern).
  assert.doesNotMatch(
    result.stderr,
    /No files found matching the given patterns/,
    "oxfmt's own zero-match line must not surface when the phase succeeded",
  );
  assert.equal(result.stdout, "", "stdout must stay empty when no fmt/lint output applies");
  assert.match(result.stderr, /^lint-js: Completed successfully\. No lintable files matched\.$/m);
});

void test("target dir with no lintable files exits cleanly", (t) => {
  // oxlint ≥1.61's no-files signal also fires when a target simply contains no lintable files,
  // not only when ignore patterns filter every match out.
  const dir = copyFixture("basic");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  mkdirSync(join(dir, "empty-dir"));

  const result = runCli(dir, ["empty-dir"]);

  assert.equal(result.status, 0, "expected exit 0 when the target has no lintable files");
  assert.equal(result.stdout, "", "stdout must stay empty when no diagnostic is produced");
});

void test("--unix + fully-ignored target exits cleanly", (t) => {
  // oxlint ≥1.61 emits the "No files found to lint." signal in --format=unix too,
  // so the wrapper's exit normalization must run before the unix passthrough.
  const dir = copyFixture("basic");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const ignored = join(dir, "src", "ignored.ts");
  writeFileSync(ignored, DIRTY_SOURCE);
  writeIgnoreFiles(dir, "ignored.ts");

  const result = runCli(dir, ["--unix", "src/ignored.ts"]);

  assert.equal(result.status, 0, "expected exit 0 when the only target is ignored");
  assert.equal(readFileSync(ignored, "utf8"), DIRTY_SOURCE, "ignored file must not be touched");
  // Even under --unix, the no-files signal must not pollute stdout: it routes to stderr.
  assert.equal(result.stdout, "", "stdout must stay clean under --unix when no files match");
  assert.match(
    result.stderr,
    /^No files found to lint\.$/m,
    "no-files signal should be reported on stderr",
  );
});

void test("node_modules is ignored", (t) => {
  const dir = copyFixture("with-node-modules");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const brokenDir = join(dir, "node_modules", "broken");
  mkdirSync(brokenDir, { recursive: true });
  const brokenFile = join(brokenDir, "index.js");
  const brokenContent = "const x=1;const y  =2\n";
  writeFileSync(brokenFile, brokenContent);

  const result = runCli(dir);

  assert.equal(result.status, 0, "clean project src should pass");
  assert.equal(
    readFileSync(brokenFile, "utf8"),
    brokenContent,
    "files under node_modules must not be touched",
  );
});
