import { HELP_TEXT, parseCliArgs } from "./cli-args.ts";
import { LintJsError } from "./error.ts";
import type { Logger } from "./log.ts";
import { getPackageVersion } from "./package-info.ts";
import { run } from "./runner.ts";

/**
 * CLI top-level flow. Parses `argv`, dispatches to {@link run} (or short-circuits on
 * `--help`/`--version`), and routes {@link LintJsError} through the boundary to a tagged stderr
 * block + exit 2.
 *
 * Exit codes:
 * - 0: success (any auto-fixable issues were fixed and nothing remains)
 * - 1: unfixed fmt/lint findings remain and are reported
 * - 2: expected failure raised by lint-js itself
 *
 * Anything else is re-thrown so genuine bugs surface with their full stack trace.
 */
export function runCli(argv: readonly string[], cwd: string, logger: Logger): number {
  try {
    const cliArgs = parseCliArgs(argv);
    if (cliArgs.kind === "help") {
      logger.writeOut(`${HELP_TEXT}\n`);
      return 0;
    }
    if (cliArgs.kind === "version") {
      logger.writeOut(`lint-js ${getPackageVersion()}\n`);
      return 0;
    }
    return run(cliArgs.args, { cwd, logger });
  } catch (err: unknown) {
    if (err instanceof LintJsError) {
      logger.writeErrTagged(err.message, ...err.details);
      return 2;
    }
    throw err;
  }
}
