// @ts-check

import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { assertProgressLines, copyFixture, runCli } from "../helpers.js";

void test("basic: reformats sources and reports floating promise", (t) => {
  const dir = copyFixture("basic");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const target = join(dir, "src", "index.ts");
  const before = readFileSync(target, "utf8");

  const result = runCli(dir);

  assert.equal(result.status, 1, "expected exit 1 from unfixed lint error");
  const after = readFileSync(target, "utf8");
  assert.notEqual(after, before, "expected source to be reformatted");
  assert.match(result.stdout, /no-floating-promises/, "expected type-aware rule on stdout");
  assert.doesNotMatch(
    result.stderr,
    /no-floating-promises/,
    "rule output should not leak to stderr",
  );
  assert.doesNotMatch(
    result.stdout,
    /weak-typings\.md/,
    "weak-typings hint must not fire when only non-unsafe rules trigger",
  );
  // Default formatter: legend + bracketed rule-name + issue-count summary all present.
  assert.match(
    result.stdout,
    /^diagnostic legend: <location> `<code-slice>` \[<rule-name>\]$/m,
    "expected legend line at the top of the diagnostic block",
  );
  assert.match(
    result.stdout,
    /\[no-floating-promises\]/,
    "expected bracketed rule-name in the diagnostic line",
  );
  assert.match(
    result.stdout,
    /^Found 1 unfixed issue in 1 file\.$/m,
    "expected issue-count summary line after the diagnostic block",
  );
  // Scenario: default mode + not clean (unfixed lint remains).
  assertProgressLines(result.stdout, {
    fmtMode: "default",
    fmtStart: true,
    fmtCompletion: false,
    lintMode: "with auto-fix",
    lintStart: true,
    lintCompletion: false,
    summary: "lint-js: Failed. Issues fixed where possible; unfixed issues remain.",
  });
});

void test("--unix: oxlint unix output passes through, no legend or issue-count summary", (t) => {
  const dir = copyFixture("basic");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const result = runCli(dir, ["--unix"]);

  assert.equal(result.status, 1, "expected exit 1 from unfixed lint error");
  // Classic `--format=unix` tag appears verbatim.
  assert.match(
    result.stdout,
    /typescript-eslint\(no-floating-promises\)/,
    "expected unix-format rule tag to appear verbatim",
  );
  // None of the default formatter's framing survives.
  assert.doesNotMatch(
    result.stdout,
    /^diagnostic legend:/m,
    "legend must be suppressed under --unix",
  );
  assert.doesNotMatch(
    result.stdout,
    /^Found \d+ unfixed issues/m,
    "issue-count summary must be suppressed under --unix",
  );
  assert.doesNotMatch(
    result.stdout,
    /weak-typings\.md/,
    "hint block must be suppressed under --unix",
  );
});

void test("oxfmt failure propagates to exit code even when lint is clean", (t) => {
  const dir = copyFixture("with-node-modules");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // Inject an unparseable source to fail oxfmt while keeping oxlint clean
  // (oxlint respects .eslintignore, so broken.ts is skipped there).
  writeFileSync(join(dir, "broken.ts"), "const x = ;\n");
  writeFileSync(join(dir, ".eslintignore"), "broken.ts\n");

  const result = runCli(dir);

  assert.notEqual(result.status, 0, "oxfmt failure must not be swallowed");
});

void test("--check: does not modify files and reports both fmt and lint violations", (t) => {
  const dir = copyFixture("basic");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const target = join(dir, "src", "index.ts");
  const before = readFileSync(target, "utf8");

  const result = runCli(dir, ["--check"]);

  assert.equal(result.status, 1, "expected exit 1 from fmt or lint violations");
  assert.equal(readFileSync(target, "utf8"), before, "sources must not be rewritten in check mode");
  assert.match(result.stdout, /Format issues found/, "oxfmt --check must report format violations");
  assert.match(result.stdout, /no-floating-promises/, "lint violation should still be reported");
  assert.doesNotMatch(
    result.stdout,
    /weak-typings\.md/,
    "weak-typings hint must not fire for non-unsafe lint failures under --check",
  );
  // Scenario: --check + not clean.
  assertProgressLines(result.stdout, {
    fmtMode: "check-only",
    fmtStart: true,
    fmtCompletion: false,
    lintMode: "no auto-fix",
    lintStart: true,
    lintCompletion: false,
    summary: "lint-js: Failed. Issues found; fixes required.",
  });
});

void test("--check: clean project exits 0", (t) => {
  const dir = copyFixture("with-node-modules");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const result = runCli(dir, ["--check"]);

  assert.equal(result.status, 0, "expected exit 0 on clean project under --check");
  assert.doesNotMatch(
    result.stdout,
    /weak-typings\.md/,
    "weak-typings hint must not fire on a clean lint",
  );
  // Scenario: --check + clean.
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
