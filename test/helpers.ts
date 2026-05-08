import type { SpawnSyncReturns } from "node:child_process";
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { LintJsError } from "../src/error.ts";
import type { Logger } from "../src/log.ts";
import { runCommandCapturingOutput } from "../src/run-tool.ts";
import { run, type RunArgs } from "../src/runner.ts";

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

export interface SpawnCapturingParams {
  /** Identifier used in launch-failure and signal diagnostics. */
  name: string;

  /** Executable path or command name passed directly to `spawnSync`. */
  command: string;

  /** Arguments passed to the command. */
  args: readonly string[];

  /** Working directory for the child. Defaults to the parent's cwd. */
  cwd?: string;
}

/**
 * Spawn a command with file-backed stdio and reshape the result to {@link CliRunResult}.
 *
 * Wraps {@link runCommandCapturingOutput} so tests can capture stdout/stderr separately via the
 * canonical Codex-sandbox-safe path (workaround for https://github.com/openai/codex/issues/18473).
 *
 * Throws {@link LintJsError} on launch failure or signal-driven termination.
 */
export function spawnCapturing({ name, command, args, cwd }: SpawnCapturingParams): CliRunResult {
  const { result, capturedStdout, capturedStderr } = runCommandCapturingOutput({
    name,
    command,
    args,
    cwd,
  });
  return { ...result, stdout: capturedStdout, stderr: capturedStderr };
}

export function runLintJsCli(cwd: string, args: readonly string[] = []): CliRunResult {
  return spawnCapturing({
    name: "lint-js",
    command: process.execPath,
    args: [cliPath, ...args],
    cwd,
  });
}

export interface RecordedEvent {
  stream: "out" | "err";

  /** A single line of output, without the trailing newline. */
  line: string;
}

interface Recorder {
  logger: Logger;
  events: readonly RecordedEvent[];
}

/**
 * `Logger` that records each emitted line into an in-memory array, preserving the
 * cross-stream call order.
 *
 * `writeOut` / `writeErr` arguments are split on `"\n"` and pushed line-by-line.
 * A trailing `"\n"` (closing the last line) is stripped before splitting;
 * an empty call (no `"\n"` at all) records nothing.
 * Empty arguments are no-ops.
 */
function createRecordingLogger(): Recorder {
  const events: RecordedEvent[] = [];
  let hasWritten = false;
  let pendingBlank = false;

  const flushPending = (): void => {
    if (pendingBlank && hasWritten) events.push({ stream: "err", line: "" });
    pendingBlank = false;
  };

  const pushLines = (stream: "out" | "err", msg: string): void => {
    if (msg === "") return;
    flushPending();
    hasWritten = true;
    const parts = msg.split("\n");
    if (msg.endsWith("\n")) parts.pop();
    for (const line of parts) events.push({ stream, line });
  };
  const logger: Logger = {
    writeOut(msg) {
      pushLines("out", msg);
    },
    writeErr(msg) {
      pushLines("err", msg);
    },
    writeErrTagged(headline, ...details) {
      flushPending();
      hasWritten = true;
      events.push({ stream: "err", line: `lint-js: ${headline}` });
      for (const detail of details) events.push({ stream: "err", line: `  ${detail}` });
    },
    markBlankSeparator() {
      pendingBlank = true;
    },
  };
  return { logger, events };
}

/**
 * Render recorded events into a single text snapshot,
 * prefixing each line with `OUT` / `ERR` and appending a final `EXIT <code>` row.
 * Blank lines render as the bare prefix (no trailing space).
 */
export function renderSnapshot(events: readonly RecordedEvent[], exitCode: number | null): string {
  const rendered = events.map((e) => {
    const tag = e.stream === "out" ? "OUT" : "ERR";
    return e.line === "" ? tag : `${tag} ${e.line}`;
  });
  rendered.push(`EXIT ${exitCode}`);
  return `${rendered.join("\n")}\n`;
}

/**
 * Run {@link run} in-process with a recording logger.
 *
 * Mirrors the CLI's `LintJsError` boundary: on `LintJsError`, the headline + details
 * are emitted via `writeErrTagged` and the exit code is pinned to 2. Anything else
 * propagates as a genuine bug.
 */
export function runRecording(
  cwd: string,
  args: RunArgs,
): { events: readonly RecordedEvent[]; exitCode: number } {
  const recorder = createRecordingLogger();
  try {
    const exitCode = run(args, { cwd, logger: recorder.logger });
    return { events: recorder.events, exitCode };
  } catch (err: unknown) {
    if (err instanceof LintJsError) {
      recorder.logger.writeErrTagged(err.message, ...err.details);
      return { events: recorder.events, exitCode: 2 };
    }
    throw err;
  }
}
