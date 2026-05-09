/** Code-point cap for the rendered slice's first line before truncation kicks in. */
const SLICE_MAX_LEN = 40;

/**
 * Extract the first line, truncate if too long,
 * and append a multi-line marker if more lines follow.
 */
export function formatCodeSlice(text: string): { text: string; truncated: boolean } {
  const nlIdx = text.search(/\r?\n/);
  const hasMoreLines = nlIdx !== -1;
  const rawFirstLine = hasMoreLines ? text.slice(0, nlIdx) : text;
  // Strip a trailing CR left when the span ends exactly at the CR of a CRLF
  // pair (the LF that the regex would otherwise consume is outside the span).
  const firstLine = rawFirstLine.replace(/\r$/, "");
  // Iterate as Unicode code points (not UTF-16 units) so e.g. "𠮷" counts as 1.
  const codePoints = Array.from(firstLine);
  if (codePoints.length > SLICE_MAX_LEN) {
    return { text: `${codePoints.slice(0, SLICE_MAX_LEN).join("")}...`, truncated: true };
  }
  if (hasMoreLines) {
    return { text: `${firstLine} ...`, truncated: true };
  }
  return { text: firstLine, truncated: false };
}
