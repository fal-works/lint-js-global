---
date: 2026-05-10
---

# Fold `help` for project diagnostics, discard it for file diagnostics

## Context and Problem Statement

`oxlint` emits an optional `help` field alongside `message` for many diagnostics.
The wrapper has to decide whether to surface it, and whether the choice should be uniform across diagnostic kinds.

## Considered Options

- Discard `help` uniformly.
- Surface `help` uniformly.
- Surface `help` only for project-level diagnostics.

## Decision Outcome

Chosen option: **surface `help` only for project-level diagnostics**, folded into the displayed message.

File-level diagnostics drop `help`: the source span and rule code already pin the offending code, and `help` is non-actionable for some rules.
For instance, `typescript(unbound-method)` emits:

> If your function does not access `this`, you can annotate it with `this: void`, or consider using an arrow function instead.

Both suggestions target the method's declaration site, so neither is reachable when the unbound method comes from a third-party library.

Project-level diagnostics fold `help` because they carry no span and `message` is often only a headline.
For instance, `typescript(tsconfig-error)` emits `message: "Invalid tsconfig"` with:

> Cannot find type definition file for 'node'.

Without `help`, the consumer cannot identify the cause.

### Consequences

- Good, because project-level diagnostics gain the actionable cause and file-level diagnostics stay free of out-of-scope advice.
- Bad, because the asymmetry is policy a maintainer has to learn.
