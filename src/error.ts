export interface LintJsErrorOptions extends ErrorOptions {
  /** Free-form detail lines emitted under the headline by `Logger.writeErrTagged`. */
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
