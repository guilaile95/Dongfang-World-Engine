# Roadmap

## Step 1 — Architecture Baseline

Status: complete.

- README project positioning;
- World Engine Constitution;
- conceptual data model;
- authority boundaries for Truth / Event / Knowledge / Memory / Narrative.

## Step 2 — World Engine Commit Kernel

Status: complete.

Implement a deterministic, LLM-free core loop:

```text
Candidate Event
→ Hard Validator
→ Transactional Commit
→ Append-only Event Log
→ Projector
→ Materialized State
```

Exit criteria:

- unified Candidate Event schema;
- deterministic Hard Validator;
- transactional Commit with rollback;
- append-only Event semantics;
- CharacterKnowledge isolated from Fact;
- directional Relationship model;
- key state rebuildable from Event Log;
- 50–100 mixed valid/invalid candidate tests pass;
- typecheck/test/build pass.

## Step 2.5 — Kernel Hardening

Status: complete.

Focused hardening of the Step 2 authority chain, without introducing any narrative or model integration:

- per-World `revision` with `expectedWorldRevision` and deterministic `STALE_WORLD_STATE` rejection;
- Event `sequence` and per-World `worldRevision` exposed by commit and read APIs;
- deterministic per-World `PredicatePolicy` with conservative `one` default and explicit `many` support;
- auditable Seed identity for initial Fact and CharacterKnowledge provenance;
- structured Knowledge provenance with MVP state enum and exact-state character propagation;
- rollback, stale candidate, same-time identity, replay, policy, Seed provenance and knowledge authorization tests;
- GitHub Actions verification on pull requests and pushes to `main`.

Step 2.5 deliberately does not include Context Builder, LLM, Memory, RAG, Narrative, UI, Branch, Save, Session, world-pack loading, or distributed concurrency.

## Step 3 — LLM Candidate Generation

After Step 2 is proven, connect one model only to translate player input into Candidate Events. The model still has no direct write authority.

## Later

Narrator, Lore retrieval, long-term Memory, choice branching, desktop UI, multiple worlds and advanced simulation are deliberately deferred until the core authority chain is stable.
