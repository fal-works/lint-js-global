#!/usr/bin/env node

import { runCli } from "./cli/run.ts";
import { createConsoleLogger } from "./log.ts";

/**
 * stdio `'error'` listener: ignores `EPIPE`, rethrows other errors.
 *
 * Does not call `process.exit`, so `process.exitCode` and pending stderr writes
 * remain intact through the normal exit path.
 */
const swallowEpipe = (err: NodeJS.ErrnoException): void => {
  if (err.code === "EPIPE") return;
  throw err;
};
process.stdout.on("error", swallowEpipe);
process.stderr.on("error", swallowEpipe);

process.exitCode = await runCli(process.argv.slice(2), process.cwd(), createConsoleLogger());
