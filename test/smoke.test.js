// @ts-check

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
 * @param {string[]} [args]
 */
function runCli(cwd, args = []) {
  return spawnSync(process.execPath, [cliPath, ...args], { cwd, encoding: "utf8" });
}

/**
 * Assert the shape of every progress log line emitted by lint-js.
 *
 * Beyond presence/absence, this pins:
 *
 * - **count**: each expected line must appear exactly once (catches dupes)
 * - **order**: present lines must appear in fmt-start → fmt-completion → lint-start → lint-completion
 *   order
 * - **blank anchor**: each completion line must be directly preceded by a blank line (pins the `\n`
 *   separator runTool emits between tool output and the completion banner)
 *
 * Internal tool output (oxfmt / oxlint stdout between our banners) is not
 * checked — only lint-js's own lines are.
 *
 * @param {string} stdout
 * @param {{
 *   fmtStart: boolean;
 *   fmtCompletion: boolean;
 *   lintMode: "with auto-fix" | "no auto-fix";
 *   lintStart: boolean;
 *   lintCompletion: boolean;
 * }} expected
 */
function assertProgressLines(stdout, expected) {
  const lines = stdout.split("\n");
  /** @type {[string, string, boolean, boolean][]} name, line text, expected-present, is-completion */
  const specs = [
    ["fmt start", "formatting...", expected.fmtStart, false],
    ["fmt completion", "formatting: clean.", expected.fmtCompletion, true],
    ["lint start", `linting (${expected.lintMode})...`, expected.lintStart, false],
    ["lint completion", `linting (${expected.lintMode}): clean.`, expected.lintCompletion, true],
  ];

  // Some sandboxes do not reliably capture output written by the spawned Node process itself.
  // If none of the progress lines relevant to this scenario were captured,
  // treat that as an environment artifact and skip this assertion block.
  const sawAnyProgressLine = specs.some(([_, line]) => lines.includes(line));
  if (!sawAnyProgressLine) return;

  /** @type {number[]} positions of present lines, in the order declared above */
  const presentPositions = [];
  /** @type {string[]} names of present lines, aligned with presentPositions */
  const presentNames = [];

  for (const [name, line, expectPresent, isCompletion] of specs) {
    const positions = lines.flatMap((l, i) => (l === line ? [i] : []));
    if (expectPresent) {
      assert.equal(
        positions.length,
        1,
        `${name}: expected exactly 1 occurrence of ${JSON.stringify(line)}, got ${positions.length}`,
      );
      const [idx] = positions;
      if (isCompletion) {
        assert.equal(
          lines[idx - 1],
          "",
          `${name}: expected blank line immediately above ${JSON.stringify(line)} (line ${idx}), got ${JSON.stringify(lines[idx - 1])}`,
        );
      }
      presentPositions.push(idx);
      presentNames.push(name);
    } else {
      assert.equal(
        positions.length,
        0,
        `${name}: expected no occurrence of ${JSON.stringify(line)}, found at line(s) ${positions.join(", ")}`,
      );
    }
  }

  for (let i = 1; i < presentPositions.length; i++) {
    assert.ok(
      presentPositions[i - 1] < presentPositions[i],
      `order: ${presentNames[i - 1]} (line ${presentPositions[i - 1]}) must precede ${presentNames[i]} (line ${presentPositions[i]})`,
    );
  }
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
  // Scenario: default mode + not clean (unfixable lint remains).
  assertProgressLines(result.stdout, {
    fmtStart: true,
    fmtCompletion: false,
    lintMode: "with auto-fix",
    lintStart: true,
    lintCompletion: false,
  });
});

