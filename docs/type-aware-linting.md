# Type-aware linting

`lint-js` runs `oxlint --type-aware --type-check`. `oxlint-tsgolint` is bundled.
`tsconfig.json` is auto-detected per file; sub-directory tsconfigs are respected.

## Handling `no-unsafe-*` noise from weak external typings

`no-unsafe-*` fires when `any` enters your code, e.g. when the source is a weakly-typed third-party library.
Inline disable (`// oxlint-disable-next-line`) is mechanically available, but generally should not be considered an option.

Pick one:

1. **Augment types via `.d.ts`** (preferred).
    - `declare module "weak-lib" { ... }` to strengthen the library's types at the source.

2. **`unknown` + type predicates** for boundary data (`JSON.parse`, `fetch().json()`, parsers).
    - Annotate raw value as `unknown`, narrow via user predicates like `(v): v is Record<string, unknown> => v !== null && typeof v === "object"`.
    - No assertion, no disable needed.
    - Slight overhead of runtime checks, but appropriate for truly untyped data.

3. **Isolate at a boundary module**.
    - Put all raw calls to the weak library in one file (e.g. `lib/foo-wrapper.ts`).
    - Disable at file top using `/* oxlint-disable ... */`.
    - Export strongly-typed wrappers.
    - App code uses only wrappers.
