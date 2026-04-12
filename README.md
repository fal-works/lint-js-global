# @fal-works/lint-js-global

Runs Oxfmt and Oxlint (+ auto-fix).
Intended as a globally-installed alternative to adding linter devDependencies to every small project.

## Usage

Install:

```sh
pnpm install -g @fal-works/lint-js-global
```

Then run from a project root (requires `package.json`):

```sh
lint-js
```

`node_modules` is skipped automatically, even if the project does not define `.gitignore` / `.eslintignore`.

## Notes

Not yet implemented: `--check` flag, per-project config override, subcommands, type-aware linting.
