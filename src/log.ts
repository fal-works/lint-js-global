const LOG_PREFIX = "lint-js:";

/**
 * Sink for every line lint-js writes to the user-facing channels.
 *
 * stdout carries text intended for downstream consumption.
 * stderr carries everything else.
 */
export interface Logger {
  /**
   * Write the message verbatim to stdout.
   *
   * Callers append `"\n"` to close a line,
   * so blocks already terminated with `\n` pass through unchanged.
   *
   * Empty writes are no-ops.
   */
  writeOut(msg: string): void;

  /**
   * Write the message verbatim to stderr.
   *
   * Callers append `"\n"` to close a line,
   * so blocks already terminated with `\n` pass through unchanged.
   *
   * Empty writes are no-ops.
   */
  writeErr(msg: string): void;

  /**
   * Tagged stderr block: a `lint-js: <headline>` line followed by 2-space-indented detail lines.
   *
   * Used for the end-of-run outcome and {@link LintJsError} notifications.
   */
  writeErrTagged(headline: string, ...details: readonly string[]): void;

  /**
   * Queue a blank-line separator on stderr before the next non-empty write.
   *
   * Never creates a leading blank at the top of output.
   * Multiple consecutive calls collapse to one separator.
   */
  markBlankSeparator(): void;
}

/**
 * Underlying byte-level sink that backs a {@link Logger} built by {@link createLogger}.
 *
 * The state machine in {@link createLogger} translates every {@link Logger} method
 * into one or more `(stream, msg)` calls here; concrete sinks decide how each write
 * is materialized.
 *
 * `msg` is always non-empty and may contain embedded `"\n"` characters.
 */
export interface LoggerSink {
  write(stream: "out" | "err", msg: string): void;
}

/**
 * Build a {@link Logger} that delegates byte-level writes to `sink` and centralizes
 * the blank-separator state machine plus the `lint-js:` tagged-block layout.
 *
 * Concrete loggers differ only in their sink, so user-facing logging behavior stays
 * identical across them.
 */
export function createLogger(sink: LoggerSink): Logger {
  let hasWritten = false;
  let pendingBlank = false;

  const flushPending = (): void => {
    if (pendingBlank && hasWritten) sink.write("err", "\n");
    pendingBlank = false;
  };

  const write = (stream: "out" | "err", msg: string): void => {
    if (msg.length === 0) return;
    flushPending();
    hasWritten = true;
    sink.write(stream, msg);
  };

  return {
    writeOut(msg) {
      write("out", msg);
    },
    writeErr(msg) {
      write("err", msg);
    },
    writeErrTagged(headline, ...details) {
      flushPending();
      hasWritten = true;
      sink.write("err", `${LOG_PREFIX} ${headline}\n`);
      for (const line of details) sink.write("err", `  ${line}\n`);
    },
    markBlankSeparator() {
      pendingBlank = true;
    },
  };
}

/**
 * Default {@link Logger} backed by `process.stdout` / `process.stderr`.
 */
export function createConsoleLogger(): Logger {
  return createLogger({
    write(stream, msg) {
      const target = stream === "out" ? process.stdout : process.stderr;
      target.write(msg);
    },
  });
}
