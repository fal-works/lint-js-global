#!/usr/bin/env node
// @ts-check

import { existsSync } from "node:fs";
import { parseArgs } from "node:util";

import { buildOxfmtArgs } from "./fmt.js";
import { formatLintOutput } from "./format-diagnostics.js";
import { getSystemIgnorePatterns } from "./ignore.js";
import { buildOxlintArgs } from "./lint.js";
import { errorTagged, print, printTagged } from "./log.js";
import { getPackageVersion, packagePath, resolvePackageBin } from "./package-info.js";
import { buildPathInjectedEnv, runTool, runToolCapturingOutput } from "./run-tool.js";

/**
 * Pick the one-line summary emitted after both phases finish.
 *
 * Binary verdict (success/failure) — which phase failed is readable from the
 * tool output above, so the summary only needs to convey overall outcome and
 * whether fixes may have been applied.
 *
 * @param {object} options
 * @param {boolean} options.check
 * @param {number | null} options.fmtStatus
 * @param {number | null} options.lintStatus
 * @returns {string}
 */
function buildSummary({ check, fmtStatus, lintStatus }) {
  const ok = fmtStatus === 0 && lintStatus === 0;
  if (check) {
    return ok
      ? "Completed successfully. No issues found."
      : "Failed. Issues found; fixes required.";
  }
  return ok
    ? "Completed successfully. Issues fixed where possible."
    : "Failed. Issues fixed where possible; unfixed issues remain.";
}

const HELP_TEXT = `Usage: lint-js [--check] [--unix] [path...]

Runs oxfmt and oxlint (+ auto-fix) on a JS/TS project.
Must be run from a project root (package.json required).

Options:
  --check         Verify only; do not rewrite files.
  --unix          Emit oxlint's \`--format=unix\` output unchanged (for VS Code
                  terminal link detection). Skips the LLM-friendly layout and
                  the per-run issue-count summary.
  -h, --help      Show this help.
  -v, --version   Show version.

Without paths, the whole project is processed.
node_modules is always skipped; .gitignore, .eslintignore, .prettierignore are respected.`;

/**
 * CLI entry point. Returns the process exit code.
 *
 * @returns {number}
 */
function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      check: { type: "boolean" },
      unix: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
    allowPositionals: true,
    strict: true,
  });

  if (values.help === true) {
    print(HELP_TEXT);
    return 0;
  }
  if (values.version === true) {
    print(`lint-js ${getPackageVersion()}`);
    return 0;
  }

  if (!existsSync("package.json")) {
    errorTagged(
      "no package.json in current directory.",
      "Run lint-js from the root of a JS/TS project.",
      "(Required as a guard against accidental runs)",
    );
    return 1;
  }

  const oxfmtBin = resolvePackageBin("oxfmt", "oxfmt");
  const oxlintBin = resolvePackageBin("oxlint", "oxlint");
  const oxfmtConfig = packagePath("cfg", "oxfmtrc.json");
  const oxlintConfig = packagePath("cfg", "oxlintrc.json");
  const weakTypingsDocPath = packagePath("docs", "weak-typings.md");
  const ignorePatterns = getSystemIgnorePatterns();
  const check = values.check === true;
  const unix = values.unix === true;
  const targets = positionals.length > 0 ? positionals : ["."];

  for (const target of targets) {
    if (!existsSync(target)) {
      errorTagged(`target not found: ${target}`);
      return 1;
    }
  }

  // Phase banners deliberately omit the `lint-js:` prefix used elsewhere for CLI diagnostics.
  // They sit inline with oxfmt/oxlint's own output; prefixing would break visual cohesion.

  // Fmt start banner is unconditional although oxfmt itself prints "Checking formatting..." in check mode.
  // oxfmt's own opener is absent for zero-match runs,
  // so without this line stdout would show no trace of the fmt phase at all.
  const fmtLabel = check ? "formatting (check-only)" : "formatting";
  print(`${fmtLabel}...`);
  const fmtResult = runTool({
    name: "oxfmt",
    bin: oxfmtBin,
    args: buildOxfmtArgs(oxfmtConfig, ignorePatterns, targets, check),
  });
  // No fmt completion banner: oxfmt prints its own summary and ours would duplicate.

  print("");

  const lintLabel = check ? "linting (no auto-fix)" : "linting (with auto-fix)";
  print(`${lintLabel}...`);
  const {
    result: lintResult,
    capturedStdout: lintStdout,
    capturedStderr: lintStderr,
  } = runToolCapturingOutput({
    name: "oxlint",
    bin: oxlintBin,
    args: buildOxlintArgs(oxlintConfig, ignorePatterns, targets, check, unix),
    env: buildPathInjectedEnv(packagePath("node_modules", ".bin")),
  });
  // Replay stderr first, then stdout. Both are batched (Codex-sandbox workaround)
  // so emission timing is lost; this fixed order keeps the relayed sequence deterministic.
  process.stderr.write(lintStderr);
  const { formattedStdout, linterSummary } = formatLintOutput({
    capturedStdout: lintStdout,
    unix,
    weakTypingsDocPath,
  });
  process.stdout.write(formattedStdout);
  if (lintResult.status === 0) print(`${lintLabel}: clean.`);
  if (linterSummary !== null) {
    print("");
    print(linterSummary);
  }

  print("");
  printTagged(buildSummary({ check, fmtStatus: fmtResult.status, lintStatus: lintResult.status }));

  return Math.max(fmtResult.status ?? 1, lintResult.status ?? 1);
}

process.exitCode = main();
