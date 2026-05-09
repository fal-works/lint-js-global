import assert from "node:assert/strict";
import test from "node:test";

import type { FmtPhaseOutcome } from "./fmt.ts";
import type { LintPhaseOutcome } from "./lint.ts";
import { buildSummary, type BuildSummaryOptions } from "./summary.ts";

const FMT_OK: FmtPhaseOutcome = { kind: "ok" };
const FMT_FATAL: FmtPhaseOutcome = { kind: "fatal" };
const FMT_FINDINGS: FmtPhaseOutcome = { kind: "findings" };
const LINT_OK: LintPhaseOutcome = { kind: "ok" };
const LINT_NO_FILES: LintPhaseOutcome = { kind: "no-files" };
const LINT_FINDINGS: LintPhaseOutcome = { kind: "findings" };

function summary(overrides: Partial<BuildSummaryOptions> = {}): string {
  return buildSummary({
    mode: "full",
    check: false,
    halted: false,
    leadingFmt: FMT_OK,
    lint: LINT_OK,
    trailingFmt: FMT_OK,
    ...overrides,
  });
}

void test("halted run returns the dedicated halt summary regardless of other state", () => {
  assert.equal(
    summary({ halted: true, leadingFmt: FMT_FATAL, lint: null, trailingFmt: null }),
    "Halted. Resolve format errors above and re-run.",
  );
  // Defensive pin: runner does not currently emit `halted: true` with mode `lint-only`
  // (halt needs a fatal leading fmt, which lint-only skips). Locked so summary stays
  // coherent if that invariant changes.
  assert.equal(
    summary({ halted: true, mode: "lint-only", leadingFmt: null, lint: null, trailingFmt: null }),
    "Halted. Resolve format errors above and re-run.",
  );
});

void test("non-check --format-only failure returns the fmt-specific failure summary", () => {
  assert.equal(
    summary({ mode: "format-only", leadingFmt: FMT_FATAL, lint: null, trailingFmt: null }),
    "Failed. Format errors remain.",
  );
});

void test("--check --format-only failure routes through the generic check-failure summary", () => {
  // The fmt-specific wording fires only on non-check fmt-only runs.
  assert.equal(
    summary({
      mode: "format-only",
      check: true,
      leadingFmt: FMT_FINDINGS,
      lint: null,
      trailingFmt: null,
    }),
    "Failed. Issues found; fixes required.",
  );
});

void test("ok run with no-files lint returns the no-lintable-files wording", () => {
  assert.equal(
    summary({ lint: LINT_NO_FILES, trailingFmt: null }),
    "Completed successfully. No lintable files matched.",
  );
  assert.equal(
    summary({ check: true, lint: LINT_NO_FILES, trailingFmt: null }),
    "Completed successfully. No lintable files matched.",
  );
});

void test("--check ok returns the clean-check summary", () => {
  assert.equal(
    summary({ check: true, trailingFmt: null }),
    "Completed successfully. No issues found.",
  );
});

void test("--check failure (fmt findings or lint findings) returns the check-failure summary", () => {
  assert.equal(
    summary({ check: true, leadingFmt: FMT_FINDINGS, trailingFmt: null }),
    "Failed. Issues found; fixes required.",
  );
  assert.equal(
    summary({ check: true, lint: LINT_FINDINGS, trailingFmt: null }),
    "Failed. Issues found; fixes required.",
  );
});

void test("non-check ok returns the fixed-where-possible summary", () => {
  assert.equal(summary(), "Completed successfully. Issues fixed where possible.");
});

void test("non-check failure returns the unfixed-issues-remain summary", () => {
  assert.equal(
    summary({ lint: LINT_FINDINGS }),
    "Failed. Issues fixed where possible; unfixed issues remain.",
  );
});

void test("non-check lint-clean run with a failed format pass returns the lint-clean summary", () => {
  assert.equal(summary({ trailingFmt: FMT_FATAL }), "Failed. Lint clean; format errors remain.");
});

void test("skipped phases (null) are treated as ok and don't drag the verdict", () => {
  assert.equal(
    summary({ mode: "lint-only", leadingFmt: null, lint: LINT_OK, trailingFmt: null }),
    "Completed successfully. Issues fixed where possible.",
  );
  assert.equal(
    summary({
      mode: "format-only",
      check: true,
      leadingFmt: FMT_OK,
      lint: null,
      trailingFmt: null,
    }),
    "Completed successfully. No issues found.",
  );
});
