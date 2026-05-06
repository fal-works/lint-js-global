---
date: 2026-05-06
---

# Format around lint

## Context and Problem Statement

Two single-pass orderings of `oxfmt` and `oxlint` each have a real cost:

- Format first, then lint: `oxlint --fix` can rewrite code in ways `oxfmt` would normalize differently, leaving the file lint-clean but not format-clean.
- Lint first, then format: `oxfmt` shifts line and column offsets after lint has reported them, so every `L:C` in the lint output may point at the wrong line in the file the consumer actually reads.

## Considered Options

- Format first, then lint.
- Lint first, then format.
- Format around lint (`oxfmt` → `oxlint` → `oxfmt`).

## Decision Outcome

Chosen option: **format around lint**, because it gives both location accuracy and a strict success contract: lint sees a format-stable file, and the trailing pass normalizes any auto-fix drift.

`--check` runs only the leading pass; lint applies no fixes there.

### Consequences

- Good, because lint `L:C` locations always reference the file the consumer opens next.
- Good, because exit 0 strictly means lint-clean and format-clean.
- Bad, because format runs twice in default mode. The runtime cost is negligible; the log-noise cost is addressed in ADR-0006.
