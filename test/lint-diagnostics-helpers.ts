import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";

import type {
  ResolvedDiagnostic,
  ResolvedProjectDiagnostic,
} from "../src/lint-diagnostics/resolve.ts";

/** Path used wherever a `weakTypingsDocPath` is required by the formatter. */
export const HINT_PATH = "/opt/lint-js/docs/guide/weak-typings.md";

/** Build a {@link ResolvedDiagnostic} fixture; pinned defaults map to a 1:1 `debugger;` span. */
export function makeResolved(overrides: Partial<ResolvedDiagnostic> = {}): ResolvedDiagnostic {
  return {
    filename: "/x.ts",
    errorCode: "eslint(no-debugger)",
    message: "msg",
    startLine: 1,
    startCol: 1,
    endLine: 1,
    endCol: 8,
    spanText: "debugger",
    ...overrides,
  };
}

/** Build a {@link ResolvedProjectDiagnostic} fixture; defaults to a tsconfig-level entry. */
export function makeProject(
  overrides: Partial<ResolvedProjectDiagnostic> = {},
): ResolvedProjectDiagnostic {
  return {
    filename: "tsconfig.json",
    errorCode: "typescript(tsconfig-error)",
    message: "Cannot find type definition file for 'node'.",
    ...overrides,
  };
}

/**
 * Minimal subset of an oxlint diagnostic entry,
 * just enough to drive `classifyLintRun` and the downstream resolve/render stages.
 *
 * `labels` is optional so fixtures can express the project-level shape oxlint emits
 * for diagnostics with no source span (omitted entirely or `[]`).
 */
export interface FakeDiag {
  message: string;
  code?: string | null;
  severity?: string;
  filename: string;
  labels?: Array<{ span: { offset: number; length: number } }>;
}

/**
 * Wrap an array of fake diagnostics into the `{ "diagnostics": [...], ... }` shape
 * that oxlint emits from `--format=json`.
 */
export function makeStdout(diagnostics: FakeDiag[]): string {
  return JSON.stringify({
    diagnostics,
    number_of_files: 1,
    number_of_rules: 1,
    threads_count: 1,
    start_time: 0,
  });
}

/**
 * Make a temp dir that gets cleaned up at test teardown, and pre-populate source files into it.
 */
export function setupFixture(t: TestContext, sources: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "lint-js-fmt-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [relPath, content] of Object.entries(sources)) {
    writeFileSync(join(dir, relPath), content);
  }
  return dir;
}

/**
 * Assemble an expected formatted-diagnostics string from section arrays.
 */
export function joinSections(sections: string[][]): string {
  return `${sections.map((s) => s.join("\n")).join("\n\n")}\n`;
}
