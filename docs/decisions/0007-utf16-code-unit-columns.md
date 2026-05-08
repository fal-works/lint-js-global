---
date: 2026-05-08
---

# UTF-16 code unit columns for diagnostics

## Context and Problem Statement

The wrapper needs to choose what unit `C` in a diagnostic's `L:C` is counted in.
The candidates coincide on ASCII and diverge on multibyte input.

## Considered Options

- Byte column, native to `oxlint` spans.
- UTF-16 code unit column, used by ESLint, the LSP default, and VS Code terminal links.
- Unicode code-point column, matching "what character" intuition.

## Decision Outcome

Chosen option: **UTF-16 code unit column**, because it aligns with ecosystem conventions and can be used directly as a JS string index.
