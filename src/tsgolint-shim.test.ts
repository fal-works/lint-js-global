import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { createTsgolintShimDir } from "./tsgolint-shim.ts";

void test("createTsgolintShimDir: produces a working tsgolint executable that delegates to the bundled entry", () => {
  const shim = createTsgolintShimDir();
  try {
    const binName = process.platform === "win32" ? "tsgolint.cmd" : "tsgolint";
    assert.deepEqual(readdirSync(shim.dir), [binName]);

    const result = spawnSync(join(shim.dir, binName), ["--help"], {
      encoding: "utf8",
      shell: process.platform === "win32",
    });

    assert.equal(result.error, undefined, "shim launches without spawn error");
    assert.equal(result.status, 0, "tsgolint --help exits 0");
    // tsgolint prints its CLI banner to stderr; combined output must mention the binary.
    const combined = `${result.stdout}${result.stderr}`;
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
