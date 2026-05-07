#!/usr/bin/env node

import { parseArgs } from "node:util";

import { LintJsError } from "./error.ts";
import { createConsoleLogger, type Logger } from "./log.ts";
import { getPackageVersion } from "./package-info.ts";
import { run, type RunArgs, type RunMode } from "./runner.ts";

const HELP_TEXT = `Usage: lint-js [--check] [--format-only | --lint-only] [--unix] [path...]

Runs oxfmt and oxlint (+ auto-fix) on a JS/TS project.
Must be run from a project root (package.json required).

Options:
  --check         Verify only; do not rewrite files.
  --format-only   Run only the format phase (skip lint).
  --lint-only     Run only the lint phase (skip format).
  --unix          Emit unix-format diagnostic lines on stdout (one per diagnostic).
  -h, --help      Show this help.
  -v, --version   Show version.

Without paths, the whole project is processed.
node_modules is always skipped; each tool's standard ignore files (like .gitignore) are respected.`;

/**
 * Parsed and validated CLI arguments.
 *
 * `help` / `version` short-circuit the run before any other validation fires,
 * so they are modeled as their own variants and do not carry run-mode fields.
 */
type CliArgs = { kind: "help" } | { kind: "version" } | { kind: "run"; args: RunArgs };

/**
 * Parse and validate `argv` (the slice after node + script).
 * Any usage error is raised as `LintJsError` so the boundary handler reports it and exits 2.
 */
function parseCliArgs(argv: readonly string[]): CliArgs {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      options: {
        check: { type: "boolean" },
        "format-only": { type: "boolean" },
        "lint-only": { type: "boolean" },
        unix: { type: "boolean" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
      allowPositionals: true,
      strict: true,
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);

    throw new LintJsError(`Argument parsing error.`, { cause: err, details: [errMsg] });
  }

  const { values, positionals } = parsed;

  if (values.help === true) return { kind: "help" };
  if (values.version === true) return { kind: "version" };

  const formatOnly = values["format-only"] === true;
  const lintOnly = values["lint-only"] === true;
  if (formatOnly && lintOnly) {
    throw new LintJsError("`--format-only` and `--lint-only` are mutually exclusive.");
  }
  const mode: RunMode = formatOnly ? "format-only" : lintOnly ? "lint-only" : "full";

  return {
    kind: "run",
    args: {
      mode,
      check: values.check === true,
      outputMode: values.unix === true ? "unix" : "stylish",
      targets: positionals.length > 0 ? positionals : ["."],
    },
  };
}

/**
 * CLI entry point. Returns the process exit code.
 *
 * Exit codes:
 * - 0: success (any auto-fixable issues were fixed and nothing remains)
 * - 1: unfixed fmt/lint findings remain and are reported
 * - 2: expected failure raised by lint-js itself
 *
 * Anything else is re-thrown so genuine bugs surface with their full stack trace.
 */
function main(logger: Logger): number {
  try {
    const cliArgs = parseCliArgs(process.argv.slice(2));
    if (cliArgs.kind === "help") {
      logger.writeOut(`${HELP_TEXT}\n`);
      return 0;
    }
    if (cliArgs.kind === "version") {
      logger.writeOut(`lint-js ${getPackageVersion()}\n`);
      return 0;
    }
    return run(cliArgs.args, { cwd: process.cwd(), logger });
  } catch (err: unknown) {
    if (err instanceof LintJsError) {
      logger.writeErrTagged(err.message, ...err.details);
      return 2;
    }
    throw err;
  }
}

process.exitCode = main(createConsoleLogger());
