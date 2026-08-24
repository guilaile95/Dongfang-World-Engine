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

## Step 3 — Context Builder MVP

Status: complete.

Add the first read-only vertical-slice boundary on top of the completed Foundation:

- observer-specific deterministic visibility filtering;
- structured World envelope, self state, current Location, safe co-located Character projection, observer-directed Relationships;
- Claim + CharacterKnowledge + minimal Event/Seed provenance bundles;
- objective Fact / other-character Knowledge isolation;
- configurable deterministic unit budget applied only after visibility filtering;
- no Event append, State mutation, World revision change, LLM, Memory, RAG, or UI.

## Step 4 — Simulation Adapter MVP

Status: complete.

Add the first non-authoritative model boundary on top of the completed Context Builder:

- accept only an already-filtered `CharacterContext`, matching actor identity, and intent;
- inject one narrow model client/transport boundary;
- validate 0..N ordered proposal drafts against the six-type actor Candidate surface;
- publish the provider-agnostic top-level Proposal contract, exact six-type fields, actor ownership, and forbidden authority fields;
- provide one bounded actionable repair summary and preserve the final sanitized validation reason;
- keep Kernel-only capabilities such as `fact.assert` unavailable to actor proposals until a deterministic authority contract exists;
- keep Event envelope/provenance (`occurredAt`, `causeEventIds`) and revision binding outside model output;
- reject model-controlled `worldId` / `expectedWorldRevision` metadata;
- allow at most one repair retry for malformed output;
- surface transport errors deterministically without writing World state or executing proposals.

## Step 5 — Turn Orchestrator / Candidate Commit Binding

Status: complete.

Build the first authoritative runtime bridge on top of the Context Builder and hardened Simulation Adapter:

- Orchestrator constructs `CharacterContext` from `worldId + actorCharacterId + intent` instead of accepting an arbitrary execution Context;
- model Proposals remain non-authoritative and cannot provide Event envelope fields;
- the complete Proposal plan is schema/actor-authority prevalidated before the first Commit;
- a small configurable per-turn Proposal execution cap rejects oversized plans with zero writes;
- Orchestrator binds trusted `worldId`, `expectedWorldRevision`, authoritative `occurredAt`, and conservative `causeEventIds = []`;
- every write goes through the existing Commit Kernel;
- ordered Proposal execution chains the revision returned by the previous successful Commit;
- `world.time_advance` advances time, and later Proposal timestamps use the resulting authoritative World time;
- zero/complete/rejected/partial/stale Turn results preserve committed-prefix semantics;
- before any turn Event commits, stale Context may trigger at most one rebuild and re-simulation;
- after a committed prefix, stale or Kernel rejection stops the turn without re-simulation, rollback, or automatic `action.failed` Event;
- actor Proposal execution keeps `fact.assert` unavailable.

Step 5 deliberately does not include a real LLM Provider, Narrator, NPC Scheduler, Memory/RAG, new Event types, or UI.

## Step 6 — Minimal Real-Model Transport and Headless Smoke

Status: complete.

Add the first narrow real-model connectivity proof without changing authority:

- implement one OpenAI-compatible Chat Completions `SimulationModelClient` using native `fetch`;
- map only existing model instructions, filtered CharacterContext and intent into the request;
- return only assistant content to the existing Simulation Adapter;
- keep JSON/Zod validation, one repair attempt, actor Proposal restrictions, Orchestrator binding and Kernel Commit unchanged;
- surface HTTP, network, timeout and malformed provider responses without provider fallback or retry chains;
- add fake-fetch HTTP and one-turn end-to-end tests with no real credentials;
- add an opt-in `npm run smoke:real-model` using an in-memory test World and the normal Context Builder → Simulation Adapter → Turn Orchestrator → Commit Kernel path;
- keep GitHub Actions credential-free and real-model/API independent.

Step 6 deliberately does not include Narrator, Scheduler, Item, Memory/RAG, provider framework, fallback chain, complex retry, UI, or production deployment.

## Step 7 — Minimal Narrator and Narrated Smoke

Status: complete.

Add the first player-facing projection without creating a second authority path:

- rebuild the same observer-scoped `CharacterContext` after Turn execution;
- build a deterministic `NarrativeEnvelope` from the rebuilt Context and `TurnResult`, never from raw `TurnResult.state`;
- project only an explicit allowlist of committed actor outcomes;
- expose only safe rejection `kind/code`, not internal diagnostics or Event provenance;
- inject one narrow `NarrativeModelClient` boundary using the existing OpenAI-compatible chat transport;
- keep Narrator input free of raw WorldSnapshot, Store, CommitKernel, general Facts and other-character private Knowledge;
- validate only non-empty, bounded plain text; do not add a second LLM critic;
- keep narrative text out of authoritative World tables;
- add fake HTTP narrated end-to-end coverage and an opt-in real narrated smoke, without real-model CI.

Step 7 deliberately does not include Item, the closed-inn fixture, NPC Scheduler, Memory/RAG, lore retrieval, branching/save, UI, provider framework, or multi-agent execution.

