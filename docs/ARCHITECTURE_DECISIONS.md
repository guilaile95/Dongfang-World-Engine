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

## ADR-007 — Chat-first Surface, Authority-first Consequences

The product surface is freeform roleplay chat. Engine schemas constrain which consequences may become authoritative persistent state; they do not constrain what the Player may naturally say, attempt, ask, feel or do in a scene.

**Engine constrains consequences, not imagination.**

A model must not substitute an unrelated legal persistent action merely because the Player message cannot be represented by the current effect primitives. Uncertainty fails toward no persistent effect or clarification.

## ADR-008 — Scene Interpretation Precedes Persistent Effect Commit

Open-ended Player input is resolved at a non-authoritative Scene layer before persistence. The Scene layer separates:

- ordinary / ephemeral scene beats;
- targeted utterances or immediate stimuli;
- persistent effect candidates;
- unsupported material intent or clarification.

Only future-causal effects enter the existing Candidate → Hard Validator → Transaction → Event → Projection chain. This decision does not authorize inferring committed state back from unconstrained final prose.

## ADR-009 — Ephemeral Scene Success Is Not an Empty Failure

A low-causal action may succeed in the current scene without creating an Event or Materialized State change. Eating an ordinary meal, sitting, resting briefly or looking out a window do not require dedicated persistent primitives unless the world is tracking a future-causal resource, status, location or obligation.

The ephemeral path must not claim completion of material effects such as death, important item transfer, tracked resource consumption, location change, permission change, relationship change or Knowledge acquisition.

## ADR-010 — Targeted Interaction Uses the Target's Visibility Boundary

A Player utterance or question addressed to an NPC is distinct from `claim.transmit`. The target NPC may respond only after receiving the authorized current stimulus together with that NPC's own Context. Unrelated characters must not receive private speech, and the Player's private Context is never copied to the target.

Interaction detail is persisted only when it has future causal value; persistence never grants Truth authority.

## ADR-011 — Context Continuity Is Core but Non-authoritative

Long-form roleplay requires layered continuity beyond current Materialized State. The runtime may use recent resolved scene history, stable story essentials, relevant episodic memories and rolling summaries after the deterministic Visibility Gate.

Memory, summaries and retrieval are context aids, not Truth. They must remain inspectable, correctable or rebuildable and cannot overwrite Fact, Claim, CharacterKnowledge or committed Event history.
