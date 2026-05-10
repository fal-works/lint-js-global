import type { Findings } from "./finding.ts";

/**
 * Outcome of one full lint run, at the IR boundary between input and output sides.
 *
 * Discriminated by `kind`:
 * - `no-files`: upstream signaled that no files matched any target.
 * - `clean`: upstream produced no diagnostics; the run is lint-clean.
 * - `contract-failure`: upstream output breached the input side's contract. `rawStdout` carries
 * the original payload so the orchestrator can attach it to a wrapper-level error.
 * - `findings`: at least one diagnostic survived input-side processing.
 * Invariant: `findings.file.length + findings.project.length > 0`.
 */
export type LintOutcome =
  | { kind: "no-files" }
  | { kind: "clean" }
  | { kind: "contract-failure"; reason: string; rawStdout: string }
  | { kind: "findings"; findings: Findings };
