import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { copyFixture, runCli, type CliRunResult } from "../helpers.ts";

const here = dirname(fileURLToPath(import.meta.url));
const snapshotDir = join(here, "..", "snapshots");
const packageRoot = resolve(here, "..", "..");
const UPDATE = process.env.UPDATE_SNAPSHOTS === "1";

/**
 * Scrub run-to-run volatile fragments so snapshots stay stable across machines.
 *
 * - oxfmt's `Finished in Xms on N files using T threads.` (duration + thread count vary)
 * - oxfmt's per-file ` (Xms)` in --check mode
 * - absolute package-root path in the weak-typings hint (depends on test host)
 */
function normalize(text: string): string {
  return text
    .replaceAll(
      /Finished in \d+ms on \d+ files using \d+ threads\./g,
      "Finished in <DUR>ms on <N> files using <T> threads.",
    )
    .replaceAll(/ \(\d+ms\)/g, " (<DUR>ms)")
    .replaceAll(packageRoot, "<PACKAGE_ROOT>");
}

function renderSnapshot(result: CliRunResult): string {
  return [
    `exit: ${result.status}`,
    "",
    "==== stdout ====",
    normalize(result.stdout),
    "==== stderr ====",
    normalize(result.stderr),
  ].join("\n");
}

function matchSnapshot(name: string, result: CliRunResult): void {
  const path = join(snapshotDir, `${name}.txt`);
  const actual = renderSnapshot(result);
  if (UPDATE) {
    writeFileSync(path, actual);
    return;
  }
  const expected = readFileSync(path, "utf8");
  assert.equal(
    actual,
    expected,
    `snapshot mismatch for ${name}. Re-run with UPDATE_SNAPSHOTS=1 to refresh.`,
  );
}

void test("snapshot: default mode on dirty source (diag + summary)", (t) => {
  const dir = copyFixture("basic");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  matchSnapshot("basic-default", runCli(dir));
});

void test("snapshot: --unix mode passes oxlint output through unchanged", (t) => {
  const dir = copyFixture("basic");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  matchSnapshot("basic-unix", runCli(dir, ["--unix"]));
});

void test("snapshot: --check reports both fmt and lint violations without rewriting", (t) => {
  const dir = copyFixture("basic");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  matchSnapshot("basic-check", runCli(dir, ["--check"]));
});

void test("snapshot: --check on a clean project emits the success banner", (t) => {
  const dir = copyFixture("with-node-modules");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  matchSnapshot("clean-check", runCli(dir, ["--check"]));
});

void test("snapshot: unsafe-any rules trigger the weak-typings hint block", (t) => {
  const dir = copyFixture("unsafe-any");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  matchSnapshot("unsafe-any-default", runCli(dir));
});
