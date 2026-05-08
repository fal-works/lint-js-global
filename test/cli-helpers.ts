import type { SpawnSyncReturns } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runCommandCapturingOutput } from "../src/run-tool.ts";

const here = dirname(fileURLToPath(import.meta.url));
const binPath = join(here, "..", "src", "bin.ts");

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
    args: [binPath, ...args],
    cwd,
  });
}
