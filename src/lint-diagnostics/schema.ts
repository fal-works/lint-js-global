/**
 * Schema validation for the JSON payload that oxlint emits with `--format=json`.
 *
 * Stops at the first mismatch so shape drift surfaces as a contract error
 * rather than averaging out across silently-degraded entries.
 */

/** Discriminated-union result type for fallible validators. */
export type Result<T, E> = { ok: true; value: T } | { ok: false; reason: E };

/** Native oxlint span units. */
export interface ValidatedSpan {
  /** Byte offset from the start of the file. */
  offset: number;

  /** Span length in bytes. */
  length: number;

  /** 1-origin line number. */
  line: number;

  /** 1-origin column, byte-based. */
  column: number;
}

/** Per-label structural unit. */
export interface ValidatedLabel {
  /** Source span the rule points at. */
  span: ValidatedSpan;
}

/**
 * Per-diagnostic shape after schema validation. Only fields downstream consumers use are kept.
 */
export interface ValidatedDiagnostic {
  filename: string;

  /** Nullable: oxc parser-error diagnostics omit `code`. */
  code: string | null;

  message: string;

  /** Non-empty array of labels emitted by oxlint. */
  labels: [ValidatedLabel, ...ValidatedLabel[]];
}

/**
 * Validate the parsed oxlint payload against the {@link ValidatedDiagnostic} contract.
 */
export function validatePayload(parsed: unknown): Result<ValidatedDiagnostic[], string> {
  if (!isObject(parsed)) return { ok: false, reason: "top-level value is not an object" };
  const diagnostics = parsed.diagnostics;
  if (!isUnknownArray(diagnostics)) {
    return { ok: false, reason: "`diagnostics` is missing or not an array" };
  }
  const validated: ValidatedDiagnostic[] = [];
  for (let i = 0; i < diagnostics.length; i++) {
    const result = validateDiagnostic(diagnostics[i]);
    if (!result.ok) return { ok: false, reason: `diagnostics[${i}]: ${result.reason}` };
    validated.push(result.value);
  }
  return { ok: true, value: validated };
}

function validateDiagnostic(diag: unknown): Result<ValidatedDiagnostic, string> {
  if (!isObject(diag)) return { ok: false, reason: "not an object" };
  if (typeof diag.filename !== "string") {
    return { ok: false, reason: "`filename` is missing or not a string" };
  }
  const codeResult = validateOptionalString(diag.code, "code");
  if (!codeResult.ok) return codeResult;
  const code = codeResult.value;
  if (typeof diag.message !== "string") {
    return { ok: false, reason: "`message` is missing or not a string" };
  }
  const message = diag.message;
  if (!isUnknownArray(diag.labels) || diag.labels.length === 0) {
    return { ok: false, reason: "`labels` is missing or empty" };
  }
  const firstResult = validateLabel(diag.labels[0], 0);
  if (!firstResult.ok) return firstResult;
  const labels: [ValidatedLabel, ...ValidatedLabel[]] = [firstResult.value];
  for (let i = 1; i < diag.labels.length; i++) {
    const result = validateLabel(diag.labels[i], i);
    if (!result.ok) return result;
    labels.push(result.value);
  }
  return {
    ok: true,
    value: { filename: diag.filename, code, message, labels },
  };
}

function validateLabel(label: unknown, index: number): Result<ValidatedLabel, string> {
  const at = `labels[${index}]`;
  if (!isObject(label)) return { ok: false, reason: `\`${at}\` is not an object` };
  const span = label.span;
  if (!isObject(span)) {
    return { ok: false, reason: `\`${at}.span\` is missing or not an object` };
  }
  if (!isNonNegativeInteger(span.offset)) {
    return { ok: false, reason: `\`${at}.span.offset\` is not a non-negative integer` };
  }
  if (!isNonNegativeInteger(span.length)) {
    return { ok: false, reason: `\`${at}.span.length\` is not a non-negative integer` };
  }
  if (!isPositiveInteger(span.line)) {
    return { ok: false, reason: `\`${at}.span.line\` is not a positive integer` };
  }
  if (!isPositiveInteger(span.column)) {
    return { ok: false, reason: `\`${at}.span.column\` is not a positive integer` };
  }
  return {
    ok: true,
    value: {
      span: {
        offset: span.offset,
        length: span.length,
        line: span.line,
        column: span.column,
      },
    },
  };
}

/**
 * Accept string, null, or undefined as a valid optional-string field. A present-but-wrong-typed
 * value (e.g. a structured object from a future schema change) is rejected so caret-range
 * upstream drift surfaces as a contract failure instead of being silently coerced to null.
 *
 * @param name - Field name, used in the failure reason.
 */
function validateOptionalString(v: unknown, name: string): Result<string | null, string> {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v === "string") return { ok: true, value: v };
  return { ok: false, reason: `\`${name}\` is present but not a string or null` };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * Type-guard wrapper for `Array.isArray` that narrows to `unknown[]` instead of `any[]`.
 */
function isUnknownArray(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

function isNonNegativeInteger(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function isPositiveInteger(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1;
}
