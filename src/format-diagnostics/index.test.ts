import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import {
  HINT_PATH,
  joinSections,
  makeStdout,
  setupFixture,
} from "../../test/format-diagnostics-helpers.ts";
import { formatLintOutput } from "./index.ts";

void test("happy path: single file, single diagnostic produces formatted output and summary", (t) => {
  const dir = setupFixture(t, { "x.ts": "debugger;\n" });
  const file = join(dir, "x.ts");
  const stdout = makeStdout([
    {
      message: "`debugger` statement is not allowed.",
      code: "eslint(no-debugger)",
      severity: "error",
      filename: file,
      labels: [{ span: { offset: 0, length: 8, line: 1, column: 1 } }],
    },
  ]);

  const result = formatLintOutput({
    capturedStdout: stdout,
    check: false,
    unix: false,
    weakTypingsDocPath: HINT_PATH,
  });

  assert.equal(
    result.formattedDiagnostics,
    joinSections([
      [file, "  1:1 `debugger` statement is not allowed. [eslint(no-debugger)]", "    debugger"],
    ]),
  );
  assert.equal(result.weakTypingsHint, null);
  assert.equal(result.linterSummary, "1 unfixed lint issue in 1 file.");
  assert.equal(result.schemaMismatch, null);
  assert.equal(result.noFilesMatched, false);
});

void test("no-unsafe-* diagnostic surfaces weakTypingsHint alongside the diagnostics", (t) => {
  const dir = setupFixture(t, { "x.ts": "let data;\ndata.foo;\n" });
  const file = join(dir, "x.ts");
  const stdout = makeStdout([
    {
      message: "Unsafe member access .foo on an `any` value.",
      code: "typescript-eslint(no-unsafe-member-access)",
      severity: "error",
      filename: file,
      labels: [{ span: { offset: 14, length: 3, line: 2, column: 6 } }],
    },
  ]);

  const result = formatLintOutput({
    capturedStdout: stdout,
    check: false,
    unix: false,
    weakTypingsDocPath: HINT_PATH,
  });

  assert.match(result.formattedDiagnostics, /no-unsafe-member-access/);
  assert.ok(!result.formattedDiagnostics.includes("Hint on the"));
  assert.ok(result.weakTypingsHint !== null);
  assert.match(result.weakTypingsHint, /^Hint on the `no-unsafe-\*` diagnostics:/);
  assert.match(result.weakTypingsHint, new RegExp(`- See: ${HINT_PATH}\\n$`));
  assert.equal(result.linterSummary, "1 unfixed lint issue in 1 file.");
});

void test("zero diagnostics yields empty payload and null aux fields", () => {
  const result = formatLintOutput({
    capturedStdout: makeStdout([]),
    check: false,
    unix: false,
    weakTypingsDocPath: HINT_PATH,
  });

  assert.equal(result.formattedDiagnostics, "");
  assert.equal(result.weakTypingsHint, null);
  assert.equal(result.linterSummary, null);
  assert.equal(result.schemaMismatch, null);
});

void test("empty stdout in JSON mode is clean-compatible (no schemaMismatch)", () => {
  // oxlint should always emit JSON in default mode, but empty stdout is a benign
  // edge case (no payload at all) and should not be escalated to a contract failure.
  const result = formatLintOutput({
    capturedStdout: "",
    check: false,
    unix: false,
    weakTypingsDocPath: HINT_PATH,
  });

  assert.equal(result.schemaMismatch, null);
  assert.equal(result.formattedDiagnostics, "");
  assert.equal(result.weakTypingsHint, null);
  assert.equal(result.linterSummary, null);
  assert.equal(result.noFilesMatched, false);
});

void test("broken JSON is relayed verbatim and surfaced via schemaMismatch", () => {
  const broken = "{not valid json";

  const result = formatLintOutput({
    capturedStdout: broken,
    check: false,
    unix: false,
    weakTypingsDocPath: HINT_PATH,
  });

  assert.equal(result.formattedDiagnostics, broken);
  assert.equal(result.weakTypingsHint, null);
  assert.equal(result.linterSummary, null);
  assert.notEqual(result.schemaMismatch, null);
  assert.match(result.schemaMismatch?.reason ?? "", /JSON/);
});

void test("schema-mismatch from validator is relayed verbatim with the validator's reason", () => {
  // Smoke test that the validator's failure reason flows through to schemaMismatch.reason.
  // Detail-level cases live in oxlint-json-schema.test.ts.
  const raw = JSON.stringify({ fatal: "internal error", number_of_files: 0 });

  const result = formatLintOutput({
    capturedStdout: raw,
    check: false,
    unix: false,
    weakTypingsDocPath: HINT_PATH,
  });

  assert.equal(result.formattedDiagnostics, raw, "raw payload must be relayed verbatim");
  assert.equal(result.weakTypingsHint, null);
  assert.notEqual(result.schemaMismatch, null);
  assert.match(result.schemaMismatch?.reason ?? "", /diagnostics/);
});

void test('"No files found to lint." prefix is treated as a clean no-files run', () => {
  // oxlint ≥1.61 prepends "No files found to lint." to stdout when no files match the targets,
  // breaking JSON parsing. Surfaced as `noFilesMatched`.
  const result = formatLintOutput({
    capturedStdout:
      'No files found to lint. Please check your paths and ignore patterns.\n{ "diagnostics": [], "number_of_files": 0 }\n',
    check: false,
    unix: false,
    weakTypingsDocPath: HINT_PATH,
  });

  assert.equal(result.noFilesMatched, true);
  assert.equal(result.schemaMismatch, null);
  assert.equal(result.formattedDiagnostics, "");
  assert.equal(result.weakTypingsHint, null);
  assert.equal(result.linterSummary, null);
});

void test('"No files found to lint." prefix sets noFilesMatched in --unix mode too', () => {
  // The same prefix appears in --format=unix output, so the detection must run
  // before the unix passthrough branch.
  const raw = "No files found to lint. Please check your paths and ignore patterns.\n";
  const result = formatLintOutput({
    capturedStdout: raw,
    check: false,
    unix: true,
    weakTypingsDocPath: HINT_PATH,
  });

  assert.equal(result.noFilesMatched, true);
  assert.equal(result.schemaMismatch, null);
  assert.equal(result.formattedDiagnostics, raw, "unix mode keeps the raw payload as passthrough");
  assert.equal(result.weakTypingsHint, null);
  assert.equal(result.linterSummary, null);
});

void test("--unix mode passes stdout through unchanged", () => {
  const raw = "path/to/file.ts:3:1: message [rule-id]\n";

  const result = formatLintOutput({
    capturedStdout: raw,
    check: false,
    unix: true,
    weakTypingsDocPath: HINT_PATH,
  });

  assert.equal(result.formattedDiagnostics, raw);
  assert.equal(result.weakTypingsHint, null);
  assert.equal(result.linterSummary, null);
});
