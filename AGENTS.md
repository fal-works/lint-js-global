# Repository Guide

## Overview

`@fal-works/lint-js-global` is a globally-installed CLI wrapping `oxfmt` and `oxlint --type-aware` (with `oxlint-tsgolint` bundled).
Ships a strict, fixed rule config.
Targets small JS/TS projects and LLM coding agents that iterate lint+fix autonomously.

## Design stance

Prefer simple, bold designs over defensive, conservative ones.

## Layout

- `src/`: source, with co-located `*.test.ts`.
- `test/`: integration and smoke tests.
- `cfg/`: shipped lint/format rule config.
- `docs/decisions/`: ADRs with design rationale.
- `docs/guide/`: shipped end-user guide.
- `tmp/`: gitignored scratch dir for agent output (notes, intermediate results). Use this instead of `$TMPDIR` so the user can inspect it.

## Toolchain

Node >= 22.18.0, pnpm, TypeScript >= 6.

## Commands

- `pnpm lint`: dogfoods the CLI on this repo.
- `pnpm test`: runs `node --test`.
- `pnpm build`: runs `tsc`.
- `pnpm smoke:publish`: smokes the packed layout.
