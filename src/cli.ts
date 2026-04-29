#!/usr/bin/env node

import { existsSync } from "node:fs";
import { parseArgs } from "node:util";

import { buildOxfmtArgs } from "./fmt.ts";
import { formatLintOutput } from "./format-diagnostics.ts";
import { getSystemIgnorePatterns } from "./ignore.ts";
import { buildOxlintArgs } from "./lint.ts";
import { errorTagged, LintJsError, print, printTagged } from "./log.ts";
import { getPackageVersion, resolvePackageBin } from "./package-info.ts";
import {
  NODE_MODULES_BIN,
  OXFMT_CONFIG,
  OXLINT_CONFIG,
  WEAK_TYPINGS_DOC,
} from "./package-paths.ts";
import { buildPathInjectedEnv, runTool, runToolCapturingOutput } from "./run-tool.ts";

/**
 * Pick the one-line summary emitted after the run finishes.
 *
 * Binary verdict only (success/failure).
 * Which phase failed is readable from the tool output above,
 * so the summary only needs to convey overall outcome
 * and whether fixes may have been applied.
 *
 * `null` for either status means the phase was skipped (`--format-only` /
 * `--lint-only`); skipped phases do not contribute to the verdict.
 */
function buildSummary({
  check,
  fmtStatus,
  lintStatus,
}: {
  check: boolean;
  fmtStatus: number | null;
  lintStatus: number | null;
}): string {
  const fmtOk = fmtStatus === null || fmtStatus === 0;
  const lintOk = lintStatus === null || lintStatus === 0;
  const ok = fmtOk && lintOk;
  if (check) {
    return ok
      ? "Completed successfully. No issues found."
      : "Failed. Issues found; fixes required.";
  }
  return ok
    ? "Completed successfully. Issues fixed where possible."
    : "Failed. Issues fixed where possible; unfixed issues remain.";
}

const HELP_TEXT = `Usage: lint-js [--check] [--format-only | --lint-only] [--unix] [path...]

Runs oxfmt and oxlint (+ auto-fix) on a JS/TS project.
Must be run from a project root (package.json required).

Options:
  --check         Verify only; do not rewrite files.
  --format-only   Run only the format phase (skip lint).
  --lint-only     Run only the lint phase (skip format).
  --unix          Emit oxlint's \`--format=unix\` output unchanged (for VS Code
                  terminal link detection). Skips the LLM-friendly layout and
                  the per-run issue-count summary.
  -h, --help      Show this help.
  -v, --version   Show version.

Without paths, the whole project is processed.
node_modules is always skipped; each tool's standard ignore files (like .gitignore) are respected.`;

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
function main(): number {
  try {
    return runMain();
  } catch (err: unknown) {
    if (err instanceof LintJsError) {
      errorTagged(err.message, ...err.details);
      return 2;
    }
    throw err;
  }
}

/** Run-mode CLI arguments: the variant of `CliArgs` that drives an actual lint/fmt run. */
interface CliRunArgs {
  kind: "run";
  check: boolean;
  unix: boolean;
  formatOnly: boolean;
  lintOnly: boolean;
  targets: string[];
}

/**
 * Parsed and validated CLI arguments.
 *
 * `help` / `version` short-circuit the run before any other validation fires,
 * so they are modeled as their own variants and do not carry run-mode fields.
 */
type CliArgs = { kind: "help" } | { kind: "version" } | CliRunArgs;

/**
 * Parse and validate `process.argv`.
 * Any usage error is raised as `LintJsError` so the boundary handler reports it and exits 2.
 */
function parseCliArgs(): CliArgs {
  let parsed;
  try {
    parsed = parseArgs({
      args: process.argv.slice(2),
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

  return {
    kind: "run",
    check: values.check === true,
    unix: values.unix === true,
    formatOnly,
    lintOnly,
    targets: positionals.length > 0 ? positionals : ["."],
  };
}

function runMain(): number {
  const args = parseCliArgs();

  if (args.kind === "help") {
    print(HELP_TEXT);
    return 0;
  }
  if (args.kind === "version") {
    print(`lint-js ${getPackageVersion()}`);
    return 0;
  }

  const { check, unix, formatOnly, lintOnly, targets } = args;

  if (!existsSync("package.json")) {
    throw new LintJsError("no package.json in current directory.", {
      details: [
        "Run lint-js from the root of a JS/TS project.",
        "(Required as a guard against accidental runs)",
      ],
    });
  }

  const ignorePatterns = getSystemIgnorePatterns();

  for (const target of targets) {
    if (!existsSync(target)) {
      throw new LintJsError(`target not found: ${target}`);
    }
  }

  const runFmt = !lintOnly;
  const runLint = !formatOnly;

  let fmtStatus: number | null = null;
  if (runFmt) {
    const oxfmtBin = resolvePackageBin("oxfmt", "oxfmt");
    const fmtLabel = check ? "formatting (check-only)" : "formatting";
    print(`${fmtLabel}...`);
    const fmtResult = runTool({
      name: "oxfmt",
      bin: oxfmtBin,
      args: buildOxfmtArgs(OXFMT_CONFIG, ignorePatterns, targets, check),
    });
    // No fmt completion banner: oxfmt prints its own summary and ours would duplicate.
    fmtStatus = fmtResult.status;
  }

  if (runFmt && runLint) print("");

  let lintStatus: number | null = null;
  if (runLint) {
    const oxlintBin = resolvePackageBin("oxlint", "oxlint");
    const lintLabel = check ? "linting (no auto-fix)" : "linting (with auto-fix)";
    print(`${lintLabel}...`);
    const {
      result: lintResult,
      capturedStdout: lintStdout,
      capturedStderr: lintStderr,
    } = runToolCapturingOutput({
      name: "oxlint",
      bin: oxlintBin,
      args: buildOxlintArgs(OXLINT_CONFIG, ignorePatterns, targets, check, unix),
      env: buildPathInjectedEnv(NODE_MODULES_BIN),
    });
    // Replay stderr first, then stdout. Both are batched (Codex-sandbox workaround)
    // so emission timing is lost; this fixed order keeps the relayed sequence deterministic.
    process.stderr.write(lintStderr);
    const { formattedStdout, linterSummary, schemaMismatch, noFilesMatched } = formatLintOutput({
      capturedStdout: lintStdout,
      unix,
      weakTypingsDocPath: WEAK_TYPINGS_DOC,
    });
    process.stdout.write(formattedStdout);
    if (schemaMismatch !== null) {
      // Raw stdout was relayed above; route the contract failure through LintJsError.
      throw new LintJsError("oxlint output contract mismatch.", {
        details: [schemaMismatch.reason, "Raw payload relayed to stdout above."],
      });
    }
    // oxlint ≥1.61 exits non-zero when no files match the targets; treat that as clean.
    const lintCleanish = lintResult.status === 0 || noFilesMatched;
    if (lintCleanish) print(`${lintLabel}: clean.`);
    if (linterSummary !== null) {
      print("");
      print(linterSummary);
    }
    lintStatus = lintCleanish ? 0 : lintResult.status;
  }

  print("");
  printTagged(buildSummary({ check, fmtStatus, lintStatus }));

  // Collapse any non-zero child status to 1; exit 2 is reserved for LintJsError.
  const fmtFailed = fmtStatus !== null && fmtStatus !== 0;
  const lintFailed = lintStatus !== null && lintStatus !== 0;
  return fmtFailed || lintFailed ? 1 : 0;
}

process.exitCode = main();
