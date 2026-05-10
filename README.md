# @fal-works/lint-js-global

Runs [Oxfmt](https://oxc.rs/docs/guide/usage/formatter.html) and [Oxlint](https://oxc.rs/docs/guide/usage/linter.html) (+ auto-fix).

Intended as a globally-installed alternative to adding linter devDependencies to every small project.

## Highlights

- Bundles `oxfmt`, `oxlint`, and `oxlint-tsgolint` (type-aware) with a strict shipped ruleset; no per-project config.
- Pipe-friendly streams: per-file lint findings on stdout, everything else on stderr.
- Diagnostics tuned for LLM coding agents:
    - Source slice inline per finding.
    - Per-file grouping resembling ESLint stylish.
    - `L:C` columns in UTF-16 code units (matches ESLint, LSP, VS Code, and JS string indices).
    - `no-unsafe-*` findings carry a remediation hint.

## Install

```sh
pnpm install -g @fal-works/lint-js-global
```

## Usage

Run from a project root:

```sh
lint-js [--check] [--format-only | --lint-only] [--unix] [path...]
```

The current directory must contain `package.json`, as a guard against running without target paths in a wide location such as `~/`.  
Target paths themselves may point anywhere; without them the whole project is processed.

### Options

- `--check` verifies without rewriting files.
- `--format-only` runs only the format phase.
- `--lint-only` runs only the lint phase.
- `--unix` emits one diagnostic per line (`<file>:<line>:<col>: <message> [<code>]`), for tools that consume that form.

`--format-only` and `--lint-only` are mutually exclusive.

### Exit codes

- `0`: success; no unfixed findings remain.
- `1`: unfixed fmt/lint findings were reported.
- `2`: lint-js itself failed (e.g. invalid arguments, missing `package.json`, or tool launch failure).

## Example (stdout)

```
src/index.ts
  1:7 Unsafe assignment of an any value. [typescript(no-unsafe-assignment)]
    data = JSON.parse("{}")
  2:18 Unsafe member access .foo on an `any` value. [typescript(no-unsafe-member-access)]
    foo
```
