import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { copyFixture } from "../fixture-helpers.ts";
import { runRecording, streamText } from "../recording-helpers.ts";

const DEFAULT_TARGETS = ["."];

void test("full pipeline: trailing fmt normalizes drift left by oxlint --fix (ADR-0005)", async (t) => {
  const dir = copyFixture("lint-fix-drift");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const { exitCode } = await runRecording(dir, {
    mode: "full",
    check: false,
    outputMode: "stylish",
    targets: DEFAULT_TARGETS,
  });

  assert.equal(exitCode, 0);
  const after = readFileSync(join(dir, "src", "index.ts"), "utf8");
  assert.ok(after.includes(`import type { ExampleType } from "./types.ts";`));
});

void test("full pipeline: trailing fmt skipped when lint findings remain so L:C matches final file (ADR-0005)", async (t) => {
  const dir = copyFixture("lint-fix-position-stability");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const { events, exitCode } = await runRecording(dir, {
    mode: "full",
    check: false,
    outputMode: "stylish",
    targets: DEFAULT_TARGETS,
  });

  assert.equal(exitCode, 1);
  const out = streamText(events, "out");
  // Stylish head line; widens to "  L:C-L:C ..." when the code slice is truncated.
  const match = out.match(/^ {2}(\d+):(\d+)(?:-\d+:\d+)? /m);
  assert.ok(match, "expected a diagnostic head line with an L:C prefix");
  const line = Number(match[1]);
  const col = Number(match[2]);
  const finalLines = readFileSync(join(dir, "src", "index.ts"), "utf8").split("\n");
  const finalLine = finalLines[line - 1];
  assert.ok(finalLine !== undefined, `diagnostic line ${line} must exist in the final file`);
  // `oxlint --fix` splits the import and omits the inner space ("{ T}").
  // The trailing fmt would restore it ("{ T }"), shifting the specifier one column right.
  // The reported L:C stays accurate only because the trailing fmt is skipped while findings remain.
  assert.ok(
    finalLine.slice(col - 1).startsWith(`types.ts"`),
    `diagnostic ${line}:${col} must point at the duplicated import specifier in the file the consumer opens next`,
  );
});

void test("--lint-only: drift left by oxlint --fix is preserved (no trailing fmt)", async (t) => {
  const dir = copyFixture("lint-fix-drift");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const { exitCode } = await runRecording(dir, {
    mode: "lint-only",
    check: false,
    outputMode: "stylish",
    targets: DEFAULT_TARGETS,
  });

  assert.equal(exitCode, 0);
  const after = readFileSync(join(dir, "src", "index.ts"), "utf8");
  assert.ok(after.includes(`import type { ExampleType} from "./types.ts";`));
});
