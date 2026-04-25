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

The current directory must contain `package.json`  
(only as a guard against accidental runs; contents are not read).

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

Default lint output groups diagnostics per file with a self-describing legend line,
byte-accurate spans shown as `L:C` or `L:C-L:C`, and the exact code slice the rule points at:

```
diagnostic legend: <location> <code-slice> [<rule-name>]

src/index.ts
  1:7 data = JSON.parse("{}") [no-unsafe-assignment]
  2:18 foo [no-unsafe-member-access]

Hint on the `no-unsafe-*` diagnostics:
- ...
- See: <package>/docs/weak-typings.md

Found 2 unfixed issues in 1 file.
```

## Type-aware linting

Type-aware linting is always on.  
`lint-js` runs `oxlint --type-aware --type-check` with `oxlint-tsgolint` bundled.  
`tsconfig.json` is auto-detected per file; sub-directory tsconfigs are respected.

Strict rules including `no-floating-promises` and `no-unsafe-*` are enforced.  
See [docs/weak-typings.md](docs/weak-typings.md) for escape hatches.

Test files (`**/*.test.{js,ts}`) relax the `no-unsafe-*` family to accommodate mocks, fixtures, and boundary I/O.

## Notes

Rule config is currently fixed and not per-project configurable.
