// @ts-check

import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import test from "node:test";

import { copyFixture, runCli } from "../helpers.js";

void test("unsafe-any: weak-typings hint follows no-unsafe-* diagnostics", (t) => {
  const dir = copyFixture("unsafe-any");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const result = runCli(dir, ["--check"]);

  assert.equal(result.status, 1, "expected exit 1 from no-unsafe-* errors (fmt/lint findings)");
  assert.match(result.stdout, /no-unsafe-/, "expected oxlint to report a no-unsafe-* diagnostic");
  assert.match(result.stdout, /weak-typings\.md/, "expected weak-typings hint pointer on stdout");

  const lines = result.stdout.split("\n");
  // Match the default formatter's bracketed error-code specifically; the hint line contains
  // the literal "no-unsafe-" too but wraps it in backticks, so the `[` anchor disambiguates.
  // The error-code is the raw `plugin(rule)` form, e.g. `[typescript-eslint(no-unsafe-...)]`.
  const firstUnsafeIdx = lines.findIndex((l) => /\[[^\]]*\(no-unsafe-/.test(l));
  // Path separator agnostic (POSIX `/` or native Windows `\`).
  const seeMatch = lines
    .map((l) => l.match(/^- See: ((?:.*[/\\])?weak-typings\.md)$/))
    .find((m) => m !== null);
  const seeIdx = seeMatch ? lines.indexOf(seeMatch.input ?? "") : -1;
  const summaryIdx = lines.findIndex((l) => l.startsWith("lint-js:"));
  assert.ok(
    firstUnsafeIdx >= 0 && seeIdx > firstUnsafeIdx && summaryIdx > seeIdx,
    `expected order: first no-unsafe-* diag (${firstUnsafeIdx}) < See: line (${seeIdx}) < summary (${summaryIdx})`,
  );
  // Detect link rot: the path printed in the hint must resolve to an existing file.
  const docPath = seeMatch?.[1] ?? "";
  assert.ok(
    existsSync(docPath),
    `weak-typings hint points to a non-existent file: ${JSON.stringify(docPath)}`,
  );
});
