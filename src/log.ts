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
 * Default {@link Logger} backed by `process.stdout` / `process.stderr`.
 */
export function createConsoleLogger(): Logger {
  let hasWritten = false;
  let pendingBlank = false;

  const flushPending = (): void => {
    if (pendingBlank && hasWritten) process.stderr.write("\n");
    pendingBlank = false;
  };

  return {
    writeOut(msg) {
      if (msg.length === 0) return;
      flushPending();
      hasWritten = true;
      process.stdout.write(msg);
    },
    writeErr(msg) {
      if (msg.length === 0) return;
      flushPending();
      hasWritten = true;
      process.stderr.write(msg);
    },
    writeErrTagged(headline, ...details) {
      flushPending();
      hasWritten = true;
      process.stderr.write(`${LOG_PREFIX} ${headline}\n`);
      for (const line of details) process.stderr.write(`  ${line}\n`);
    },
    markBlankSeparator() {
      pendingBlank = true;
    },
  };
}
