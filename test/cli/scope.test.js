// @ts-check

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  DIRTY_SOURCE,
  assertProgressLines,
  copyFixture,
  runCli,
  writeIgnoreFiles,
} from "../helpers.js";

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
  // Scenario: default + fully-ignored target.
  // oxfmt emits no stdout in this case ("No files found ..." goes to stderr),
  // so the "formatting..." label is what marks the fmt phase on stdout.
  assertProgressLines(result.stdout, {
    fmtMode: "default",
    fmtStart: true,
    fmtCompletion: false,
    lintMode: "with auto-fix",
    lintStart: true,
    lintCompletion: true,
    summary: "lint-js: Completed successfully. Issues fixed where possible.",
  });
});

void test("--check + fully-ignored target: fmt phase label still fires", (t) => {
  const dir = copyFixture("basic");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const ignored = join(dir, "src", "ignored.ts");
  writeFileSync(ignored, DIRTY_SOURCE);
  writeIgnoreFiles(dir, "ignored.ts");

  const result = runCli(dir, ["--check", "src/ignored.ts"]);

  assert.equal(result.status, 0, "expected exit 0 when the only target is ignored");
  // Without an unconditional fmt phase label, --check zero-match would leave no fmt-phase marker
  // on stdout at all (oxfmt's "No files found ..." goes to stderr). Verify the label fires.
  assertProgressLines(result.stdout, {
    fmtMode: "check-only",
    fmtStart: true,
    fmtCompletion: false,
    lintMode: "no auto-fix",
    lintStart: true,
    lintCompletion: true,
    summary: "lint-js: Completed successfully. No issues found.",
  });
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
  // Scenario: default mode + clean.
  assertProgressLines(result.stdout, {
    fmtMode: "default",
    fmtStart: true,
    fmtCompletion: false,
    lintMode: "with auto-fix",
    lintStart: true,
    lintCompletion: true,
    summary: "lint-js: Completed successfully. Issues fixed where possible.",
  });
});
