/**
 * Wrap as a POSIX shell double-quoted string,
 * escaping characters that remain active inside `"..."`: `\`, `"`, `$`, and `` ` ``.
 */
export function quotePathForPosixDoubleQuoted(path: string): string {
  return `"${path.replace(/[\\"$`]/g, "\\$&")}"`;
}

/**
 * Wrap as a Windows batch double-quoted string,
 * doubling `%` so that variable substitution does not fire on paths that happen to contain it.
 */
export function quotePathForBatchDoubleQuoted(path: string): string {
  return `"${path.replace(/%/g, "%%")}"`;
}
