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

The current directory must contain `package.json`, as a guard against running without target paths in a wide location such as `~/`.
Target paths themselves may point anywhere; without them the whole project is processed.

### Options

- `--check` verifies without rewriting files.
- `--format-only` runs only the format phase.
- `--lint-only` runs only the lint phase.
- `--unix` emits one diagnostic per line on stdout (`<file>:<line>:<col>: <message> [<code>]`), for tools that consume that form.

`--format-only` and `--lint-only` are mutually exclusive.

### Output

stdout carries lint findings only, so it can be piped into another tool without further filtering.
Auxiliary text (issue-count summary, final status line, formatter failures) goes to stderr.

```
src/index.ts
  1:7 Unsafe assignment of an `any` value. [typescript-eslint(no-unsafe-assignment)]
    data = JSON.parse("{}")
  2:18 Unsafe member access .foo on an `any` value. [typescript-eslint(no-unsafe-member-access)]
    foo
```
