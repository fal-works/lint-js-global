/**
 * Wrap a value as a POSIX shell double-quoted string, escaping characters that
 * remain active inside `"..."`: `\`, `"`, `$`, and `` ` ``.
 */
export function quoteForPosixDoubleQuoted(value: string): string {
  return `"${value.replace(/[\\"$`]/g, "\\$&")}"`;
}

/**
 * Wrap a value as a Windows batch double-quoted string, doubling `%` so that
 * variable substitution does not fire on values that happen to contain it.
 */
export function quoteForBatchDoubleQuoted(value: string): string {
  return `"${value.replace(/%/g, "%%")}"`;
}
