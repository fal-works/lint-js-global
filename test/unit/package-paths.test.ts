import assert from "node:assert/strict";
import { statSync } from "node:fs";
import test from "node:test";

import * as paths from "../../src/package-paths.ts";

void test("package-paths: every exported path resolves to an existing file or directory", () => {
  const entries = Object.entries(paths);
  assert.ok(entries.length > 0, "package-paths.ts exports nothing");

  for (const [name, value] of entries) {
    assert.equal(typeof value, "string", `${name} is not a string`);
    assert.doesNotThrow(() => statSync(value), `${name} points to a missing path: ${value}`);
  }
});
