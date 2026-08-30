---
name: explain-itest
description: Explain iTestAgent code, architecture decisions, contracts, or design patterns using the repository's authoritative documentation.
---

# Explain iTestAgent

1. Identify whether the input is a concept, file, code fragment, run artifact, or ADR.
2. Read the supplied file or code context when applicable.
3. Trace the topic to the narrowest authoritative source:
   - user behavior and AC: `docs/01-spec/`;
   - architecture and component boundaries: `docs/02-architecture/`;
   - data contracts: the data-flow source linked from `docs/INDEX.md`;
   - risk controls: `docs/03-implementation/` and `AGENTS.md`;
   - historical decisions: `docs/decisions/`;
   - verification claims: `docs/06-verification/`.
4. Quote relevant AC or constraints verbatim before interpreting them.
5. Explain why the design exists, how the current implementation realizes it, and its immediate upstream/downstream effects.
6. Distinguish documented facts, code-observed behavior, verification evidence, and inference. Mark unsupported conclusions as inconclusive.
7. Do not modify files unless the user separately asks for a change.