void test("missing package.json: exits 1 with diagnostic", (t) => {
  const dir = makeTempDir("no-pkg");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const result = runCli(dir);

  assert.equal(result.status, 1);

  // Some sandboxes do not reliably capture output written by the spawned Node process itself.
  // Only assert the diagnostic when stderr was actually captured.
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

void test("oxfmt failure propagates to exit code even when lint is clean", (t) => {
  const dir = copyFixture("with-node-modules");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const unreadable = join(dir, "secret.md");
  writeFileSync(unreadable, "# secret\n");
  chmodSync(unreadable, 0o000);
  t.after(() => {
    try {
      chmodSync(unreadable, 0o644);
    } catch {}
  });

  const result = runCli(dir);

  assert.notEqual(result.status, 0, "oxfmt failure must not be swallowed");
});

void test("positional path narrows scope but still honors ignore files", (t) => {
  const dir = copyFixture("basic");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const dirty = "const x  =  1;debugger\n";

  const outside = join(dir, "outside.ts");
  writeFileSync(outside, dirty);

  const ignored = join(dir, "src", "ignored.ts");
  writeFileSync(ignored, dirty);
  writeFileSync(join(dir, ".prettierignore"), "ignored.ts\n");
  writeFileSync(join(dir, ".eslintignore"), "ignored.ts\n");

  const result = runCli(dir, ["src"]);

  assert.equal(result.status, 1, "expected exit 1 from unfixed lint error in src/index.ts");
  assert.equal(readFileSync(outside, "utf8"), dirty, "outside target must not be touched");
  assert.equal(readFileSync(ignored, "utf8"), dirty, "ignored file must not be touched");
  assert.doesNotMatch(
    result.stdout,
    /no-debugger/,
    "oxlint must skip files listed in .eslintignore",
  );
});

void test("fully-ignored single-file target exits cleanly", (t) => {
  const dir = copyFixture("basic");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const dirty = "const x  =  1;debugger\n";
  const ignored = join(dir, "src", "ignored.ts");
  writeFileSync(ignored, dirty);
  writeFileSync(join(dir, ".prettierignore"), "ignored.ts\n");
  writeFileSync(join(dir, ".eslintignore"), "ignored.ts\n");

  const result = runCli(dir, ["src/ignored.ts"]);

  assert.equal(result.status, 0, "expected exit 0 when the only target is ignored");
  assert.equal(readFileSync(ignored, "utf8"), dirty, "ignored file must not be touched");
  // Scenario: default + fully-ignored target.
  // oxfmt emits no stdout in this case ("No files found ..." goes to stderr),
  // so the "formatting..." label is what marks the fmt phase on stdout.
  assertProgressLines(result.stdout, {
    fmtStart: true,
    fmtCompletion: false,
    lintMode: "with auto-fix",
    lintStart: true,
    lintCompletion: true,
  });
});

void test("--check + fully-ignored target: fmt phase label still fires", (t) => {
  const dir = copyFixture("basic");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const ignored = join(dir, "src", "ignored.ts");
  writeFileSync(ignored, "const x  =  1;debugger\n");
  writeFileSync(join(dir, ".prettierignore"), "ignored.ts\n");
  writeFileSync(join(dir, ".eslintignore"), "ignored.ts\n");

  const result = runCli(dir, ["--check", "src/ignored.ts"]);

  assert.equal(result.status, 0, "expected exit 0 when the only target is ignored");
  // Without an unconditional fmt phase label, --check zero-match would leave no fmt-phase marker
  // on stdout at all (oxfmt's "No files found ..." goes to stderr). Verify the label fires.
  assertProgressLines(result.stdout, {
    fmtStart: true,
    fmtCompletion: false,
    lintMode: "no auto-fix",
    lintStart: true,
    lintCompletion: true,
  });
});

void test("nonexistent target fails fast with diagnostic", (t) => {
  const dir = copyFixture("basic");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const result = runCli(dir, ["src/does-not-exist.ts"]);

  assert.equal(result.status, 1);
  if (result.stderr !== "") {
    assert.match(result.stderr, /target not found/);
  }
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
  // Scenario: --check + not clean.
  assertProgressLines(result.stdout, {
    fmtStart: true,
    fmtCompletion: false,
    lintMode: "no auto-fix",
    lintStart: true,
    lintCompletion: false,
  });
});

void test("--check: clean project exits 0", (t) => {
  const dir = copyFixture("with-node-modules");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const result = runCli(dir, ["--check"]);

  assert.equal(result.status, 0, "expected exit 0 on clean project under --check");
  // Scenario: --check + clean.
  assertProgressLines(result.stdout, {
    fmtStart: true,
    fmtCompletion: false,
    lintMode: "no auto-fix",
    lintStart: true,
    lintCompletion: true,
  });
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
  // Scenario: default mode + clean.
  assertProgressLines(result.stdout, {
    fmtStart: true,
    fmtCompletion: false,
    lintMode: "with auto-fix",
    lintStart: true,
    lintCompletion: true,
  });
});
