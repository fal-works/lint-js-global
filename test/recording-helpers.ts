import { reportLintJsError } from "../src/error.ts";
import { createLogger, type Logger } from "../src/log.ts";
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
 * `Logger` that records each emitted line into an in-memory array,
 * preserving the cross-stream call order.
 *
 * Built on the production `createLogger`, so blank-separator handling and the
 * `lint-js:` tagged-block layout stay aligned with the console logger.
 *
 * Each sink write is split on `"\n"` and pushed line-by-line.
 * A trailing `"\n"` (closing the last line) is stripped before splitting.
 */
function createRecordingLogger(): Recorder {
  const events: RecordedEvent[] = [];
  const logger = createLogger({
    write(stream, msg) {
      const parts = msg.split("\n");
      if (msg.endsWith("\n")) parts.pop();
      for (const line of parts) events.push({ stream, line });
    },
  });
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
 * Run {@link run} in-process with a recording logger, applying the same
 * `LintJsError` boundary that the CLI uses (via {@link reportLintJsError}).
 * Anything else propagates as a genuine bug.
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
    const code = reportLintJsError(err, recorder.logger);
    if (code !== null) return { events: recorder.events, exitCode: code };
    throw err;
  }
}
