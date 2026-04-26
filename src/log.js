// @ts-check

const LOG_PREFIX = "lint-js:";

/**
 * Single channel for expected failures raised by lint-js itself,
 * e.g. usage errors or child-process launch failures (not a wrapped tool error).
 *
 * The CLI boundary catches `LintJsError` and routes it through {@link errorTagged}, then exits with
 * status 2 (distinct from status 1, which is reserved for fmt/lint findings). Anything else
 * propagates as an unhandled exception so genuine bugs surface with their full stack trace.
 */
export class LintJsError extends Error {
  name = "LintJsError";
  /** @type {readonly string[]} */
  details;
  /**
   * @param {string} message
   * @param {{ details?: readonly string[]; cause?: unknown }} [options]
   */
  constructor(message, options = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.details = options.details ?? [];
  }
}

/**
 * Plain stdout line. Used for help, version, blank separators.
 *
 * Use also for phase banners; they sit inline with oxfmt/oxlint output
 * and prefixing would break visual cohesion.
 *
 * @param {string} msg
 */
export function print(msg) {
  console.log(msg);
}

/**
 * Tagged stdout line. Used for the end-of-run outcome.
 *
 * @param {string} msg
 */
export function printTagged(msg) {
  console.log(`${LOG_PREFIX} ${msg}`);
}

/**
 * Tagged stderr headline followed by plain-text detail lines.
 *
 * @param {string} headline
 * @param {...string} details
 */
export function errorTagged(headline, ...details) {
  console.error(`${LOG_PREFIX} ${headline}`);
  for (const line of details) console.error(`  ${line}`);
}
