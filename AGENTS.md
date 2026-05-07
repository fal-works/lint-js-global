# Introduction

## Overview

`@fal-works/lint-js-global` is a globally-installed CLI wrapping `oxfmt` and `oxlint --type-aware` (with `oxlint-tsgolint` bundled).
Ships a strict, opinionated rule config in `cfg/`, currently fixed and not per-project configurable.
Small JS/TS projects use it in place of their own linter devDependencies.
Also aims to support LLM coding agents that iterate lint+fix autonomously while working.

## Development

Node >= 22.18.0, pnpm.
Source files in `src/`, tests in `test/`, both in TypeScript >= 6.
Internal import specifiers use `.ts` extensions.
`pnpm lint` dogfoods the CLI on this repo.
Design rationale lives as ADRs in `docs/decisions/`.

## Temporary files

Write agent scratch output (investigation notes, intermediate results, etc.) to `tmp/` under the project root instead of `$TMPDIR`, so the user can inspect it. `tmp/` is gitignored.
