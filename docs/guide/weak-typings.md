# Handling `no-unsafe-*` noise from weak external typings

`no-unsafe-*` fires when `any` enters your code, e.g. when the source is a weakly-typed third-party library.

Use whichever fits:

1. **Augment types via `.d.ts`** (preferred).
    - Use when: the library's shape can be described, even if the shipped typings are weak.
    - `declare module "weak-lib" { ... }` to strengthen the library's types at the source.
    - Strengthens types at the source, so all call sites benefit without per-use-site work.

2. **`unknown` + type predicates**.
    - Use when: data is inherently dynamic (`JSON.parse`, `fetch().json()`, parsers, other boundary I/O).
    - Annotate raw value as `unknown`, narrow via user predicates like `(v): v is Record<string, unknown> => v !== null && typeof v === "object"`.
    - Slight overhead of runtime checks, but appropriate for truly untyped data.

3. **Isolate at a boundary module**.
    - Use when: augmentation is infeasible, or would be disproportionately costly for the scope.
    - Put all raw calls to the weak library in one file (e.g. `lib/foo-wrapper.ts`).
    - Disable at file top using `/* oxlint-disable ... */`.
    - Export strongly-typed wrappers.
    - App code uses only wrappers.

---

Inline disable (`// oxlint-disable-next-line`) silences the symptom without addressing the `any` leak. Use only when explicitly permitted by the project maintainer. AI coding agents must not self-approve it.
