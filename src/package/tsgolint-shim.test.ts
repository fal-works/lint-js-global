import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { runCommandCapturingOutput } from "../system/subprocess.ts";
import { createTsgolintShimDir } from "./tsgolint-shim.ts";

void test("createTsgolintShimDir: produces a working tsgolint executable that delegates to the bundled entry", () => {
  const shim = createTsgolintShimDir();
  try {
    const binName = process.platform === "win32" ? "tsgolint.cmd" : "tsgolint";
    assert.deepEqual(readdirSync(shim.dir), [binName]);

    const { result, capturedStdout, capturedStderr } = runCommandCapturingOutput({
      name: "tsgolint shim",
      command: join(shim.dir, binName),
      args: ["--help"],
      shell: process.platform === "win32",
    });

    assert.equal(result.status, 0, "tsgolint --help exits 0");
    // tsgolint prints its CLI banner to stderr; combined output must mention the binary.
    const combined = `${capturedStdout}${capturedStderr}`;
    assert.match(combined, /tsgolint/);
  } finally {
    shim.cleanup();
  }
});

void test("createTsgolintShimDir: cleanup removes the temp directory", () => {
  const shim = createTsgolintShimDir();
  assert.ok(existsSync(shim.dir));

  shim.cleanup();

  assert.equal(existsSync(shim.dir), false);
});
