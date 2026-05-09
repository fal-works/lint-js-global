import type { Logger } from "./log.ts";

interface LintJsErrorOptions extends ErrorOptions {
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

/** Exit code reserved for {@link LintJsError}. */
const LINT_JS_ERROR_EXIT_CODE = 2;

/**
 * Map a {@link LintJsError} to a tagged stderr block plus the reserved exit code,
 * returned to the caller. Returns `null` for any other error so callers can re-throw.
 */
export function reportLintJsError(err: unknown, logger: Logger): number | null {
  if (err instanceof LintJsError) {
    logger.writeErrTagged(err.message, ...err.details);
    return LINT_JS_ERROR_EXIT_CODE;
  }
  return null;
}
