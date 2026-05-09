import { spawn, type SpawnOptions } from "node:child_process";
import { type FileHandle, mkdtemp, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LintJsError } from "../error.ts";

/**
 * Subset of a child-process exit record used by callers.
 *
 * Launch failures and signal-driven termination are routed through {@link LintJsError},
 * so a returned {@link SpawnResult} always represents a normal exit.
 */
interface SpawnResult {
  status: number | null;
  signal: NodeJS.Signals | null;
}

/** Internal exit record carrying the launch error so {@link ensureNormalExit} can branch on it. */
interface RawSpawnResult extends SpawnResult {
  error: Error | null;
}

interface RunToolOptions {
  /** Tool name for launch-failure diagnostics. */
  name: string;

  /** Absolute path to the tool's JS entry point. */
  bin: string;

  /** Arguments passed to the tool, excluding `bin`. */
  args: readonly string[];

  /** Working directory for the child. Defaults to the parent's cwd. */
  cwd?: string;

  /** Env for the child. Defaults to inherited. */
  env?: NodeJS.ProcessEnv;
}

interface RunCommandOptions {
  /** Command name for launch-failure diagnostics. */
  name: string;

  /** Executable path or command name passed directly to `spawn`. */
  command: string;

  /** Arguments passed to the command. */
  args: readonly string[];

  /** Working directory for the child. Defaults to the parent's cwd. */
  cwd?: string;

  /** Env for the child. Defaults to inherited. */
  env?: NodeJS.ProcessEnv;

  /** Passed through to `spawn` for platform-specific executable shims. */
  shell?: boolean | string;
}

/**
 * Run an arbitrary command and capture stdout/stderr separately for post-run inspection.
 * Use this when the caller treats the two streams differently
 * (e.g. parses stdout, relays stderr).
 *
 * File-backed stdio (not pipes): workaround for https://github.com/openai/codex/issues/18473,
 * where pipe-backed stdio from nested children can be unreliable in the Codex sandbox.
 *
 * Side effect: the child's output is batched until exit instead of streaming.
 * Both streams are captured symmetrically so the caller can flush them in a deterministic order.
 *
 * Throws {@link LintJsError} on launch failure or signal-driven termination.
 */
export async function runCommandCapturingOutput({
  name,
  command,
  args,
  cwd,
  env,
  shell,
}: RunCommandOptions): Promise<{
  result: SpawnResult;
  capturedStdout: string;
  capturedStderr: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), "lint-js-"));
  const stdoutPath = join(dir, "stdout");
  const stderrPath = join(dir, "stderr");
  let stdoutFh: FileHandle | null = null;
  let stderrFh: FileHandle | null = null;
  try {
    stdoutFh = await open(stdoutPath, "w");
    stderrFh = await open(stderrPath, "w");
    const raw = await spawnAndWait(command, args, {
      stdio: ["ignore", stdoutFh.fd, stderrFh.fd],
      cwd,
      env: env ?? process.env,
      shell,
    });
    await stdoutFh.close();
    stdoutFh = null;
    await stderrFh.close();
    stderrFh = null;
    ensureNormalExit(name, raw);
    return {
      result: { status: raw.status, signal: raw.signal },
      capturedStdout: await readFile(stdoutPath, "utf8"),
      capturedStderr: await readFile(stderrPath, "utf8"),
    };
  } finally {
    if (stdoutFh !== null) await stdoutFh.close();
    if (stderrFh !== null) await stderrFh.close();
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Like {@link runCommandCapturingOutput}, but binds the child's stdout and stderr to the
 * same fd so their natural emission order is preserved in the captured text.
 * Use this when the caller routes the whole thing into one sink
 * (and merging post-hoc would risk reordering).
 *
 * Throws {@link LintJsError} on launch failure or signal-driven termination.
 */
async function runCommandCapturingCombined({
  name,
  command,
  args,
  cwd,
  env,
  shell,
}: RunCommandOptions): Promise<{
  result: SpawnResult;
  captured: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), "lint-js-"));
  const path = join(dir, "combined");
  let fh: FileHandle | null = null;
  try {
    fh = await open(path, "w");
    const raw = await spawnAndWait(command, args, {
      stdio: ["ignore", fh.fd, fh.fd],
      cwd,
      env: env ?? process.env,
      shell,
    });
    await fh.close();
    fh = null;
    ensureNormalExit(name, raw);
    return {
      result: { status: raw.status, signal: raw.signal },
      captured: await readFile(path, "utf8"),
    };
  } finally {
    if (fh !== null) await fh.close();
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Node-tool variant of {@link runCommandCapturingOutput}: pins `process.execPath`
 * as the executable and strips color-forcing env vars so the child emits plain output.
 */
export function runToolCapturingOutput({ name, bin, args, cwd, env }: RunToolOptions): Promise<{
  result: SpawnResult;
  capturedStdout: string;
  capturedStderr: string;
}> {
  return runCommandCapturingOutput({
    name,
    command: process.execPath,
    args: [bin, ...args],
    cwd,
    env: forcePlainOutput(env ?? process.env),
  });
}

/**
 * Node-tool variant of {@link runCommandCapturingCombined}: pins `process.execPath`
 * as the executable and strips color-forcing env vars so the child emits plain output.
 */
export function runToolCapturingCombined({ name, bin, args, cwd, env }: RunToolOptions): Promise<{
  result: SpawnResult;
  captured: string;
}> {
  return runCommandCapturingCombined({
    name,
    command: process.execPath,
    args: [bin, ...args],
    cwd,
    env: forcePlainOutput(env ?? process.env),
  });
}

/**
 * Spawn the child and resolve once it exits or fails to launch.
 *
 * Folds the asynchronous `'error'` and `'exit'` events into a single resolved value so the
 * caller can branch through {@link ensureNormalExit} instead of unwrapping a rejected Promise.
 */
function spawnAndWait(
  command: string,
  args: readonly string[],
  options: SpawnOptions,
): Promise<RawSpawnResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, options);
    let settled = false;
    const settle = (value: RawSpawnResult): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    child.once("error", (error) => {
      settle({ status: null, signal: null, error });
    });
    child.once("exit", (status, signal) => {
      settle({ status, signal, error: null });
    });
  });
}

