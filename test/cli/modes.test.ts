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
    /^1 unfixed lint issue in 1 file\.$/m,
    "expected issue-count summary on stderr",
  );
  assert.match(
    result.stderr,
    /^lint-js: Failed\. Issues fixed where possible; unfixed issues remain\.$/m,
    "expected final tagged status on stderr",
  );
  assert.doesNotMatch(result.stdout, /^lint-js:/m, "tagged status must not leak to stdout");
});

void test("--unix: stdout carries flat diagnostic lines; auxiliary text routes to stderr", (t) => {
  const dir = copyFixture("basic");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const result = runCli(dir, ["--unix"]);

  assert.equal(result.status, 1, "expected exit 1 from unfixed lint error");
  // Single line of the form `<filename>:<L>:<C>: <message> [<code>]`.
  assert.match(
    result.stdout,
    /^src\/index\.ts:\d+:\d+: .* \[typescript-eslint\(no-floating-promises\)\]$/m,
    "expected flat unix-style diagnostic line on stdout",
  );
  // stdout stays pipe-friendly: no summary, no hint, no severity tag.
  assert.doesNotMatch(
    result.stdout,
    /\bunfixed lint issues?\b/,
    "issue-count summary must not appear on stdout under --unix",
  );
  assert.doesNotMatch(
    result.stdout,
    /weak-typings\.md/,
    "weak-typings hint must not appear on stdout under --unix",
  );
  assert.doesNotMatch(
    result.stdout,
    /\[Error\//,
    "severity prefix must not appear in the bracketed code",
  );
  // stderr carries the same auxiliary text as stylish mode.
  assert.match(
    result.stderr,
    /^1 unfixed lint issue in 1 file\.$/m,
    "expected issue-count summary on stderr under --unix",
  );
  assert.match(result.stderr, /^lint-js: Failed\./m);
});

void test("fatal oxfmt failure halts the run before lint", (t) => {
  const dir = copyFixture("with-node-modules");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // Parse error in the leading fmt pass is the sole halt trigger (ADR-0005).
  writeFileSync(join(dir, "broken.ts"), "const x = ;\n");

  const result = runCli(dir);

  // oxfmt itself returns 2 on parse errors, but lint-js reserves 2 for LintJsError;
  // any non-zero child status must collapse to 1.
  assert.equal(result.status, 1, "halt collapses to exit 1; LintJsError reserves 2");
  assert.match(result.stderr, /Unexpected token/, "leading fmt's parse error must surface");
  assert.equal(result.stdout, "", "halt produces no stdout because the lint phase is skipped");
  assert.match(
    result.stderr,
    /^lint-js: Halted\. Resolve format errors above and re-run\.$/m,
    "halt summary must announce the halt",
  );
});

void test("--check: fatal oxfmt failure halts the run before lint", (t) => {
  const dir = copyFixture("with-node-modules");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  writeFileSync(join(dir, "broken.ts"), "const x = ;\n");

  const result = runCli(dir, ["--check"]);

  assert.equal(result.status, 1, "halt collapses to exit 1 under --check too");
  assert.match(result.stderr, /Unexpected token/, "leading fmt's parse error must surface");
  assert.equal(result.stdout, "", "halt produces no stdout because the lint phase is skipped");
  assert.match(
    result.stderr,
    /^lint-js: Halted\. Resolve format errors above and re-run\.$/m,
    "halt summary fires under --check too",
  );
});

void test("--format-only: fatal oxfmt failure surfaces a fmt-specific failure summary", (t) => {
  // Halt's purpose is to suppress duplicate parse-error output across phases; with no
  // downstream phase, it has nothing to suppress and falls through to a regular failure.
  // The summary uses fmt-specific wording so a parse error is not misread as a lint issue.
  const dir = copyFixture("with-node-modules");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  writeFileSync(join(dir, "broken.ts"), "const x = ;\n");

  const result = runCli(dir, ["--format-only"]);

  assert.equal(result.status, 1, "fmt-only fmt failure still exits 1");
  assert.match(result.stderr, /Unexpected token/);
  assert.doesNotMatch(result.stderr, /Halted\./, "halt summary must not fire under --format-only");
  assert.match(result.stderr, /^lint-js: Failed\. Format errors remain\.$/m);
  assert.doesNotMatch(
    result.stderr,
    /Issues fixed where possible/,
    "the lint-flavored failure wording must not appear under --format-only",
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
  // ADR-0006: even when fmt is the only phase, success means silent fmt output.
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
  // Asserting bytes-equal is meaningful only because the basic fixture has
  // formatting violations oxfmt would otherwise rewrite.
  assert.equal(
    readFileSync(target, "utf8"),
    before,
    "source must not be reformatted when fmt phase is skipped",
  );
});

void test("full pipeline: trailing fmt normalizes drift left by oxlint --fix (ADR-0005)", (t) => {
  const dir = copyFixture("lint-fix-drift");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const result = runCli(dir);

  assert.equal(result.status, 0);
  const after = readFileSync(join(dir, "src", "index.ts"), "utf8");
  assert.ok(after.includes(`import type { ExampleType } from "./types.ts";`));
});

void test("full pipeline: trailing fmt is skipped when lint findings remain so L:C matches final file (ADR-0005)", (t) => {
  const dir = copyFixture("lint-fix-position-stability");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const result = runCli(dir);

  assert.equal(result.status, 1, "expected exit 1 from unfixed lint error");
  // Locate the diagnostic head line "  L:C ..." emitted by the JSON formatter.
  const match = result.stdout.match(/^ {2}(\d+):(\d+) /m);
  assert.ok(match, "expected a diagnostic head line with an L:C prefix");
  const line = Number(match[1]);
  const finalLines = readFileSync(join(dir, "src", "index.ts"), "utf8").split("\n");
  assert.equal(
    finalLines[line - 1],
    "f();",
    `diagnostic line ${line} must point at "f();" in the file the consumer opens next`,
  );
});

void test("--lint-only: drift left by oxlint --fix is preserved (no trailing fmt)", (t) => {
  const dir = copyFixture("lint-fix-drift");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const result = runCli(dir, ["--lint-only"]);

  assert.equal(result.status, 0);
  const after = readFileSync(join(dir, "src", "index.ts"), "utf8");
  assert.ok(after.includes(`import type { ExampleType} from "./types.ts";`));
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
});
