#!/usr/bin/env node

import { runCli } from "./cli/run.ts";
import { createConsoleLogger } from "./log.ts";

process.exitCode = await runCli(process.argv.slice(2), process.cwd(), createConsoleLogger());
