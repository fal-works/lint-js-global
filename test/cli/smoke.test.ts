import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { runLintJsCli } from "../cli-helpers.ts";
import { copyFixture, DIRTY_SOURCE } from "../fixture-helpers.ts";

void test("end-to-end smoke: full pipeline reaches the tools and reports through the configured streams", async (t) => {
  // Confirms the CLI binary wires `process.argv`, `process.cwd()`, `process.exitCode`,
  // `createConsoleLogger`, and the `LintJsError` boundary together. The basic fixture
  // is intentionally dirty, so a successful end-to-end run reports findings and exits 1.
  // Detailed output structure lives in `test/integration/runner.test.ts`.
  const dir = copyFixture("basic");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const result = await runLintJsCli(dir);

  assert.equal(result.status, 1, "expected exit 1 from unfixed lint findings");
  assert.match(result.stdout, /no-floating-promises/, "lint diagnostic on stdout");
  assert.match(
    result.stderr,
    /^lint-js: Failed\. Issues fixed where possible; unfixed issues remain\.$/m,
    "tagged summary on stderr",
  );
  assert.doesNotMatch(result.stdout, /^lint-js:/m, "tagged status must not leak to stdout");
});

void test("end-to-end smoke: non-default flags reach run() unchanged", async (t) => {
  // Each parsed CliArgs field has an observable that differs from the default run, so a
  // regression where cli.ts drops or hardcodes any of them surfaces as one of the asserts
  // below failing. Per-field branch coverage of the parser and runner lives upstream.
  const dir = copyFixture("basic");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const outside = join(dir, "outside.ts");
  writeFileSync(outside, DIRTY_SOURCE);
  const target = join(dir, "src", "index.ts");
  const before = readFileSync(target, "utf8");

  const result = await runLintJsCli(dir, ["--check", "--unix", "src"]);

  assert.equal(result.status, 1, "expected exit 1 from fmt or lint findings");
  // --check forwarded: even files inside the positional target are not rewritten.
  assert.equal(readFileSync(target, "utf8"), before, "--check must suppress rewrites");
  // positional `src` forwarded: files outside it are unaffected regardless of mode.
  assert.equal(readFileSync(outside, "utf8"), DIRTY_SOURCE, "positional must narrow scope");
  // --unix forwarded: stdout carries one flat `<file>:<L>:<C>: <msg> [<code>]` line.
  assert.match(
    result.stdout,
    /^src\/index\.ts:\d+:\d+: .* \[typescript-eslint\(no-floating-promises\)\]$/m,
    "--unix must select the unix output layout",
  );
});
