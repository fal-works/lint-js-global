import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runCommandCapturingOutput } from "../src/system/subprocess.ts";

const here = dirname(fileURLToPath(import.meta.url));
const binPath = join(here, "..", "src", "bin.ts");

export interface CliRunResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

export interface SpawnCapturingParams {
  /** Identifier used in launch-failure and signal diagnostics. */
  name: string;

  /** Executable path or command name passed directly to `spawn`. */
  command: string;

  /** Arguments passed to the command. */
  args: readonly string[];

  /** Working directory for the child. Defaults to the parent's cwd. */
  cwd?: string;

  /** Env for the child. Defaults to inherited. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Spawn a command with file-backed stdio and reshape the result to {@link CliRunResult}.
 *
 * Wraps {@link runCommandCapturingOutput} so tests can capture stdout/stderr separately via the
 * canonical Codex-sandbox-safe path (workaround for https://github.com/openai/codex/issues/18473).
 *
 * Throws {@link LintJsError} on launch failure or signal-driven termination.
 */
export async function spawnCapturing({
  name,
  command,
  args,
  cwd,
  env,
}: SpawnCapturingParams): Promise<CliRunResult> {
  const { result, capturedStdout, capturedStderr } = await runCommandCapturingOutput({
    name,
    command,
    args,
    cwd,
    env,
  });
  return {
    status: result.status,
    signal: result.signal,
    stdout: capturedStdout,
    stderr: capturedStderr,
  };
}

export function runLintJsCli(cwd: string, args: readonly string[] = []): Promise<CliRunResult> {
  return spawnCapturing({
    name: "lint-js",
    command: process.execPath,
    args: [binPath, ...args],
    cwd,
  });
}
