// @ts-check

const LOG_PREFIX = "lint-js:";

/** Error raised by lint-js itself (not a wrapped child-process or tool error). */
export class LintJsError extends Error {
  name = "LintJsError";
}

/**
 * Plain stdout line. Used for help, version, phase banners, blank separators.
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
