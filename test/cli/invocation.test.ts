import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import test from "node:test";

import { copyFixture, makeTempDir, runCli } from "../helpers.ts";

void test("--help: prints usage and exits 0 without requiring package.json", (t) => {
  const dir = makeTempDir("help");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  for (const flag of ["--help", "-h"]) {
    const result = runCli(dir, [flag]);
    assert.equal(result.status, 0, `${flag}: expected exit 0`);
    assert.match(result.stdout, /Usage: lint-js/, `${flag}: expected usage on stdout`);
  }
});

void test("--version: prints semver and exits 0 without requiring package.json", (t) => {
  const dir = makeTempDir("version");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  for (const flag of ["--version", "-v"]) {
    const result = runCli(dir, [flag]);
    assert.equal(result.status, 0, `${flag}: expected exit 0`);
    assert.match(
      result.stdout,
      /^lint-js \d+\.\d+\.\d+/,
      `${flag}: expected "lint-js <semver>" on stdout`,
    );
  }
});

void test("--help / --version short-circuit before run-mode validation", (t) => {
  const dir = makeTempDir("help-shortcircuit");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // Combined with otherwise-invalid run-mode flags. Help/version must win and
  // exit 0; mutual-exclusion (and any other run-only validation) must not fire.
  const helpResult = runCli(dir, ["--help", "--format-only", "--lint-only"]);
  assert.equal(helpResult.status, 0, "--help must short-circuit run-mode validation");
  assert.match(helpResult.stdout, /Usage: lint-js/);

  const versionResult = runCli(dir, ["--version", "--format-only", "--lint-only"]);
  assert.equal(versionResult.status, 0, "--version must short-circuit run-mode validation");
  assert.match(versionResult.stdout, /^lint-js \d+\.\d+\.\d+/);
});

void test("unknown CLI option: exits 2 with parsing-error diagnostic", (t) => {
  const dir = makeTempDir("bad-arg");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const result = runCli(dir, ["--no-such-flag"]);

  assert.equal(
    result.status,
    2,
    "LintJsError path uses exit 2 (distinct from fmt/lint failure = 1)",
  );
  assert.match(
    result.stderr,
    /Argument parsing error\./,
    "expected parse-error headline on stderr",
  );
  assert.match(result.stderr, /--no-such-flag/, "expected original parseArgs detail on stderr");
  assert.doesNotMatch(
    result.stderr,
    /no package\.json/,
    "arg parsing should fail before the package.json check",
  );
  assert.doesNotMatch(
    result.stdout,
    /Argument parsing error/,
    "diagnostic should not leak to stdout",
  );
});

void test("missing package.json: exits 2 with diagnostic", (t) => {
  const dir = makeTempDir("no-pkg");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const result = runCli(dir);

  assert.equal(
    result.status,
    2,
    "LintJsError path uses exit 2 (distinct from fmt/lint failure = 1)",
  );
  assert.match(result.stderr, /no package\.json/, "expected diagnostic about missing package.json");
  assert.doesNotMatch(
    result.stdout,
    /no package\.json found/,
    "diagnostic should not leak to stdout",
  );
});

void test("nonexistent target fails fast with diagnostic", (t) => {
  const dir = copyFixture("basic");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const result = runCli(dir, ["src/does-not-exist.ts"]);

  assert.equal(
    result.status,
    2,
    "LintJsError path uses exit 2 (distinct from fmt/lint failure = 1)",
  );
  assert.match(result.stderr, /target not found/);
});
