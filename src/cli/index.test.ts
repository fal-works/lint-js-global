import assert from "node:assert/strict";
import test from "node:test";

import type { Logger } from "../log.ts";
import { runCli } from "./index.ts";

interface CapturingLogger {
  logger: Logger;
  stdout(): string;
  stderr(): string;
}

function createCapturingLogger(): CapturingLogger {
  let stdout = "";
  let stderr = "";
  const logger: Logger = {
    writeOut(msg) {
      stdout += msg;
    },
    writeErr(msg) {
      stderr += msg;
    },
    writeErrTagged(headline, ...details) {
      stderr += `lint-js: ${headline}\n`;
      for (const detail of details) stderr += `  ${detail}\n`;
    },
    markBlankSeparator() {},
  };
  return { logger, stdout: () => stdout, stderr: () => stderr };
}

void test("--help / -h: writes usage to stdout and returns 0", async () => {
  await Promise.all(
    ["--help", "-h"].map(async (flag) => {
      const cap = createCapturingLogger();
      const code = await runCli([flag], process.cwd(), cap.logger);
      assert.equal(code, 0, `${flag}: expected exit 0`);
      assert.match(cap.stdout(), /^Usage: lint-js/, `${flag}: expected usage on stdout`);
      assert.equal(cap.stderr(), "", `${flag}: stderr must stay empty`);
    }),
  );
});

void test("--version / -v: writes 'lint-js <semver>' to stdout and returns 0", async () => {
  await Promise.all(
    ["--version", "-v"].map(async (flag) => {
      const cap = createCapturingLogger();
      const code = await runCli([flag], process.cwd(), cap.logger);
      assert.equal(code, 0, `${flag}: expected exit 0`);
      assert.match(
        cap.stdout(),
        /^lint-js \d+\.\d+\.\d+/,
        `${flag}: expected "lint-js <semver>" on stdout`,
      );
      assert.equal(cap.stderr(), "", `${flag}: stderr must stay empty`);
    }),
  );
});

void test("argv parse error routes through the boundary as exit 2 + tagged stderr", async () => {
  // Representative case for the LintJsError boundary in `runCli`. Branch coverage of
  // `parseCliArgs` lives in `src/cli/args.test.ts`; here we just confirm a parse error
  // surfaces as exit 2 with the diagnostic on stderr (and not stdout).
  const cap = createCapturingLogger();
  const code = await runCli(["--no-such-flag"], process.cwd(), cap.logger);
  assert.equal(code, 2, "LintJsError path uses exit 2");
  assert.match(cap.stderr(), /Argument parsing error\./);
  assert.match(cap.stderr(), /--no-such-flag/);
  assert.equal(cap.stdout(), "", "tagged status must not leak to stdout");
});
