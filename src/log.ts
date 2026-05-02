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
 */
export interface Logger {
  writeOut(msg: string): void;
  writeErr(msg: string): void;

  /**
   * Tagged stderr block: a `lint-js: <headline>` line followed by 2-space-indented
   * detail lines. Used for the end-of-run outcome and {@link LintJsError} notifications.
   */
  writeErrTagged(headline: string, ...details: readonly string[]): void;
}

/**
 * Default {@link Logger} backed by `process.stdout` / `process.stderr`.
 */
export function createConsoleLogger(): Logger {
  return {
    writeOut(msg) {
      process.stdout.write(msg);
    },
    writeErr(msg) {
      process.stderr.write(msg);
    },
    writeErrTagged(headline, ...details) {
      process.stderr.write(`${LOG_PREFIX} ${headline}\n`);
      for (const line of details) process.stderr.write(`  ${line}\n`);
    },
  };
}
