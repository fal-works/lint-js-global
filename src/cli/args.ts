import { parseArgs } from "node:util";

import { LintJsError } from "../error.ts";
import type { RunArgs, RunMode } from "../pipeline/runner.ts";

export const HELP_TEXT = `Usage: lint-js [--check] [--format-only | --lint-only] [--unix] [path...]

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
export type CliArgs = { kind: "help" } | { kind: "version" } | { kind: "run"; args: RunArgs };

/**
 * Parse and validate `argv` (the slice after node + script).
 * Any usage error is raised as `LintJsError` so the boundary handler reports it and exits 2.
 */
export function parseCliArgs(argv: readonly string[]): CliArgs {
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
