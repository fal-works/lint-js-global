---
date: 2026-04-29
---

# Span text in diagnostics, not surrounding lines

## Context and Problem Statement

The wrapper formats oxlint diagnostics for an LLM consumer that issues `Read` against the cited file when more context is needed.
How much source context should each diagnostic carry inline?

## Considered Options

- Span text only: the exact source range the rule points to, truncated at 40 code points.
- ±N surrounding lines (rustc-style caret block, or Aider-style enclosing-scope expansion).
- Location only, with no source text.

## Decision Outcome

Chosen option: **span text only**, because recent work on coding agents and LLM-based program repair consistently finds that precise, minimal local context is more useful than large, noisy snippets, and that additional context is best fetched on demand.

## More Information

Related work:

- **ContextBench: A Benchmark for Context Retrieval in Coding Agents**  
  When coding agents fetch their own code context, they tend to favor recall over precision, and a substantial portion of the explored context goes unused by the time the model produces its answer.  
  https://arxiv.org/abs/2602.05892

- **On the Role of Fault Localization Context for LLM-Based Program Repair**  
  Systematic experiments on file-, element-, and line-level context show that correct file-level localization is the main driver of repair performance, while aggressive line-level expansion often introduces noise that can degrade results, arguing against blanket ±N-line snippets.  
  https://arxiv.org/abs/2604.05481

- **EDIT-Bench: Evaluating LLM Abilities to Perform Real-World Instructed Code Edits**  
  In LLM-based code editing, explicitly indicating the relevant code span is the dominant positive contextual factor for task success, while supplementary signals such as cursor position contribute only inconsistently.  
  https://arxiv.org/abs/2511.04486

- **Effective Context Engineering for AI Agents (Anthropic, 2025)**  
  This practitioner guide emphasizes that including too many irrelevant tokens in an agent’s prompt can hurt both quality and efficiency, and recommends small, carefully curated contexts with additional details fetched from external sources only when needed.  
  https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
