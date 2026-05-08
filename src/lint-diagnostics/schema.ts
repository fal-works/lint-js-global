/**
 * Schema validation for the JSON payload that oxlint emits with `--format=json`.
 *
 * Stops at the first mismatch so shape drift surfaces as a contract error
 * rather than averaging out across silently-degraded entries.
 */

/** Discriminated-union result type for fallible validators. */
export type Result<T, E> = { ok: true; value: T } | { ok: false; reason: E };

/**
 * Per-diagnostic shape after schema validation. Only fields downstream consumers use are kept.
 */
export interface ValidatedDiagnostic {
  filename: string;

  /** Nullable: oxc parser-error diagnostics omit `code`. */
  code: string | null;

  message: string;

  /**
   * Native oxlint span units.
   *
   * `offset` and `length` are byte counts.
   * `line` and `column` are 1-origin, with `column` byte-based.
   */
  span: { offset: number; length: number; line: number; column: number };
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
  // Reduce multi-label entries to `labels[0]`.
  // Typical extras are duplicate pointers to the identical slice at different locations.
  const first = diag.labels[0];
  if (!isObject(first)) return { ok: false, reason: "`labels[0]` is not an object" };
  const span = first.span;
  if (!isObject(span)) {
    return { ok: false, reason: "`labels[0].span` is missing or not an object" };
  }
  // Without integer-domain checks, malformed spans slip past validation and
  // surface as `<unreadable>` at the runtime path, masking contract drift.
  if (!isNonNegativeInteger(span.offset)) {
    return { ok: false, reason: "`labels[0].span.offset` is not a non-negative integer" };
  }
  if (!isNonNegativeInteger(span.length)) {
    return { ok: false, reason: "`labels[0].span.length` is not a non-negative integer" };
  }
  if (!isPositiveInteger(span.line)) {
    return { ok: false, reason: "`labels[0].span.line` is not a positive integer" };
  }
  if (!isPositiveInteger(span.column)) {
    return { ok: false, reason: "`labels[0].span.column` is not a positive integer" };
  }
  return {
    ok: true,
    value: {
      filename: diag.filename,
      code,
      message,
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