## Vertical Slice 0 — Closed Inn 10-turn Causal Loop Proof

Status: complete.

Prove the first actual multi-character causal loop in a closed scene with deterministic information transmission:

- create Closed Inn fixture: Player, NPC-A, NPC-B, NPC-C, missing dagger mystery, hidden Truth Fact, true/false Claims, and differentiated initial CharacterKnowledge;
- implement minimal source-authored `claim.transmit` Candidate Event with co-location check, source Knowledge validation, exact knowledge state replication, and deterministic Event provenance;
- support `claim.transmit` proposal in Simulation Adapter and Turn Orchestrator with actor ownership enforcement;
- add headless 10-turn test harness (`closed-inn-harness.ts`) driving deterministic sequence across actors without building a general Scheduler;
- verify all 9 hard assertions: zero Truth leaks, zero unauthorized knowledge leaks, no direct Truth writes, explainable provenance, and 100% replay/rebuild consistency.

Vertical Slice 0 deliberately does not include Item/inventory framework, dialogue framework, generic interaction layer, NPC Scheduler, Memory/RAG, belief transition lattice, UI, or distributed platform.

## Vertical Slice 3 — Hand-authored Canon Divergence Micro-Slice

Status: complete.

Prove that canon is a causal baseline rather than an immutable script, using one purpose-built deterministic fixture:

- persist one Seed-static exact `FactAssertionRequirement` relation inside World authority state;
- evaluate all matching requirements at `fact.assert.validFrom` with half-open Fact intervals;
- keep zero-row behavior unchanged and use AND semantics for multiple requirements;
- prove control `A → B → C` and independent `D`;
- prove Player-attributed `B'` closes `B`, then a direct old-`C` Candidate is rejected with zero partial state while `D` still commits;
- reject a later-committed retroactive `B'` when its projected close time would make an already committed `C` lose `B` at `C.validFrom`, while preserving unrelated historical replacements and replacements after the dependent assertion time;
- preserve the static authority relation in `WorldSnapshot` and full canonical replay comparison;
- keep Candidate/Event schemas, actor Proposal capabilities and cause provenance semantics unchanged.

The post-Slice audit confirmed that canonical replay consistency alone cannot prove causal legality: replay could faithfully reproduce a state where a retroactive cardinality-one close had invalidated a committed Fact prerequisite. The Validator therefore rejects that direct invalidation before append/projection, including a replacement that would invalidate its own prerequisite. It does not automatically delete, retract or recompute downstream Facts.

Vertical Slice 3 deliberately does not include a generic Canon/Rule/Timeline Engine, automatic consequence scheduling, recursive inference, truth maintenance, Branch/Multiverse, World Pack Compiler, Dialogue, Scheduler, Memory/RAG, UI, or real-model execution.

## Vertical Slice 3.1 — Trusted Authored Consequence Binding

Status: complete.

Close the smallest integration gap between a non-authoritative actor action and a trusted canon consequence:

- run the Player turn through the existing Context Builder → Simulation Adapter → Turn Orchestrator path;
- keep `fact.assert` unavailable to actor proposals;
- bind only the Store-confirmed current-Head Player move to the declared intervention Location;
- let one scenario-local trusted producer submit B′ through CommitKernel with the move Event as cause;
- prove raw intent, empty/malformed output, missing Events, another actor and another destination cannot trigger B′;
- prove control C succeeds, intervention old C is directly rejected without partial state, independent D continues, and both runs are canonical-replay consistent;
- return only a safe result projection without raw Context, Snapshot, prompt, model response, hidden Fact or requirement data.

Vertical Slice 3.1 deliberately does not add a generic Action/Effect Resolver, trigger DSL, Canon/Rule/Timeline Engine, Scheduler, new Candidate/Event type, actor Fact authority, Narrator redesign, real-model formal sample, or UI.

## Vertical Slice 3.2 — One Frozen Real-model Canon Divergence Action Sample

Status: complete.

- add one opt-in entrypoint around the existing 3.1 harness and OpenAI-compatible Simulation client;
- freeze the directed Player intent and one-sample/no-reroll protocol;
- emit only execution mode, formal-sample marker, model id, provider-call count and the existing safe harness result;
- redact configured credentials from bounded errors;
- prove the HTTP path with injected fake fetch, mark it non-formal, and keep CI credential-free;
- execute the formal provider sample only after merge on exact main, if all three required credentials are present.

The frozen formal sample was executed exactly once from main `0c4efff7e45ecd2f507a8034dccdf165a44b2f8a`: one provider call, zero repair calls and no reroll. The real model selected the legal Player `character.move`; the trusted producer committed B′ through CommitKernel, the exact old C attempt was rejected with `FACT_PRECONDITION_FAILED` without partial state, independent D committed, and the final revision and committed Event count were both 4 with full canonical replay consistency. No new P0/P1 was observed.

