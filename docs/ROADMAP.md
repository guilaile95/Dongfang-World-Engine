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

## Step 2.6 — Epistemic Claims Hardening

Status: complete.

Separate non-authoritative epistemic propositions from objective Truth before any model or context integration:

- add persisted `Claim` records that may exist without a matching `Fact`;
- refactor `CharacterKnowledge` to reference `claim_id`, never `fact_id`;
- replace `character.learn_fact` with `character.learn_claim` and add narrowly-scoped `claim.record`;
- keep character/event provenance, same-World validation, non-future checks, and exact-state propagation;
- require Event provenance from `character.learn_claim` to preserve its payload `knowledgeState`, and validate Seed inputs deterministically before writing;
- preserve Seed provenance for objective Facts, Claims, and initial CharacterKnowledge;
- ensure Claim replay/rebuild never creates objective Facts and unrelated `fact.assert` Events cannot grant Claim knowledge;
- preserve Step 2/2.5 revision, identity, policy, rollback, append-only, and mixed-candidate coverage.

Step 2.6 deliberately does not include automatic Claim truth resolution, inference, deception, trust scoring, dialogue, Context Builder, LLM, Memory, RAG, Narrative, UI, Branch, Save, Session, or World Pack loading.

## Step 2.6.1 — Seed Referential Integrity

Status: complete.

Complete the Seed boundary before Context Builder by validating Character locations, Location parents, Fact/Claim subjects, and Relationship Event provenance deterministically within one Seed World. Rejected Seed inputs return `SEED_INVALID` before any write and leave no partial state.

## Step 3 — LLM Candidate Generation

After Step 2 is proven, connect one model only to translate player input into Candidate Events. The model still has no direct write authority.

## Later

Narrator, Lore retrieval, long-term Memory, choice branching, desktop UI, multiple worlds and advanced simulation are deliberately deferred until the core authority chain is stable.
