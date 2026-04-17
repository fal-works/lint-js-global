# Introduction

## Overview

`@fal-works/lint-js-global` is a globally-installed CLI wrapping `oxfmt` and `oxlint --type-aware` (with `oxlint-tsgolint` bundled).
Ships a strict, opinionated rule config in `cfg/`, currently fixed and not per-project configurable.
Small JS/TS projects use it in place of their own linter devDependencies.

## Development

Node >= 22, pnpm.
CLI lives in a single file at `src/cli.js`.
Smoke tests in `test/`.
`pnpm lint` dogfoods the CLI on this repo.
