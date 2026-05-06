---
date: 2026-05-06
---

# Lint primary, format as silent auxiliary

## Context and Problem Statement

Per ADR-0005, default mode runs `oxfmt` twice when it succeeds. A co-equal presentation would flank the lint phase with two format banners and two blocks of formatter output, forcing the consumer to skim past chatter to reach the actionable signal.

The existing `--unix` flag is shaped for lint output (VS Code terminal link detection) and has no formatter equivalent. Format output has never been a channel consumers act on.

## Considered Options

- Co-equal phases, surfacing both outputs uniformly.
- Lint primary, format silent on success.

## Decision Outcome

Chosen option: **lint primary, format silent on success**. The CLI suppresses all `oxfmt` output on exit 0 (no banner, no relayed text); only formatter failures surface. The rule applies in any mode, including `--format-only`.

### Consequences

- Good, because the visible log is dominated by lint output, matching what consumers act on.
- Good, because the log-noise cost called out in ADR-0005 becomes invisible.
