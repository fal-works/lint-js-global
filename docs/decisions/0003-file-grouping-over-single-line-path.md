---
date: 2026-04-29
---

# File grouping over single-line path:L:C

## Context and Problem Statement

Each diagnostic could be emitted as a self-contained line of the form `path:L:C: rule message`, enabling VS Code terminal link detection.
Or diagnostics could be grouped under a per-file heading with the path written once and `L:C` carried in the body.
Which is the right default when the primary consumer is a coding agent iterating lint plus fix?

## Considered Options

- File grouping: per-file heading, `L:C` in the body.
- Single-line `path:L:C: ...` per diagnostic.

## Decision Outcome

Chosen option: **file grouping**, because repair work batches naturally per file (one `Read`, multiple `Edit`s), so the grouped layout matches the agent's working unit and removes path duplication from a payload that is reread on every loop iteration.
The grouped layout also matches [ESLint's default formatter](https://eslint.org/docs/latest/use/formatters/#stylish), the de facto shape of JavaScript lint output, so LLMs encounter it as a familiar layout rather than a novel one to be parsed from scratch.

The single-line format's main benefit (VS Code link click-through for humans) is preserved through the `--unix` flag.
