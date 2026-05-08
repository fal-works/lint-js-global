import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { copyFixture, DIRTY_SOURCE, writeIgnoreFiles } from "../fixture-helpers.ts";
import { type RecordedEvent, renderSnapshot, runRecording } from "../recording-helpers.ts";

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

function matchSnapshot(name: string, events: readonly RecordedEvent[], exitCode: number): void {
  const path = join(snapshotDir, `${name}.txt`);
  const actual = normalize(renderSnapshot(events, exitCode));
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

const DEFAULT_TARGETS = ["."];

void test("snapshot: full pipeline on dirty source (diag + summary)", async (t) => {
  const dir = copyFixture("basic");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { events, exitCode } = await runRecording(dir, {
    mode: "full",
    check: false,
    outputMode: "stylish",
    targets: DEFAULT_TARGETS,
  });
  matchSnapshot("basic-default", events, exitCode);
});

void test("snapshot: --unix mode emits flat diagnostic lines on stdout, summary on stderr", async (t) => {
  const dir = copyFixture("basic");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { events, exitCode } = await runRecording(dir, {
    mode: "full",
    check: false,
    outputMode: "unix",
    targets: DEFAULT_TARGETS,
  });
  matchSnapshot("basic-unix", events, exitCode);
});

void test("snapshot: --check reports both fmt and lint violations without rewriting", async (t) => {
  const dir = copyFixture("basic");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const target = join(dir, "src", "index.ts");
  const before = readFileSync(target, "utf8");
  const { events, exitCode } = await runRecording(dir, {
    mode: "full",
    check: true,
    outputMode: "stylish",
    targets: DEFAULT_TARGETS,
  });
  assert.equal(readFileSync(target, "utf8"), before, "sources must not be rewritten in check mode");
  matchSnapshot("basic-check", events, exitCode);
});

void test("snapshot: --check on a clean project", async (t) => {
  const dir = copyFixture("with-node-modules");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { events, exitCode } = await runRecording(dir, {
    mode: "full",
    check: true,
    outputMode: "stylish",
    targets: DEFAULT_TARGETS,
  });
  matchSnapshot("clean-check", events, exitCode);
});

void test("snapshot: unsafe-any rules trigger the weak-typings hint block", async (t) => {
  const dir = copyFixture("unsafe-any");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { events, exitCode } = await runRecording(dir, {
    mode: "full",
    check: false,
    outputMode: "stylish",
    targets: DEFAULT_TARGETS,
  });
  matchSnapshot("unsafe-any-default", events, exitCode);
});

void test("snapshot: --unix with fully-ignored target keeps stdout empty", async (t) => {
  const dir = copyFixture("basic");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ignored = join(dir, "src", "ignored.ts");
  writeFileSync(ignored, DIRTY_SOURCE);
  writeIgnoreFiles(dir, "ignored.ts");
  const { events, exitCode } = await runRecording(dir, {
    mode: "full",
    check: false,
    outputMode: "unix",
    targets: ["src/ignored.ts"],
  });
  matchSnapshot("unix-no-files", events, exitCode);
});

void test("snapshot: fatal fmt failure halts before lint", async (t) => {
  const dir = copyFixture("with-node-modules");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "broken.ts"), "const x = ;\n");
  const { events, exitCode } = await runRecording(dir, {
    mode: "full",
    check: false,
    outputMode: "stylish",
    targets: DEFAULT_TARGETS,
  });
  matchSnapshot("halt-fmt-fatal", events, exitCode);
});
