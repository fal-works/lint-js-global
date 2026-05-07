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
lint-js [--check] [--format-only | --lint-only] [--unix] [path...]
```

The current directory must contain `package.json` (contents not read), as a guard against accidentally running without target paths in a wide location such as `~/`.
Target paths themselves may point anywhere.

### Options

- `--check` verifies formatting and lint without rewriting files.
- `--format-only` runs only the format phase; the lint phase is skipped entirely.
- `--lint-only` is the symmetric counterpart (runs only the lint phase).
- `--unix` emits oxlint's `--format=unix` output on stdout instead of the default LLM-friendly layout.

`--format-only` and `--lint-only` are mutually exclusive.

### Target Paths

Paths are optional; without them the whole project is processed.  
Each path must be an existing file or directory.

`node_modules` is always skipped.  
Each tool's standard ignore files (like `.gitignore`) are respected.

### Output

stdout carries lint-result text only, so it can be piped into another tool without further filtering.
Auxiliary text goes to stderr: the issue-count summary, the final tagged status line, formatter failures, and (when applicable) a short hint pointing to some diagnostic rules.
The format phase is silent on success.

Default lint output groups diagnostics per file.
Each diagnostic occupies two lines: a head line with the byte-accurate location (`L:C` or `L:C-L:C`), the diagnostic message, and the bracketed error code; followed by a continuation line carrying the exact source-code slice the rule points at.

```
src/index.ts
  1:7 Unsafe assignment of an `any` value. [typescript-eslint(no-unsafe-assignment)]
    data = JSON.parse("{}")
  2:18 Unsafe member access .foo on an `any` value. [typescript-eslint(no-unsafe-member-access)]
    foo
```

The bracketed error code is the raw oxlint `code` field in `plugin(rule)` form (e.g. `eslint(no-debugger)`, `typescript-eslint(no-floating-promises)`, `typescript(TS2591)`).
For oxc parser errors, which carry no rule code, the placeholder `parse-error` appears in the brackets instead.

Under `--unix`, stdout carries oxlint's `--format=unix` lines (one per diagnostic).
The wrapper does not inject the issue-count summary or the weak-typings hint, and reroutes oxlint's `No files found to lint.` line to stderr so stdout stays clean.

## Type-aware linting

Type-aware linting is always on.  
`lint-js` runs `oxlint --type-aware --type-check` with `oxlint-tsgolint` bundled.  
`tsconfig.json` is auto-detected per file; sub-directory tsconfigs are respected.

Strict rules including `no-floating-promises` and `no-unsafe-*` are enforced.  
See [docs/guide/weak-typings.md](docs/guide/weak-typings.md) for escape hatches.

Test files (`**/*.test.{js,ts}`) relax the `no-unsafe-*` family to accommodate mocks, fixtures, and boundary I/O.

## Notes

Rule config is currently fixed and not per-project configurable.
