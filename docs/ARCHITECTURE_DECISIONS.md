# Architecture Decisions

This file records high-impact architectural decisions that should not drift silently during implementation.

## ADR-001 — Database is Truth

Committed world state is authoritative. LLM output, narrative text, summaries and memory are not allowed to overwrite truth directly.

## ADR-002 — Events Explain State

Important state transitions must be traceable to append-only Events. Materialized State exists for efficient reads, not as an unrelated second truth source.

## ADR-003 — Character Knowledge Is Separate from Fact

Objective truth and what each character knows are modeled separately. Context assembly must enforce that boundary in code.

## ADR-004 — LLM Has No Direct Write Authority

Models may propose Candidate Events. Deterministic validation and transactional commit decide whether world state changes.

## ADR-005 — Narrative Is a Projection

Narrative is generated from already-confirmed state and events. The engine does not infer authoritative state back from prose.

## ADR-006 — World Packs Are Decoupled from Engine

The core engine must not depend on a specific fictional IP. Third-party world content remains user-supplied/local unless redistribution rights are clear.
