const LOG_PREFIX = "lint-js:";

/**
 * Single channel for expected failures raised by lint-js itself,
 * e.g. usage errors or child-process launch failures (not a wrapped tool error).
 */
export class LintJsError extends Error {
  override name = "LintJsError";
  readonly details: readonly string[];
  constructor(message: string, options: { details?: readonly string[]; cause?: unknown } = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.details = options.details ?? [];
  }
}

/**
 * Plain stdout line. Used for help, version, blank separators.
 *
 * Use also for phase banners; they sit inline with oxfmt/oxlint output
 * and prefixing would break visual cohesion.
 */
export function print(msg: string): void {
  console.log(msg);
}

/**
 * Tagged stdout line. Used for the end-of-run outcome.
 */
export function printTagged(msg: string): void {
  console.log(`${LOG_PREFIX} ${msg}`);
}

/**
 * Tagged stderr headline followed by plain-text detail lines.
 */
export function errorTagged(headline: string, ...details: readonly string[]): void {
  console.error(`${LOG_PREFIX} ${headline}`);
  for (const line of details) console.error(`  ${line}`);
}
