import { LintJsError } from "../src/error.ts";
import type { Logger } from "../src/log.ts";
import { run, type RunArgs } from "../src/pipeline/runner.ts";

export interface RecordedEvent {
  stream: "out" | "err";

  /** A single line of output, without the trailing newline. */
  line: string;
}

interface Recorder {
  logger: Logger;
  events: readonly RecordedEvent[];
}

/**
 * `Logger` that records each emitted line into an in-memory array, preserving the
 * cross-stream call order.
 *
 * `writeOut` / `writeErr` arguments are split on `"\n"` and pushed line-by-line.
 * A trailing `"\n"` (closing the last line) is stripped before splitting;
 * an empty call (no `"\n"` at all) records nothing.
 * Empty arguments are no-ops.
 */
function createRecordingLogger(): Recorder {
  const events: RecordedEvent[] = [];
  let hasWritten = false;
  let pendingBlank = false;

  const flushPending = (): void => {
    if (pendingBlank && hasWritten) events.push({ stream: "err", line: "" });
    pendingBlank = false;
  };

  const pushLines = (stream: "out" | "err", msg: string): void => {
    if (msg === "") return;
    flushPending();
    hasWritten = true;
    const parts = msg.split("\n");
    if (msg.endsWith("\n")) parts.pop();
    for (const line of parts) events.push({ stream, line });
  };
  const logger: Logger = {
    writeOut(msg) {
      pushLines("out", msg);
    },
    writeErr(msg) {
      pushLines("err", msg);
    },
    writeErrTagged(headline, ...details) {
      flushPending();
      hasWritten = true;
      events.push({ stream: "err", line: `lint-js: ${headline}` });
      for (const detail of details) events.push({ stream: "err", line: `  ${detail}` });
    },
    markBlankSeparator() {
      pendingBlank = true;
    },
  };
  return { logger, events };
}

/**
 * Render recorded events into a single text snapshot,
 * prefixing each line with `OUT` / `ERR` and appending a final `EXIT <code>` row.
 * Blank lines render as the bare prefix (no trailing space).
 */
export function renderSnapshot(events: readonly RecordedEvent[], exitCode: number | null): string {
  const rendered = events.map((e) => {
    const tag = e.stream === "out" ? "OUT" : "ERR";
    return e.line === "" ? tag : `${tag} ${e.line}`;
  });
  rendered.push(`EXIT ${exitCode}`);
  return `${rendered.join("\n")}\n`;
}

/**
 * Pluck the events from a single stream into a single newline-joined string for matching
 * stream-specific patterns without committing the whole structure to a snapshot.
 */
export function streamText(events: readonly RecordedEvent[], stream: "out" | "err"): string {
  return events
    .filter((e) => e.stream === stream)
    .map((e) => e.line)
    .join("\n");
}

/**
 * Run {@link run} in-process with a recording logger.
 *
 * Mirrors the CLI's `LintJsError` boundary: on `LintJsError`, the headline + details
 * are emitted via `writeErrTagged` and the exit code is pinned to 2. Anything else
 * propagates as a genuine bug.
 */
export async function runRecording(
  cwd: string,
  args: RunArgs,
): Promise<{ events: readonly RecordedEvent[]; exitCode: number }> {
  const recorder = createRecordingLogger();
  try {
    const exitCode = await run(args, { cwd, logger: recorder.logger });
    return { events: recorder.events, exitCode };
  } catch (err: unknown) {
    if (err instanceof LintJsError) {
      recorder.logger.writeErrTagged(err.message, ...err.details);
      return { events: recorder.events, exitCode: 2 };
    }
    throw err;
  }
}
