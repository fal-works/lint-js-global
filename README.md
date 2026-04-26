# @fal-works/lint-js-global

Runs Oxfmt and Oxlint (+ auto-fix).

Intended as a globally-installed alternative to adding linter devDependencies to every small project.

## Install

```sh
pnpm install -g @fal-works/lint-js-global
```

## Usage

Run from a project root:

```sh
lint-js [--check] [--unix] [path...]
```

The current directory must contain `package.json` (contents not read), as a guard against accidentally running without target paths in a wide location such as `~/`.
Target paths themselves may point anywhere.

### Options

`--check` verifies formatting and lint without rewriting files.

`--unix` passes oxlint's `--format=unix` output through unchanged, for VS Code terminal link detection.
Skips the LLM-friendly layout, the hint block, and the per-run issue-count summary.

### Target Paths

Paths are optional; without them the whole project is processed.  
Each path must be an existing file or directory.

`node_modules` is always skipped.  
Standard ignore files (`.gitignore`, `.eslintignore`, `.prettierignore`) are respected if present.

### Output

Default lint output groups diagnostics per file with a self-describing legend block,
byte-accurate spans shown as `L:C` or `L:C-L:C`, the exact source-code slice the rule points at,
and the diagnostic message on a continuation line:

```
diagnostic legend:
  <location> <source-code-slice> [<error-code>]
    <message>

src/index.ts
  1:7 data = JSON.parse("{}") [typescript-eslint(no-unsafe-assignment)]
    Unsafe assignment of an `any` value.
  2:18 foo [typescript-eslint(no-unsafe-member-access)]
    Unsafe member access .foo on an `any` value.

Hint on the `no-unsafe-*` diagnostics:
- ...
- See: <package>/docs/guide/weak-typings.md

Found 2 unfixed issues in 1 file.
```

## Type-aware linting

Type-aware linting is always on.  
`lint-js` runs `oxlint --type-aware --type-check` with `oxlint-tsgolint` bundled.  
`tsconfig.json` is auto-detected per file; sub-directory tsconfigs are respected.

Strict rules including `no-floating-promises` and `no-unsafe-*` are enforced.  
See [docs/guide/weak-typings.md](docs/guide/weak-typings.md) for escape hatches.

Test files (`**/*.test.{js,ts}`) relax the `no-unsafe-*` family to accommodate mocks, fixtures, and boundary I/O.

## Notes

Rule config is currently fixed and not per-project configurable.
