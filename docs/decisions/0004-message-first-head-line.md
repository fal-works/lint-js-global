---
date: 2026-05-02
---

# Message-first head line, slice on continuation

## Context and Problem Statement

ADR-0002 fixed that each diagnostic carries the source-code slice the rule points at, and ADR-0003 fixed grouping under a per-file heading.
Within a group, each diagnostic still has four atomic elements to lay out: location (`L:C`), message (prose), rule code (`plugin(rule)` form, with `parse-error` as a placeholder for oxc parser errors), and source slice.
Location and rule code are short and bounded; message and slice are both unbounded.
What shape should one diagnostic take?

## Considered Options

- Two-line: head `L:C <message> [code]`, continuation `<slice>`.
- Two-line: head `L:C <slice> [code]`, continuation `<message>`.
- Single line carrying all four elements.
- One element per indented line.

## Decision Outcome

Chosen option: **two lines, message in the head, slice on the continuation**, because the head-line ordering follows ESLint's stylish formatter (location, then message, then rule), the de facto JavaScript-lint shape (same reasoning as ADR-0003).

### Consequences

- Good, because the head line matches what an LLM trained on ESLint-style logs already expects, so no fixed legend block is needed to explain what the text after `L:C` means.
- Good, because no preamble is reprinted on every invocation and reread by an iterating agent each loop.
- Bad, because the source slice (the most uniquely informative element) sits on the continuation rather than the head line.
