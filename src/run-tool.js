// @ts-check

import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LintJsError } from "./log.js";

/**
 * Launches a tool via `process.execPath` with stdio inherited.
 * Throws on launch failure so Node surfaces the stack trace.
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
  if (result.error) {
    throw new LintJsError(`failed to launch ${name}: ${result.error.message}`, {
      cause: result.error,
    });
  }
  return result;
}

/**
 * Like {@link runTool} but also captures stdout and stderr for post-run inspection.
 *
 * File-backed stdio (not pipes): workaround for https://github.com/openai/codex/issues/18473,
 * where captured pipe-backed output from a nested Node child can be dropped in the Codex sandbox.
 * Side effect: the child's output is batched until exit instead of streaming;
 * both streams are captured symmetrically so the caller can flush them in a deterministic order.
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
    if (result.error) {
      throw new LintJsError(`failed to launch ${name}: ${result.error.message}`, {
        cause: result.error,
      });
    }
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
