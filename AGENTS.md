# Repository Guide

## Overview

`@fal-works/lint-js-global` is a globally-installed CLI wrapping `oxfmt` and `oxlint --type-aware` (with `oxlint-tsgolint` bundled).
Ships a strict, fixed rule config.
Targets small JS/TS projects and LLM coding agents that iterate lint+fix autonomously.

## Layout

- `src/`: source, with co-located `*.test.ts`.
- `test/cli/`: CLI integration tests.
- `cfg/`: shipped lint/format rule config.
- `docs/decisions/`: ADRs with design rationale.
- `tmp/`: gitignored scratch dir for agent output (notes, intermediate results). Use this instead of `$TMPDIR` so the user can inspect it.

## Toolchain

Node >= 22.18.0, pnpm, TypeScript >= 6.

## Commands

- `pnpm lint`: dogfoods the CLI on this repo.
- `pnpm test`: runs `node --test`.
- `pnpm build`: runs `tsc`.
