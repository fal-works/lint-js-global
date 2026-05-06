const LOG_PREFIX = "lint-js:";

export interface LintJsErrorOptions extends ErrorOptions {
  /** Free-form detail lines emitted under the headline by {@link Logger.writeErrTagged}. */
  details?: readonly string[];
}

/**
 * Single channel for expected failures raised by lint-js itself,
 * e.g. usage errors or child-process launch failures (not a wrapped tool error).
 */
export class LintJsError extends Error {
  override name = "LintJsError";
  readonly details: readonly string[];
  constructor(message: string, options: LintJsErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.details = options.details ?? [];
  }
}

/**
 * Sink for every line lint-js writes to the user-facing channels.
 *
 * stdout carries text intended for downstream consumption.
 * stderr carries everything else.
 *
 * `writeOut` / `writeErr` accept the message verbatim; callers append `"\n"` to close a line
 * so blocks already terminated with `\n` pass through unchanged.
 *
 * Empty writes are no-ops.
 * `markBlankSeparator()` queues one stderr blank line before the next non-empty write,
 * but never creates a leading blank at the top of output.
 */
export interface Logger {
  writeOut(msg: string): void;
  writeErr(msg: string): void;

  /**
   * Tagged stderr block: a `lint-js: <headline>` line followed by 2-space-indented
   * detail lines. Used for the end-of-run outcome and {@link LintJsError} notifications.
   */
  writeErrTagged(headline: string, ...details: readonly string[]): void;

  /**
   * Queue a blank-line separator on stderr before the next non-empty write.
   *
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
