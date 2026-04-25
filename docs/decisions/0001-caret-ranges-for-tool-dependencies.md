---
date: 2026-04-26
---

# Caret ranges for oxfmt/oxlint dependencies

## Context and Problem Statement

This wrapper is tightly coupled to `oxfmt`/`oxlint` output shapes and to `oxlint-tsgolint`'s sidecar contract, so an upstream release can break it.
Pin exactly, or use caret ranges?

## Considered Options

- Caret ranges
- Exact pins

## Decision Outcome

Chosen option: **caret ranges**, because for an experimental/personal wrapper, automatic uptake of upstream fixes and new rules outweighs the cost of occasional breakage.
