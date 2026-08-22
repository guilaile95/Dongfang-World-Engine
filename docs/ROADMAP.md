# Roadmap

## Step 1 — Architecture Baseline

Status: complete.

- README project positioning;
- World Engine Constitution;
- conceptual data model;
- authority boundaries for Truth / Event / Knowledge / Memory / Narrative.

## Step 2 — World Engine Commit Kernel

Current focus.

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

## Step 3 — LLM Candidate Generation

After Step 2 is proven, connect one model only to translate player input into Candidate Events. The model still has no direct write authority.

## Later

Narrator, Lore retrieval, long-term Memory, choice branching, desktop UI, multiple worlds and advanced simulation are deliberately deferred until the core authority chain is stable.