/**
 * Strip color-forcing env vars and assert `NO_COLOR=1` so child tools always emit plain output.
 */
function forcePlainOutput(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...env };
  // `NO_COLOR` alone is insufficient because `FORCE_COLOR` takes precedence in many tools.
  delete out.FORCE_COLOR;
  delete out.CLICOLOR_FORCE;
  out.NO_COLOR = "1";
  return out;
}

/**
 * Translate launch failures and signal-driven termination into {@link LintJsError}.
 * Normal exits (any numeric status, including non-zero) pass through;
 * the caller uses the status as part of its own outcome reporting.
 *
 * Without this guard, a signal-killed child surfaces as `status: null` with `error: null`,
 * which is indistinguishable from a clean exit when the caller only inspects status.
 */
function ensureNormalExit(name: string, result: RawSpawnResult): void {
  if (result.error) {
    throw new LintJsError(`failed to launch ${name}: ${result.error.message}`, {
      cause: result.error,
    });
  }
  if (result.signal !== null) {
    throw new LintJsError(`${name} was terminated by signal ${result.signal}.`);
  }
}

/**
 * Returns a copy of `process.env` with `binDir` prepended to `PATH`.
 *
 * On Windows, deduplicates case-variant `PATH` keys so the prepended entry is not shadowed
 * by an earlier-spelled variant.
 *
 * @param binDir - Directory to prepend to PATH.
 */
export function buildPathInjectedEnv(binDir: string): NodeJS.ProcessEnv {
  const isWindows = process.platform === "win32";
  const pathKey = isWindows ? "Path" : "PATH";
  const pathSep = isWindows ? ";" : ":";
  const env: NodeJS.ProcessEnv = { ...process.env };

  // On Windows, env keys are case-insensitive but spreading preserves the parent's spelling.
  // Remove other variants so Node doesn't pick an earlier entry ("PATH" < "Path" lexicographically)
  // and drop the prepended bin dir.
  if (isWindows) {
    for (const key of Object.keys(env)) {
      if (key !== pathKey && key.toUpperCase() === "PATH") delete env[key];
    }
  }
  // `process.env` lookup is case-insensitive on Windows, regardless of the stored spelling.
  env[pathKey] = `${binDir}${pathSep}${process.env[pathKey] ?? ""}`;
  return env;
}
