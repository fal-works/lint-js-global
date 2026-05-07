import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import test from "node:test";

import { copyFixture, runCli } from "../helpers.ts";

void test("unsafe-any: weak-typings hint goes to stderr, leaving stdout pure diagnostics", (t) => {
  const dir = copyFixture("unsafe-any");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const result = runCli(dir, ["--check"]);

  assert.equal(result.status, 1, "expected exit 1 from no-unsafe-* errors (fmt/lint findings)");

  // stdout: diagnostics only.
  assert.match(result.stdout, /no-unsafe-/, "expected oxlint to report a no-unsafe-* diagnostic");
  assert.doesNotMatch(result.stdout, /Hint on the/, "weak-typings hint must not appear on stdout");
  assert.doesNotMatch(
    result.stdout,
    /weak-typings\.md/,
    "weak-typings doc pointer must not appear on stdout",
  );

  // stderr: hint + summary + final tagged status.
  assert.match(
    result.stderr,
    /^Hint on the `no-unsafe-\*` diagnostics:$/m,
    "expected weak-typings hint header on stderr",
  );
  assert.match(result.stderr, /weak-typings\.md/, "expected weak-typings doc pointer on stderr");
  assert.match(result.stderr, /^lint-js: Failed\./m, "expected final tagged status on stderr");

  // Detect link rot: the path printed in the hint must resolve to an existing file.
  // Path separator agnostic (POSIX `/` or native Windows `\`).
  const seeMatch = result.stderr
    .split("\n")
    .map((l) => l.match(/^- See: ((?:.*[/\\])?weak-typings\.md)$/))
    .find((m) => m !== null);
  const docPath = seeMatch?.[1] ?? "";
  assert.ok(
    existsSync(docPath),
    `weak-typings hint points to a non-existent file: ${JSON.stringify(docPath)}`,
  );
});
