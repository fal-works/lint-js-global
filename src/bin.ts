#!/usr/bin/env node

import { runCli } from "./cli.ts";
import { createConsoleLogger } from "./log.ts";

process.exitCode = runCli(process.argv.slice(2), process.cwd(), createConsoleLogger());
