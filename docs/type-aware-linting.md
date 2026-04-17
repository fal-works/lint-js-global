# Type-aware linting

`lint-js` runs `oxlint --type-aware --type-check`. `oxlint-tsgolint` is bundled.
`tsconfig.json` is auto-detected per file; sub-directory tsconfigs are respected.

## Handling `no-unsafe-*` noise from weak external typings

`no-unsafe-*` fires when `any` enters your code. When the source is a weakly-typed third-party library, pick one:

1. **Augment types via `.d.ts`** (preferred). Add `declare module "weak-lib" { ... }` to strengthen the library's types.
2. **Isolate at a boundary module**. Put all raw calls to the weak library in one file (e.g. `lib/foo-wrapper.ts`). Disable at file top:
    ```ts
    /* oxlint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
    ```
    Export strongly-typed wrappers. App code uses only wrappers.
3. **Inline disable** (last resort). `// oxlint-disable-next-line @typescript-eslint/no-unsafe-<rule>` at the offending line. Scales poorly; promote to (2) if repeated.
