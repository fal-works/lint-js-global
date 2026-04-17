# @fal-works/lint-js-global

Runs Oxfmt and Oxlint (+ auto-fix).

Intended as a globally-installed alternative to adding linter devDependencies to every small project.


## Install

```sh
pnpm install -g @fal-works/lint-js-global
```


## Usage

Run from a project root (requires `package.json`):

```sh
lint-js [--check] [path...]
```

### Options

`--check` verifies formatting and lint without rewriting files.

### Target Paths

Paths are optional; without them the whole project is processed.  
Each path must be an existing file or directory.

`node_modules` is always skipped.  
Standard ignore files (`.gitignore`, `.eslintignore`, `.prettierignore`) are respected if present.


## Notes

Type-aware linting is always on.  
Strict rules including `no-floating-promises` and `no-unsafe-*` are enforced.  
See [docs/type-aware-linting.md](docs/type-aware-linting.md) for rule list and escape hatches.

Rule config is currently fixed and not per-project configurable.
