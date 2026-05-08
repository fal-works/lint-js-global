import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";

/** Path used wherever a `weakTypingsDocPath` is required by the formatter. */
export const HINT_PATH = "/opt/lint-js/docs/guide/weak-typings.md";

/**
 * Minimal subset of an oxlint diagnostic entry, just enough to drive `formatLintOutput`.
 */
export interface FakeDiag {
  message: string;
  code?: string | null;
  severity?: string;
  filename: string;
  labels: Array<{ span: { offset: number; length: number; line: number; column: number } }>;
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
