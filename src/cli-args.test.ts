import assert from "node:assert/strict";
import test from "node:test";

import { parseCliArgs } from "./cli-args.ts";
import { LintJsError } from "./error.ts";

void test("--help / -h short-circuit before any other validation", () => {
  assert.deepEqual(parseCliArgs(["--help"]), { kind: "help" });
  assert.deepEqual(parseCliArgs(["-h"]), { kind: "help" });
  // Combined with otherwise-invalid run-mode flags: short-circuit must win.
  assert.deepEqual(parseCliArgs(["--help", "--format-only", "--lint-only"]), { kind: "help" });
});

void test("--version / -v short-circuit before any other validation", () => {
  assert.deepEqual(parseCliArgs(["--version"]), { kind: "version" });
  assert.deepEqual(parseCliArgs(["-v"]), { kind: "version" });
  assert.deepEqual(parseCliArgs(["--version", "--format-only", "--lint-only"]), {
    kind: "version",
  });
});

void test("no flags: full mode, stylish output, default target", () => {
  assert.deepEqual(parseCliArgs([]), {
    kind: "run",
    args: { mode: "full", check: false, outputMode: "stylish", targets: ["."] },
  });
});

void test("--check sets check: true and keeps mode: full", () => {
  assert.deepEqual(parseCliArgs(["--check"]), {
    kind: "run",
    args: { mode: "full", check: true, outputMode: "stylish", targets: ["."] },
  });
});

void test("--format-only selects format-only mode", () => {
  const result = parseCliArgs(["--format-only"]);
  assert.equal(result.kind, "run");
  if (result.kind === "run") assert.equal(result.args.mode, "format-only");
});

void test("--lint-only selects lint-only mode", () => {
  const result = parseCliArgs(["--lint-only"]);
  assert.equal(result.kind, "run");
  if (result.kind === "run") assert.equal(result.args.mode, "lint-only");
});

void test("--unix selects the unix output mode", () => {
  const result = parseCliArgs(["--unix"]);
  assert.equal(result.kind, "run");
  if (result.kind === "run") assert.equal(result.args.outputMode, "unix");
});

void test("positional paths pass through; absent yields ['.']", () => {
  const none = parseCliArgs([]);
  assert.deepEqual(none.kind === "run" ? none.args.targets : null, ["."]);

  const some = parseCliArgs(["src", "test/fixtures"]);
  assert.deepEqual(some.kind === "run" ? some.args.targets : null, ["src", "test/fixtures"]);
});

void test("--format-only --lint-only is rejected with LintJsError", () => {
  assert.throws(
    () => parseCliArgs(["--format-only", "--lint-only"]),
    (err) => err instanceof LintJsError && /mutually exclusive/.test(err.message),
  );
});

void test("unknown flag is rejected with LintJsError carrying the parseArgs detail", () => {
  assert.throws(
    () => parseCliArgs(["--no-such-flag"]),
    (err) =>
      err instanceof LintJsError &&
      /Argument parsing error\./.test(err.message) &&
      err.details.some((d) => /--no-such-flag/.test(d)),
  );
});
