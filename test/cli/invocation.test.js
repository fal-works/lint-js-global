// @ts-check

import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import test from "node:test";

import { copyFixture, makeTempDir, runCli } from "../helpers.js";

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

void test("missing package.json: exits 1 with diagnostic", (t) => {
  const dir = makeTempDir("no-pkg");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const result = runCli(dir);

  assert.equal(result.status, 1);
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

  assert.equal(result.status, 1);
  assert.match(result.stderr, /target not found/);
});
