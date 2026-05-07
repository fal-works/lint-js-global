import { validatePayload } from "../oxlint-json-schema.ts";
import { createSourceCache } from "../source.ts";
import {
  countFiles,
  formatSummary,
  hasUnsafeDiagnostic,
  renderStylish,
  renderUnix,
  renderWeakTypingsHint,
} from "./render.ts";
import { resolveDiagnostic, type ResolvedDiagnostic } from "./resolve.ts";

/** Matches the signal oxlint ≥1.61 prepends to stdout when no files match the targets. */
const OXLINT_NO_FILES_RE = /^No files found to lint\./;

/**
 * Per-diagnostic line layout selector.
 *
 * - `stylish`: per-file grouped layout.
 * - `unix`: one self-contained `<filename>:<L>:<C>: <message> [<code>]` line per diagnostic.
 */
export type LintOutputMode = "stylish" | "unix";

/**
 * Result of {@link formatLintOutput}.
 *
 * The three payload fields (`formattedDiagnostics`, `weakTypingsHint`, `linterSummary`)
 * are independent; the caller chooses a destination for each.
 */
export interface FormatLintResult {
  /**
   * Per-diagnostic stdout payload, ending with a trailing newline. Empty when there are no
   * diagnostics to report.
   */
  formattedDiagnostics: string;

  /**
   * Weak-typings hint block, non-null when any `no-unsafe-*` diagnostic is present.
   * Ends with a trailing newline.
   */
  weakTypingsHint: string | null;

  /**
   * Human-readable summary line stating how many issues remain.
   * In `--check` mode the "unfixed" qualifier is omitted.
   *
   * Null when there is nothing to summarize (no diagnostics, or `schemaMismatch` is non-null).
   */
  linterSummary: string | null;

  /**
   * Non-null when the captured stdout fails the wrapper's output contract:
   * either non-empty stdout that does not parse as JSON, or
   * JSON whose shape diverges from the expected diagnostic schema.
   *
   * `reason` names the offending field or parser failure.
   */
  schemaMismatch: { reason: string } | null;

  /**
   * True when oxlint signaled that no files matched any target
   * (the targets contained no lintable files, or every match was filtered out by ignore patterns).
   * oxlint ≥1.61 prepends a human-readable line to stdout and exits non-zero in that case.
   */
  noFilesMatched: boolean;
}

export interface FormatLintOptions {
  /** Raw oxlint stdout from `--format=json`. */
  capturedStdout: string;

  /** Whether the run is `--check` (no auto-fix attempted). */
  check: boolean;

  /** Per-diagnostic line layout. */
  outputMode: LintOutputMode;

  /** Absolute path used in the weak-typings hint. */
  weakTypingsDocPath: string;

  /**
   * Working directory against which oxlint's relative `filename` fields are resolved
   * when reading the source for span-slice extraction. Defaults to `process.cwd()`.
   */
  cwd?: string;
}

/**
 * Format raw oxlint JSON stdout into the structured payload.
 *
 * No stdout/stderr emission.
 * May read source files to resolve span positions.
 */
export function formatLintOutput({
  capturedStdout,
  check,
  outputMode,
  weakTypingsDocPath,
  cwd,
}: FormatLintOptions): FormatLintResult {
  const noFilesMatched = OXLINT_NO_FILES_RE.test(capturedStdout);
  if (noFilesMatched) return clean({ noFilesMatched: true });

  // oxlint normally always emits a JSON payload; an empty stdout is a benign edge case
  // (no payload at all) and should not be escalated to a contract failure.
  if (capturedStdout === "") return clean({ noFilesMatched: false });

  let parsed: unknown;
  try {
    parsed = JSON.parse(capturedStdout);
  } catch (err) {
    // Unparseable stdout signals a tool failure (e.g. tsgolint resolution failure, missing config),
    // not a lint diagnostic.
    // Route it through schemaMismatch so the wrapper boundary surfaces it as LintJsError + exit 2.
    const message = err instanceof Error ? err.message : String(err);
    return contractFailure(capturedStdout, `stdout is not valid JSON: ${message}`);
  }

  const validation = validatePayload(parsed);
  if (!validation.ok) return contractFailure(capturedStdout, validation.reason);

  const validated = validation.value;
  if (validated.length === 0) return clean({ noFilesMatched: false });

  const cache = createSourceCache(cwd ?? process.cwd());
  const resolved = validated.map((d) => resolveDiagnostic(d, cache));

  const formattedDiagnostics = renderForMode(outputMode, resolved);
  const weakTypingsHint = hasUnsafeDiagnostic(resolved)
    ? `${renderWeakTypingsHint(weakTypingsDocPath).join("\n")}\n`
    : null;
  const linterSummary = formatSummary(check, resolved.length, countFiles(resolved));

  return {
    formattedDiagnostics,
    weakTypingsHint,
    linterSummary,
    schemaMismatch: null,
    noFilesMatched: false,
  };
}

function renderForMode(mode: LintOutputMode, resolved: readonly ResolvedDiagnostic[]): string {
  switch (mode) {
    case "stylish":
      return renderStylish(resolved);
    case "unix":
      return renderUnix(resolved);
  }
}

function clean(opts: { noFilesMatched: boolean }): FormatLintResult {
  return {
    formattedDiagnostics: "",
    weakTypingsHint: null,
    linterSummary: null,
    schemaMismatch: null,
    noFilesMatched: opts.noFilesMatched,
  };
}

function contractFailure(rawStdout: string, reason: string): FormatLintResult {
  return {
    formattedDiagnostics: rawStdout,
    weakTypingsHint: null,
    linterSummary: null,
    schemaMismatch: { reason },
    noFilesMatched: false,
  };
}
