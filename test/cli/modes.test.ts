import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { assertProgressLines, copyFixture, makeTempDir, runCli } from "../helpers.ts";

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
  // Default formatter: bracketed error-code on the head line + issue-count summary present.
  assert.match(
    result.stdout,
    /\[typescript-eslint\(no-floating-promises\)\]/,
    "expected bracketed error-code (raw plugin(rule) form) in the head line",
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

void test("--unix: oxlint unix output passes through, no issue-count summary or hint", (t) => {
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

  // oxfmt itself returns 2 on parse errors, but lint-js reserves 2 for LintJsError;
  // any non-zero child status must collapse to 1 (fmt/lint findings).
  assert.equal(result.status, 1, "oxfmt parse-error exit must be normalized to 1");
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

void test("--format-only: runs fmt phase, skips lint phase entirely", (t) => {
  const dir = copyFixture("basic");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const target = join(dir, "src", "index.ts");
  const before = readFileSync(target, "utf8");

  const result = runCli(dir, ["--format-only"]);

  assert.equal(
    result.status,
    0,
    "fmt-only on the basic fixture succeeds: oxfmt rewrites the source and the lint phase is skipped",
  );
  assert.notEqual(readFileSync(target, "utf8"), before, "expected source to be reformatted");
  assert.doesNotMatch(
    result.stdout,
    /no-floating-promises/,
    "lint diagnostics must not appear under --format-only",
  );
  // Scenario: --format-only on a fixture whose only lint issue is unfixable.
  // Skipping lint is what makes the run pass.
  assertProgressLines(result.stdout, {
    fmtMode: "default",
    fmtStart: true,
    fmtCompletion: false,
    lintMode: null,
    lintStart: false,
    lintCompletion: false,
    summary: "lint-js: Completed successfully. Issues fixed where possible.",
  });
});

void test("--lint-only: runs lint phase, skips fmt phase entirely", (t) => {
  const dir = copyFixture("basic");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const target = join(dir, "src", "index.ts");
  const before = readFileSync(target, "utf8");

  const result = runCli(dir, ["--lint-only"]);

  assert.equal(result.status, 1, "expected exit 1 from unfixed lint error");
  assert.match(result.stdout, /no-floating-promises/, "expected lint diagnostic on stdout");
  assert.doesNotMatch(
    result.stdout,
    /Finished in .* on .* files using .* threads\./,
    "oxfmt summary must not appear under --lint-only",
  );
  // Asserting bytes-equal is meaningful only because the basic fixture has
  // formatting violations oxfmt would otherwise rewrite.
  assert.equal(
    readFileSync(target, "utf8"),
    before,
    "source must not be reformatted when fmt phase is skipped",
  );
  // Scenario: --lint-only + unfixed lint findings.
  assertProgressLines(result.stdout, {
    fmtMode: null,
    fmtStart: false,
    fmtCompletion: false,
    lintMode: "with auto-fix",
    lintStart: true,
    lintCompletion: false,
    summary: "lint-js: Failed. Issues fixed where possible; unfixed issues remain.",
  });
});

void test("--format-only and --lint-only are mutually exclusive", (t) => {
  // No package.json in this dir: argument-validity errors must fail before the
  // package.json guard. Same contract as the `unknown CLI option` test.
  const dir = makeTempDir("mutually-exclusive");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const result = runCli(dir, ["--format-only", "--lint-only"]);

  assert.equal(result.status, 2, "LintJsError path uses exit 2");
  assert.match(result.stderr, /mutually exclusive/);
  assert.doesNotMatch(
    result.stderr,
    /no package\.json/,
    "argument validation should fail before the package.json check",
  );
  assert.doesNotMatch(
    result.stdout,
    /^formatting/m,
    "no phase banner should be emitted before the validation error",
  );
});
