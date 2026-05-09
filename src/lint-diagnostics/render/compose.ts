import type { ResolvedDiagnostic, ResolvedFindings } from "../resolve.ts";
import { renderStylish } from "./stylish.ts";
import { renderUnix } from "./unix.ts";

/**
 * Pattern matching the `errorCode` of `typescript-eslint(no-unsafe-*)` diagnostics, which
 * trigger the weak-typings hint block.
 */
const UNSAFE_CODE_PATTERN = /^typescript-eslint\(no-unsafe-/;

/**
 * Per-diagnostic line layout selector.
 *
 * - `stylish`: per-file grouped layout.
 * - `unix`: one self-contained `<filename>:<L>:<C>: <message> [<code>]` line per diagnostic.
 */
export type LintOutputMode = "stylish" | "unix";

/**
 * Composed rendering of a `findings` lint run.
 *
 * Each block carries its own trailing `\n` when non-empty, or is empty when nothing applies.
 */
export interface RenderedLintOutput {
  /** Per-file diagnostics block; `""` when no file diagnostics apply. */
  fileBlock: string;

  /** Project-level diagnostics block; `""` when none apply. */
  projectBlock: string;

  /** Weak-typings hint block; `""` when no `no-unsafe-*` diagnostic is present. */
  weakTypingsHint: string;

  /** Summary line stating how many issues remain. No trailing `\n`. */
  summaryLine: string;
}

export interface RenderOptions {
  outputMode: LintOutputMode;

  /** Whether the run is `--check` (no auto-fix attempted); drops the "unfixed" qualifier. */
  check: boolean;

  /** Absolute path included in the weak-typings hint. */
  weakTypingsDocPath: string;
}

/** Precondition: `resolved.file.length + resolved.project.length > 0`. */
export function renderLintFindings(
  resolved: ResolvedFindings,
  options: RenderOptions,
): RenderedLintOutput {
  const blocks =
    options.outputMode === "stylish"
      ? renderStylish(resolved.file, resolved.project)
      : renderUnix(resolved.file, resolved.project);
  const weakTypingsHint = hasUnsafeDiagnostic(resolved.file)
    ? `${renderWeakTypingsHint(options.weakTypingsDocPath).join("\n")}\n`
    : "";
  const summaryLine = formatSummary(options.check, resolved.file.length + resolved.project.length);
  return {
    fileBlock: blocks.file,
    projectBlock: blocks.project,
    weakTypingsHint,
    summaryLine,
  };
}

function formatSummary(check: boolean, issueCount: number): string {
  const issueWord = issueCount === 1 ? "lint issue" : "lint issues";
  const qualifier = check ? "" : "unfixed ";
  return `${issueCount} ${qualifier}${issueWord}.`;
}

function renderWeakTypingsHint(docPath: string): string[] {
  return [
    "Hint on the `no-unsafe-*` diagnostics:",
    "- Remedies: `*.d.ts` augmentation, `unknown` + type predicates, or boundary module with typed wrappers.",
    "- Inline disable (`// oxlint-disable-next-line`) is not a fix; use only when explicitly permitted by the project maintainer.",
    `- See: ${docPath}`,
  ];
}

function hasUnsafeDiagnostic(resolved: readonly ResolvedDiagnostic[]): boolean {
  return resolved.some((d) => UNSAFE_CODE_PATTERN.test(d.errorCode));
}