Vertical Slice 3.2 deliberately does not add Narrator, provider routing/fallback, new retry behavior, provider-specific structured output, actor Fact authority, generic rules, Scheduler, Dialogue, Memory/RAG or UI. The successful sample does not by itself justify any of those deferred systems; a later Slice requires a new player-perceivable question or an observed runtime failure.

## Vertical Slice 3.3 — Player-legible Canon Consequence

Status: complete.

- after and only after trusted B′ commits, record one scenario-authored Claim whose proposition mirrors the Player-observable route consequence;
- attribute the Claim observation to the Player whose committed move was the exact trusted trigger, and cause the Claim Event from B′;
- commit one `character.learn_claim = confirmed` through CommitKernel using that matching Claim Event as structured provenance;
- expose the resulting Claim / CharacterKnowledge / acquisition provenance through the unchanged Context Builder and NarrativeEnvelope paths;
- prove other characters do not receive the Claim, objective Facts and requirements remain hidden, Narration is read-only, old C still rejects atomically, D continues, and full canonical replay remains consistent.

Vertical Slice 3.3 deliberately does not add a new Event or Candidate, generic observation/perception framework, Dialogue or durable utterance system, Context/Narrator Fact access, generic consequence engine, Scheduler, Memory/RAG, UI or another real-model invocation.

## Vertical Slice 3.4 — One Frozen Real-Narrator Canon Consequence Sample

Status: complete.

- add one opt-in runner that uses deterministic local Simulation and the unchanged 3.3 Canon/Knowledge path;
- require B′, confirmed Player Knowledge, old-C atomic rejection and canonical replay before any Narrator request;
- permit exactly one Narrator provider attempt, fail closed on redirects, never retry, and preserve an auditable consumed-sample receipt for success, transport uncertainty, invalid output or redaction;
- allow formal classification only from a direct, clean, no-preload CLI on exact `origin/main`, recording the verified SHA;
- redact configured secrets and provider echoes of request, system instruction or observer envelope;
- execute one formal sample from main `6f64c9aaed20bef984c6b55f0557a8eec9765814`: one Narrator call, zero Simulation provider calls, no reroll, Hard Gate PASS, revision/Event count `6/6`, and full canonical replay consistent;
- classify player legibility as **NO**: the safe narrative rendered `watch_route = west_tower` ambiguously as surveillance and did not clearly name the Gate Captain, the route change or the Player-caused consequence.

The consumed sample is not rerun or tuned. Issue #47 closes the observed Behavioral P2 with one optional, observer-and-Claim-scoped `displayText` added only after CharacterKnowledge visibility filtering. Raw Claim identity and KnowledgeState remain intact; no Character/Location metadata is auto-resolved, and Kernel, Validator, Projector, Fact/Claim authority and Narrator write boundaries remain unchanged.

## Product Stage — Playable Local Loop

Status: complete in Issue #49.

- add `npm run play` as the first Player-oriented runtime entrypoint, using natural-language intent and the existing Context Builder → Simulation Adapter → Turn Orchestrator → CommitKernel path;
- open or seed one authoritative file-backed Closed Inn SQLite World and resume its revision, Event Log, Character state, Claims, Knowledge and Relationships after process exit;
- run one scenario-local NPC/time continuation after each Player interaction without a generic Scheduler or direct database write;
- bind a Player Claim transmission to a later NPC relationship reaction, then expose the observed consequence through Claim/Knowledge provenance and #47 `displayText` without Fact/private-Knowledge access;
- verify the actual entrypoint across two processes and 25 Player interactions (10 + exit + resume + 15), with continuous revisions, delayed causality, safe Narrator envelopes and canonical replay equality.

The acceptance run uses a credential-free loopback OpenAI-compatible provider in CI. A formal real-model run remains optional and must follow no-reroll discipline; no credentials are stored in the repository. Canon harnesses remain regression assets; no further Canon runner, generic Scheduler, Save system, Dialogue framework, Memory/RAG or UI is justified speculatively.

Playable Local Loop is no longer the product endpoint. Real-play evidence in #52–#54 showed the interaction layer had drifted into a seven-Proposal adapter. The current stage is Chat-first Scene Loop (#55).

## Product Stage — Chat-first Scene Loop

Status: M0 frozen in Issue #57 / `docs/SCENE_TURN_CONTRACT.md`. M1 is the next implementation Slice.

Correct the player-facing loop without rewriting the Authority core:

- M0 — freeze Scene Turn contract, responsibility map, ephemeral / persistent / targeted boundaries, Kernel-intact migration, `src/play.ts` split plan, and one M1 Issue.
- M1 — intent-faithful Scene Turn + ephemeral success lane (#52 / #54 as acceptance, not standalone patches).
- M2 — targeted Player→NPC stimulus and response (#53).
- M3 — Context Continuity v1 (non-Truth recent window + relevance after Visibility).
- M4 — fresh real-model product playtest.

Product invariant: Engine constrains consequences, not imagination. See `docs/CHAT_FIRST_PRODUCT_RESET.md`.

## Later

Lore retrieval, long-term Memory, choice branching, desktop UI, multiple worlds and advanced simulation are deliberately deferred until the core authority chain is stable.
