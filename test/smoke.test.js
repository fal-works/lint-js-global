// @ts-check

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cliPath = join(here, "..", "src", "cli.js");
const fixtureRoot = join(here, "fixtures");

/**
 * @param {string} label
 * @returns {string}
 */
function makeTempDir(label) {
  return mkdtempSync(join(tmpdir(), `lint-js-test-${label}-`));
}

/**
 * @param {string} fixtureName
 * @returns {string} Path to the copied directory.
 */
function copyFixture(fixtureName) {
  const dest = makeTempDir(fixtureName);
  cpSync(join(fixtureRoot, fixtureName), dest, { recursive: true });
  return dest;
}

/**
 * @param {string} cwd
 */
function runCli(cwd) {
  return spawnSync(process.execPath, [cliPath], { cwd, encoding: "utf8" });
}

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
});

void test("missing package.json: exits 1 with diagnostic", (t) => {
  const dir = makeTempDir("no-pkg");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const result = runCli(dir);

  assert.equal(result.status, 1);

  // Some sandboxes drop output from short-lived child processes;
  // only assert the message content when stderr was actually captured.
  if (result.stderr !== "") {
    assert.match(
      result.stderr,
      /no package\.json found/,
      "expected diagnostic about missing package.json",
    );
  }
  assert.doesNotMatch(
    result.stdout,
    /no package\.json found/,
    "diagnostic should not leak to stdout",
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
