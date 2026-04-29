import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  closeSync,
  cpSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cliPath = join(here, "..", "src", "cli.ts");
const fixtureRoot = join(here, "fixtures");

/** Fixture source with both fmt (double spaces) and lint (no-debugger) violations. */
export const DIRTY_SOURCE = "const x  =  1;debugger\n";

export function makeTempDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `lint-js-test-${label}-`));
}

/**
 * Copy a fixture under `test/fixtures/` to a fresh temp directory.
 *
 * @returns Path to the copied directory.
 */
export function copyFixture(fixtureName: string): string {
  const dest = makeTempDir(fixtureName);
  cpSync(join(fixtureRoot, fixtureName), dest, { recursive: true });
  return dest;
}

/** Write a matching pattern into both `.prettierignore` and `.eslintignore` at `dir`. */
export function writeIgnoreFiles(dir: string, pattern: string): void {
  writeFileSync(join(dir, ".prettierignore"), `${pattern}\n`);
  writeFileSync(join(dir, ".eslintignore"), `${pattern}\n`);
}

export interface CliRunResult extends SpawnSyncReturns<Buffer | string> {
  stdout: string;
  stderr: string;
}

export function runCli(cwd: string, args: readonly string[] = []): CliRunResult {
  const captureDir = makeTempDir("stdio");
  const stdoutPath = join(captureDir, "stdout.txt");
  const stderrPath = join(captureDir, "stderr.txt");
  let stdoutFd = -1;
  let stderrFd = -1;

  try {
    // Work around openai/codex#18473: in the Codex sandbox, nested Node child output captured
    // through pipe-backed stdout/stderr can disappear. File-backed stdio stays reliable.
    stdoutFd = openSync(stdoutPath, "w");
    stderrFd = openSync(stderrPath, "w");
    const result = spawnSync(process.execPath, [cliPath, ...args], {
      cwd,
      stdio: ["ignore", stdoutFd, stderrFd],
    });
    closeSync(stdoutFd);
    closeSync(stderrFd);
    stdoutFd = -1;
    stderrFd = -1;
    return {
      ...result,
      stdout: readFileSync(stdoutPath, "utf8"),
      stderr: readFileSync(stderrPath, "utf8"),
    };
  } finally {
    if (stdoutFd !== -1) closeSync(stdoutFd);
    if (stderrFd !== -1) closeSync(stderrFd);
    rmSync(captureDir, { recursive: true, force: true });
  }
}

interface ProgressLineExpectations {
  /**
   * `null` if the format phase is skipped entirely (via `--lint-only`);
   * banners are then asserted absent regardless of `fmtStart`/`fmtCompletion`.
   */
  fmtMode: "default" | "check-only" | null;

  fmtStart: boolean;
  fmtCompletion: boolean;

  /**
   * `null` if the lint phase is skipped entirely (via `--format-only`);
   * banners are then asserted absent regardless of `lintStart`/`lintCompletion`.
   */
  lintMode: "with auto-fix" | "no auto-fix" | null;

  lintStart: boolean;
  lintCompletion: boolean;

  summary: string;
}

/**
 * Assert the shape of every progress log line emitted by lint-js.
 *
 * Beyond presence/absence, this pins:
 *
 * - **count**: each expected line must appear exactly once (catches dupes)
 * - **order**: present lines must appear in fmt-start → fmt-completion → lint-start → lint-completion
 *   → summary order
 * - **no leading blank on completion**: a completion line is emitted directly after tool output with
 *   no intervening blank (exit 0 for oxlint is silent under our config, so there's nothing to
 *   separate from — see dev/records/003)
 * - **summary anchor**: the summary line appears exactly once, with a blank line immediately above
 *
 * Internal tool output (oxfmt / oxlint stdout between our banners) is not checked
 * — only lint-js's own lines are.
 */
export function assertProgressLines(stdout: string, expected: ProgressLineExpectations): void {
  const lines = stdout.split("\n");
  const fmtLabel = expected.fmtMode === "check-only" ? "formatting (check-only)" : "formatting";
  const lintLabel = expected.lintMode ?? "with auto-fix";
  const fmtPhaseRuns = expected.fmtMode !== null;
  const lintPhaseRuns = expected.lintMode !== null;
  /** name, line text, expected-present */
  const specs: ReadonlyArray<readonly [string, string, boolean]> = [
    ["fmt start", `${fmtLabel}...`, fmtPhaseRuns && expected.fmtStart],
    ["fmt completion", `${fmtLabel}: clean.`, fmtPhaseRuns && expected.fmtCompletion],
    ["lint start", `linting (${lintLabel})...`, lintPhaseRuns && expected.lintStart],
    ["lint completion", `linting (${lintLabel}): clean.`, lintPhaseRuns && expected.lintCompletion],
    ["summary", expected.summary, true],
  ];

  /** present lines, in the order declared above */
  const present: { name: string; idx: number }[] = [];

  for (const [name, line, expectPresent] of specs) {
    const positions = lines.flatMap((l, i) => (l === line ? [i] : []));
    if (expectPresent) {
      assert.equal(
        positions.length,
        1,
        `${name}: expected exactly 1 occurrence of ${JSON.stringify(line)}, got ${positions.length}`,
      );
      const [idx] = positions;
      if (idx === undefined) continue; // unreachable: assert above guarantees length === 1
      if (name === "summary") {
        assert.equal(
          lines[idx - 1],
          "",
          `${name}: expected blank line immediately above ${JSON.stringify(line)} (line ${idx}), got ${JSON.stringify(lines[idx - 1])}`,
        );
      } else if (name === "lint completion" || name === "fmt completion") {
        assert.notEqual(
          lines[idx - 1],
          "",
          `${name}: expected non-blank line immediately above ${JSON.stringify(line)} (line ${idx}) — completion banner should follow tool output directly`,
        );
      }
      present.push({ name, idx });
    } else {
      assert.equal(
        positions.length,
        0,
        `${name}: expected no occurrence of ${JSON.stringify(line)}, found at line(s) ${positions.join(", ")}`,
      );
    }
  }

  for (let i = 1; i < present.length; i++) {
    const prev = present[i - 1];
    const curr = present[i];
    if (prev === undefined || curr === undefined) continue; // unreachable: i-1 and i are in bounds
    assert.ok(
      prev.idx < curr.idx,
      `order: ${prev.name} (line ${prev.idx}) must precede ${curr.name} (line ${curr.idx})`,
    );
  }
}
