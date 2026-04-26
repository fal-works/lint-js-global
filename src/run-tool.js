// @ts-check

import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LintJsError } from "./log.js";

/**
 * Run a Node-based tool with stdio inherited (executed via `process.execPath`).
 *
 * Throws {@link LintJsError} on launch failure or signal-driven termination.
 *
 * @param {object} options
 * @param {string} options.name Tool name for launch-failure diagnostics.
 * @param {string} options.bin Absolute path to the tool's JS entry point.
 * @param {string[]} options.args Arguments passed to the tool, excluding `bin`.
 * @param {NodeJS.ProcessEnv} [options.env] Env for the child. Defaults to inherited.
 * @returns {ReturnType<typeof spawnSync>}
 */
export function runTool({ name, bin, args, env }) {
  const result = spawnSync(process.execPath, [bin, ...args], {
    stdio: "inherit",
    env,
  });
  ensureNormalExit(name, result);
  return result;
}

/**
 * Like {@link runTool} but also captures stdout and stderr for post-run inspection.
 *
 * File-backed stdio (not pipes): workaround for https://github.com/openai/codex/issues/18473,
 * where captured pipe-backed output from a nested Node child can be dropped in the Codex sandbox.
 *
 * Side effect: the child's output is batched until exit instead of streaming.
 * Both streams are captured symmetrically so the caller can flush them in a deterministic order.
 *
 * @param {object} options
 * @param {string} options.name
 * @param {string} options.bin
 * @param {string[]} options.args
 * @param {NodeJS.ProcessEnv} [options.env]
 * @returns {{
 *   result: ReturnType<typeof spawnSync>;
 *   capturedStdout: string;
 *   capturedStderr: string;
 * }}
 */
export function runToolCapturingOutput({ name, bin, args, env }) {
  const dir = mkdtempSync(join(tmpdir(), "lint-js-"));
  const stdoutPath = join(dir, "stdout");
  const stderrPath = join(dir, "stderr");
  let stdoutFd = -1;
  let stderrFd = -1;
  try {
    stdoutFd = openSync(stdoutPath, "w");
    stderrFd = openSync(stderrPath, "w");
    const result = spawnSync(process.execPath, [bin, ...args], {
      stdio: ["inherit", stdoutFd, stderrFd],
      env,
    });
    closeSync(stdoutFd);
    stdoutFd = -1;
    closeSync(stderrFd);
    stderrFd = -1;
    ensureNormalExit(name, result);
    return {
      result,
      capturedStdout: readFileSync(stdoutPath, "utf8"),
      capturedStderr: readFileSync(stderrPath, "utf8"),
    };
  } finally {
    if (stdoutFd !== -1) closeSync(stdoutFd);
    if (stderrFd !== -1) closeSync(stderrFd);
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Translate launch failures and signal-driven termination into {@link LintJsError}.
 * Normal exits (any numeric status, including non-zero) pass through;
 * the caller uses the status as part of its own outcome reporting.
 *
 * Without this guard, a signal-killed child surfaces as `status: null` with `error: null`,
 * which is indistinguishable from a clean exit when the caller only inspects status.
 *
 * @param {string} name Tool name for diagnostics.
 * @param {ReturnType<typeof spawnSync>} result
 * @returns {void}
 */
function ensureNormalExit(name, result) {
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
 * oxlint spawns the `tsgolint` binary via PATH lookup.
 * For globally-installed lint-js, inject our own `node_modules/.bin` at the head of PATH
 * so the bundled oxlint-tsgolint shim is found regardless of the user project's layout.
 *
 * @param {string} binDir Directory to prepend to PATH.
 * @returns {NodeJS.ProcessEnv}
 */
export function buildPathInjectedEnv(binDir) {
  const isWindows = process.platform === "win32";
  const pathKey = isWindows ? "Path" : "PATH";
  const pathSep = isWindows ? ";" : ":";
  const env = { ...process.env };

  // On Windows, env keys are case-insensitive but spreading preserves the parent's spelling.
  // Remove other variants so Node doesn't pick an earlier entry ("PATH" < "Path" lexicographically)
  // and drop the prepended bin dir.
  if (isWindows) {
    for (const key of Object.keys(env)) {
      if (key !== pathKey && key.toUpperCase() === "PATH") delete env[key];
    }
  }
  env[pathKey] = `${binDir}${pathSep}${process.env[pathKey] ?? ""}`;
  return env;
}
