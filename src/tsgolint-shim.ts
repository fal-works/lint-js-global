import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolvePackageBin } from "./package-info.ts";

/**
 * A temporary directory containing a `tsgolint` executable shim that delegates to the
 * bundled `oxlint-tsgolint` entry point.
 */
export interface TsgolintShimHandle {
  /**
   * Path of the shim directory.
   *
   * Caller prepends this to the child's `PATH` so that `oxlint`'s native side picks up the shim.
   */
  dir: string;

  /** Removes the shim directory. Caller invokes on teardown. */
  cleanup: () => void;
}

/**
 * Create a runtime shim directory that exposes a `tsgolint` executable bound to the bundled
 * `oxlint-tsgolint` entry point.
 *
 * Bypasses any package-manager-generated `node_modules/.bin/tsgolint` shim, whose relative
 * path layout assumptions (notably pnpm's virtual store) break when the shim is invoked
 * via a symlinked-through path. This shim resolves `oxlint-tsgolint`'s entry via Node's
 * package resolution and embeds absolute paths, so it works regardless of the consumer's
 * package manager layout.
 */
export function createTsgolintShimDir(): TsgolintShimHandle {
  const tsgolintEntry = resolvePackageBin("oxlint-tsgolint", "tsgolint");
  const dir = mkdtempSync(join(tmpdir(), "lint-js-shim-"));
  try {
    if (process.platform === "win32") {
      const content = `@"${process.execPath}" "${tsgolintEntry}" %*\r\n`;
      writeFileSync(join(dir, "tsgolint.cmd"), content);
    } else {
      const content = `#!/bin/sh\nexec "${process.execPath}" "${tsgolintEntry}" "$@"\n`;
      const path = join(dir, "tsgolint");
      writeFileSync(path, content);
      chmodSync(path, 0o755);
    }
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
