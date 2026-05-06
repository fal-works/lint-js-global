import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { copyFixture, makeTempDir, runCli } from "../helpers.ts";

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
    result.stderr,
    /^1 unfixed issue in 1 file\.$/m,
    "expected issue-count summary on stderr",
  );
  assert.match(
    result.stderr,
    /^lint-js: Failed\. Issues fixed where possible; unfixed issues remain\.$/m,
    "expected final tagged status on stderr",
  );
  assert.doesNotMatch(result.stdout, /^lint-js:/m, "tagged status must not leak to stdout");
});

void test("--unix: oxlint unix output passes through, no issue-count summary or hint", (t) => {
  const dir = copyFixture("basic");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const result = runCli(dir, ["--unix"]);

  assert.equal(result.status, 1, "expected exit 1 from unfixed lint error");
  // Classic `--format=unix` tag appears verbatim on stdout.
  assert.match(
    result.stdout,
    /typescript-eslint\(no-floating-promises\)/,
    "expected unix-format rule tag to appear verbatim on stdout",
  );
  // None of the default formatter's framing survives.
  assert.doesNotMatch(
    result.stdout,
    /^\d+ unfixed issues/m,
    "issue-count summary must be suppressed under --unix",
  );
  assert.doesNotMatch(
    result.stdout,
    /weak-typings\.md/,
    "hint block must be suppressed under --unix",
  );
  assert.match(result.stderr, /^linting \(with auto-fix\)\.\.\.$/m);
  assert.match(result.stderr, /^lint-js: Failed\./m);
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
  // ADR-0006 silences the fmt phase only on success; a failure must surface.
  assert.match(
    result.stderr,
    /^formatting\.\.\.$/m,
    "fmt-phase banner must fire when oxfmt exits non-zero",
  );
});

void test("--check: does not modify files and reports both fmt and lint violations", (t) => {
  const dir = copyFixture("basic");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const target = join(dir, "src", "index.ts");
  const before = readFileSync(target, "utf8");

  const result = runCli(dir, ["--check"]);

  assert.equal(result.status, 1, "expected exit 1 from fmt or lint violations");
  assert.equal(readFileSync(target, "utf8"), before, "sources must not be rewritten in check mode");
  // oxfmt's check-mode stderr/stdout (incl. "Format issues found") routes through stderr.
  assert.match(result.stderr, /Format issues found/, "oxfmt --check report belongs on stderr");
  assert.match(result.stdout, /no-floating-promises/, "lint diagnostic stays on stdout");
  assert.doesNotMatch(
    result.stdout,
    /weak-typings\.md/,
    "weak-typings hint must not fire for non-unsafe lint failures under --check",
  );
  assert.match(
    result.stderr,
    /^lint-js: Failed\. Issues found; fixes required\.$/m,
    "expected --check failure status on stderr",
  );
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
  assert.match(
    result.stderr,
    /^lint-js: Completed successfully\. No issues found\.$/m,
    "expected clean --check status on stderr",
  );
  assert.equal(result.stdout, "", "stdout must stay empty on a clean run");
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
  assert.doesNotMatch(
    result.stderr,
    /^linting/m,
    "lint phase banner must not appear under --format-only",
  );
  // ADR-0006: even when fmt is the only phase, success means silent fmt output.
  assert.doesNotMatch(
    result.stderr,
    /^formatting/m,
    "fmt phase banner must not appear on success even under --format-only",
  );
  assert.doesNotMatch(
    result.stderr,
    /Finished in/,
    "oxfmt's own summary must not surface on success",
  );
  assert.equal(result.stdout, "", "stdout must stay empty under --format-only on success");
  assert.match(result.stderr, /^lint-js: Completed successfully\. Issues fixed where possible\.$/m);
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
    result.stderr,
    /Finished in .* on .* files using .* threads\./,
    "oxfmt summary must not appear under --lint-only (fmt phase skipped)",
  );
  assert.doesNotMatch(
    result.stderr,
    /^formatting/m,
    "fmt phase banner must not appear under --lint-only",
  );
  // Asserting bytes-equal is meaningful only because the basic fixture has
  // formatting violations oxfmt would otherwise rewrite.
  assert.equal(
    readFileSync(target, "utf8"),
    before,
    "source must not be reformatted when fmt phase is skipped",
  );
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
    result.stderr,
    /^formatting/m,
    "no phase banner should be emitted before the validation error",
  );
});
