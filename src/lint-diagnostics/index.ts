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
import { validatePayload, type ValidatedDiagnostic } from "./schema.ts";

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
 * Discriminated by `kind`:
 * - `diagnostics`: a normal run with a parseable payload; carries the rendered text
 * the caller routes to stdout/stderr.
 * - `no-files`: oxlint signaled that no files matched any target (oxlint ≥1.61 prepends
 * a human-readable line to stdout and exits non-zero in that case).
 * - `contract-failure`: captured stdout breached the wrapper's output contract;
 * carries the raw payload and the offending reason for the caller to relay through
 * the error boundary.
 */
export type FormatLintResult =
  | FormatDiagnosticsResult
  | { kind: "no-files" }
  | { kind: "contract-failure"; rawStdout: string; reason: string };

export interface FormatDiagnosticsResult {
  kind: "diagnostics";

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
   * Null when there is nothing to summarize (no diagnostics).
   */
  linterSummary: string | null;
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
  if (OXLINT_NO_FILES_RE.test(capturedStdout)) return { kind: "no-files" };

  // oxlint normally always emits a JSON payload; an empty stdout is a benign edge case
  // (no payload at all) and should not be escalated to a contract failure.
  if (capturedStdout === "") return emptyDiagnostics();

  let parsed: unknown;
  try {
    parsed = JSON.parse(capturedStdout);
  } catch (err) {
    // Unparseable stdout signals a tool failure (e.g. tsgolint resolution failure, missing config),
    // not a lint diagnostic.
    // Route it through contract-failure so the wrapper boundary surfaces it as LintJsError + exit 2.
    const message = err instanceof Error ? err.message : String(err);
    return contractFailure(capturedStdout, `stdout is not valid JSON: ${message}`);
  }

  const validation = validatePayload(parsed);
  if (!validation.ok) return contractFailure(capturedStdout, validation.reason);

  const validated = validation.value;
  if (validated.length === 0) return emptyDiagnostics();

  const cache = createSourceCache(cwd ?? process.cwd());
  const resolved: ResolvedDiagnostic[] = [];
  for (const diag of validated) {
    const entry = resolveDiagnostic(diag, cache);
    if (entry === null) return contractFailure(capturedStdout, formatResolveFailure(diag));
    resolved.push(entry);
  }

  const formattedDiagnostics = renderForMode(outputMode, resolved);
  const weakTypingsHint = hasUnsafeDiagnostic(resolved)
    ? `${renderWeakTypingsHint(weakTypingsDocPath).join("\n")}\n`
    : null;
  const linterSummary = formatSummary(check, resolved.length, countFiles(resolved));

  return {
    kind: "diagnostics",
    formattedDiagnostics,
    weakTypingsHint,
    linterSummary,
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

function emptyDiagnostics(): FormatDiagnosticsResult {
  return {
    kind: "diagnostics",
    formattedDiagnostics: "",
    weakTypingsHint: null,
    linterSummary: null,
  };
}

function contractFailure(rawStdout: string, reason: string): FormatLintResult {
  return { kind: "contract-failure", rawStdout, reason };
}

function formatResolveFailure(diag: ValidatedDiagnostic): string {
  const { offset, length } = diag.labels[0].span;
  return `failed to resolve span: filename=${diag.filename}, offset=${offset}, length=${length}`;
}
