# Chat-first Product Reset

Status: architecture and product-direction handover

Baseline reviewed: `4a882eba2fbebdc934812e702d40bbd00aa6d221`

Stage owner issue: #55

Observed real-play evidence: #52, #53, #54

## 1. Executive verdict

The project has not failed and the Authority core should not be rewritten. The current implementation has, however, drifted from the original product experience.

The original need was:

> Preserve the freedom and intelligence of playing long-form text roleplay through a strong chat model, while preventing long-session forgetting, attention drift, missing plot, OOC, rule loss, information leakage and causal contradiction.

The current playable prototype instead behaves like a narrow RPG adapter:

```text
open-ended Player message
→ choose from seven actor Proposal APIs
→ validate / commit
→ Narrator explains the result
```

This makes the Engine-supported effect vocabulary behave like a Player-action permission list. Real play immediately exposed the mismatch: negation caused unrelated movement, eating could not happen, a question was converted to Claim transmission, empty input still advanced time, and the Narrator repeatedly returned to the dagger plot.

The correction is not to weaken the Authority core. It is to put a Chat-first scene layer above it.

New product invariant:

> **Engine constrains consequences, not imagination.**

Schema and Hard Validator constrain what may become authoritative persistent state. They must not constrain what the Player may naturally say, attempt, ask, feel or do within the scene.

## 2. Original product problem

The target experience begins from the strengths of direct web-chat roleplay:

- natural freeform input;
- easy dialogue;
- creative mundane actions;
- flexible scene pacing;
- minimal configuration;
- no need to know internal verbs or APIs.

The product exists because that experience degrades over time:

- old facts fall out of context;
- character relationships and personality drift;
- rules are forgotten;
- secrets leak to the wrong characters;
- important plot threads disappear;
- earlier choices stop mattering;
- recent topics dominate everything;
- prose and objective world state contradict each other.

Dongfang should preserve the first list and fix the second. It should not solve forgetting by replacing freeform roleplay with a traditional action menu hidden behind natural language.

## 3. Confirmed engineering assets to retain

The following are valuable and aligned with the original problem:

- Database is Truth;
- Append-only Event Log explains Materialized State;
- Fact / Claim / CharacterKnowledge separation;
- observer-specific deterministic Visibility Gate;
- LLM has no direct authoritative write access;
- Candidate → Hard Validator → Transaction → Event → Projection;
- local SQLite persistence and process resume;
- deterministic rejection atomicity;
- replay and provenance;
- Narrative remains non-authoritative;
- Canon prerequisites and retroactive causal-legality protection.

These components are the long-term consistency floor. Removing them would return the product to prompt-only drift.

## 4. Confirmed product and architecture drift

### 4.1 Missing Scene Interpretation and Effect Decomposition

The architecture direction already said:

```text
Open-ended Intent
→ Effect Decomposition
→ small composable state primitives
→ Hard Validator
```

The implementation skipped the middle. The Simulation Adapter asks the model to output only a list of seven exact Proposal types. It therefore answers:

> Which legal API resembles this message?

instead of:

> What naturally happens in the scene, and which parts need persistent causal authority?

This is the primary drift.

### 4.2 Empty Turn is incorrectly equivalent to failure / inaction

The Constitution already separates Persistent Causal Detail from Ephemeral Narrative Detail. Ordinary eating, sitting, resting, watching rain or wiping clothing often do not need persistence.

Current runtime has no successful ephemeral outcome. If there is no persistent Proposal, the Narrator is told to describe observation or inaction. This makes harmless roleplay impossible unless a dedicated Event type exists.

### 4.3 Speech is not a first-class scene stimulus

A Player question is not represented as a targeted interaction. The target NPC never receives the exact utterance through its own legal Context. The model therefore substitutes `claim.transmit`, and the Narrator may describe a conversation that never existed in state or stimulus history.

This violates product truth even when objective World Truth remains safe.

### 4.4 Context continuity is below the original requirement

Current Simulation input contains current observer Context plus the current intent. It does not contain:

- recent resolved scene exchanges;
- the last NPC response;
- targeted utterances / stimuli;
- non-authoritative story summary;
- relevant episodic memories;
- unresolved story threads;
- relevant recent Events beyond Knowledge provenance.

Therefore it cannot yet solve the original long-conversation problem.

### 4.5 Relevance is not implemented after Visibility

Context packing currently sorts all visible Knowledge by Claim id, then co-located characters, then relationships, and slices by budget. It does not rank information by current Player message or scene relevance.

The dagger remained present in every response because all known Claims are repeatedly supplied and the Narrator has no stronger current-scene continuity signal.

This is not authorization for a vector database. It is evidence that Visibility and Relevance are different stages.

### 4.6 `src/play.ts` is a vertical proof, not the final application architecture

The file currently combines:

- CLI input;
- provider configuration;
- SQLite open / seed / resume;
- Closed Inn fixture ids and display text;
- deterministic NPC rotation;
- unconditional ten-minute time advancement;
- one scripted NPC information action;
- one hard-coded delayed relationship reaction;
- one authored observation / Knowledge projection;
- Narrator and terminal sanitization.

This was acceptable to prove a Local-first loop. It is now a technical-debt boundary. Application shell, world-specific rules and generic interaction runtime must not continue growing in the same file.

### 4.7 The product world is still a test fixture

`npm run play` imports `seedClosedInnWorld()` from `src/testkit/world-builder.ts`; the Seed identifies itself as a test fixture and all character goals revolve around the dagger mystery.

This explains topic fixation and proves the current play entry is still a playable test world, not yet a general original-world product.

### 4.8 World continuation is message-count driven

Every non-empty CLI line triggers an NPC turn and ten minutes of World time, even when the Player message is unsupported, out-of-character or a correction. Time progression is therefore coupled to raw input count rather than resolved scene action.

### 4.9 Continuation outcomes are not explicitly narrated

The product loop runs Player Turn, then NPC/world continuation, then builds a NarrativeEnvelope from the Player TurnResult and the post-continuation Context. State may change because of an NPC Event, but the Narrative outcome list contains only the Player’s committed Events. This can make NPC actions appear as unexplained background facts.

### 4.10 Test success was overinterpreted as gameplay success

The 25-interaction acceptance used a deterministic loopback provider. It correctly proved CLI, HTTP, persistence, resume, Authority and delayed-causality plumbing. It did not prove freeform model interpretation or natural roleplay quality.

The first real model session immediately failed Player intent fidelity. Future stage reports must separate infrastructure proof from real-model product evidence.

## 5. Technical debt classification

### Fix in the next stage

- scene-level interpretation contract;
- ephemeral success lane;
- targeted Player→NPC stimulus and response;
- recent scene continuity;
- relevance after Visibility;
- explicit composition of Player + NPC/world outcomes;
- separation of application shell from Closed Inn scenario policy;
- time advancement based on resolved scene semantics, not raw line count.

### Retain but do not expand now

- the existing Candidate primitives;
- the current deterministic Kernel and Validator;
- Closed Inn as a regression/playtest world;
- scenario-local authored rules where explicitly identified as world content;
- observer-scoped `displayText` as a narrow semantic grounding mechanism.

### Defer until real evidence

- vector database;
- complex RAG platform;
- full Dialogue Framework / transcript UI;
- generic Action or Effect DSL;
- generic Scheduler / Always-on NPC network;
- Item / Hunger / Food system;
- World Pack Compiler;
- Tauri UI;
- Branch / Multiverse;
- provider router / microservices.

### Low-priority engineering debt

- `lint` currently duplicates TypeScript typecheck;
- main branch protection is disabled;
- README and Roadmap contain extensive historical logs and stale wording;
- `validator.ts` is a growing concentration point and must stay limited to deterministic legality.

These do not block the interaction reset.

## 6. Research addendum

Additional research was necessary because the project’s original problem is not unique: chat-first roleplay products already separate freeform generation from context continuity.

Useful external patterns:

- SillyTavern keeps chat generation primary, then composes prompt layers through Prompt Manager, World Info, summaries and optional retrieval. Its own documentation warns that generated summaries can omit or hallucinate details; this supports treating summaries as editable non-Truth context rather than authority.
- AI Dungeon treats arbitrary Player input as Do, Say or Story contributions, then builds model context from always-on essentials, triggered story cards, a story summary, relevant Memory Bank items and recent history. Its Memory System explicitly exists because forgotten choices become meaningless.
- Generative Agents uses an experience memory stream, dynamic retrieval, reflection and planning; ablation evidence found observation, planning and reflection all contribute to believable behavior.

Borrow the layering patterns, not their truth model or configuration complexity.

Dongfang’s differentiator should be:

```text
chat-first freedom
+
automatic layered context
+
independent authoritative world state
+
per-character visibility / knowledge
+
causal replay and provenance
+
minimal user configuration
```

Do not copy SillyTavern’s power-user configuration surface. Default behavior should be automatic, with inspection available for debugging rather than mandatory setup.

## 7. Corrected runtime direction

Conceptual direction:

```text
Player message
→ observer-safe Scene Context
→ non-authoritative Scene Turn Plan
    - ordinary / ephemeral beats
    - targeted utterance or immediate stimulus
    - persistent effect candidates
    - unsupported material intent or clarification
→ validate and commit persistent effects / durable stimuli
→ build target NPC Context with authorized current stimulus
→ NPC response / effects through the same authority boundary
→ Resolved Scene Envelope
    - original Player contribution
    - committed effects
    - rejected effects
    - safe ephemeral beats
    - explicit NPC/world outcomes
→ final player-facing prose
→ non-authoritative continuity capture / memory
```

Important boundaries:

- do not infer committed state back from unconstrained final prose;
- final prose may freely realize already-approved ephemeral beats;
- persistent effects must be explicit before final narration;
- immediate conversation does not require persisting every line;
- persist an interaction only when it has future causal value;
- target NPC receives only the stimulus and Context it is authorized to access;
- Memory and summary guide recall but never overwrite Truth.

## 8. Context Continuity v1

The original product cannot postpone Memory indefinitely. The first version should remain simple and local:

### Required layers

1. **Authoritative current state**
   - World time / location / entities;
   - current Facts where legally accessible;
   - CharacterKnowledge and Relationships;
   - committed causal outcomes.

2. **Recent resolved scene window**
   - recent Player contributions;
   - NPC responses;
   - scene outcomes;
   - enough continuity for pronouns, corrections and conversation.

3. **Stable story essentials**
   - role / identity;
   - core setting and rules;
   - current long-term goals;
   - always-relevant boundaries.

4. **Relevant episodic history**
   - observer-authorized interactions / Events;
   - later selected by recency and relevance;
   - no cross-character memory leakage.

5. **Rolling story summary**
   - only after the recent window is insufficient;
   - non-authoritative;
   - traceable to source ranges / Events;
   - rebuildable and correctable;
   - never used to overwrite Facts or Knowledge.

A vector database is not an entry requirement. SQLite storage plus a recent window and simple deterministic/relevance selection is sufficient for the first proof.

## 9. Requirements specification

### R1 — Chat-first Player freedom

The Player may write ordinary prose without knowing Engine primitives. Negation, inaction, topic change, mixed action+speech and mundane action must be understood as scene contributions.

### R2 — No unrelated persistent substitution

A persistent Proposal must be supported by the Player contribution and legal Context. When uncertain, the system must prefer no persistent effect or a clarification over an unrelated legal action.

### R3 — Ephemeral action success

A low-causal action may complete in the scene without Event or Materialized State change. This path must not be used for death, important inventory, location changes, secrets, relationship changes, permissions, tracked resources or other future-causal effects.

### R4 — Persistent effect authority

Every future-causal change continues through the existing Candidate → Validator → Transaction → Event → Projection chain.

### R5 — Targeted conversation

A Player utterance addressed to an NPC must be distinguishable from Claim transmission. The NPC must respond from its own authorized Context and exact immediate stimulus.

### R6 — Selective interaction persistence

Persist only dialogue / interaction details that have future causal value. Durable stimuli survive process resume, carry provenance and are visible only to authorized participants.

### R7 — Resolved scene coherence

The final Narrative must receive explicit Player, NPC and world outcomes. It must not hide missing behavior by claiming an unperformed conversation or persistent action.

### R8 — Context continuity

Recent scene history and relevant authorized memories must be available to the next turn. Long-session summaries remain non-Truth.

### R9 — Relevance after Visibility

Visibility determines what may be considered. Relevance determines what should enter the current prompt. Relevance may omit legal information; it may never add illegal information.

### R10 — Simple user experience

The default user flow remains one chat input. Optional `/say`, `/do` or `/ooc` controls may be considered only as convenience / disambiguation, never as mandatory complexity.

## 10. Milestones and acceptance

### M0 — Freeze the Scene Turn contract

Deliverable:

- exact current-flow diagram and responsibility map;
- minimal `SceneTurnPlan` concept;
- explicit persistent / ephemeral / interaction boundaries;
- proof that the Kernel need not be rewritten;
- migration plan for `src/play.ts` responsibilities.

### M1 — Intent-faithful ephemeral vertical slice

Must prove with a real model and deterministic regressions:

- `我不想去找匕首` causes no movement;
- `我只是看看周围` does not move;
- `我想吃饭` can be portrayed as a normal meal without Food state;
- unsupported material actions are not falsely completed;
- no raw line automatically advances time unless the resolved scene consumes time;
- persistent effects remain committed and replayable.

### M2 — Direct NPC conversation vertical slice

Must prove:

- asking Zhao is not converted into telling Zhao a Claim;
- Zhao receives the current authorized utterance;
- Zhao replies using only Zhao’s Knowledge / goals / relationships;
- another NPC does not receive private speech;
- a future-relevant exchange can survive restart;
- ordinary small talk need not be persisted forever.

### M3 — Context Continuity v1

Must prove:

- recent conversation references remain coherent;
- topic changes suppress irrelevant dagger repetition;
- an older important event can return when relevant;
- summaries or memories do not override Truth;
- no cross-character leakage;
- context remains inspectable and budgeted.

### M4 — Fresh real-model product playtest

- new SQLite world;
- 30–50 Player messages;
- action, speech, mixed input, negation, mundane action, OOC correction, topic change, return to earlier thread;
- process exit / resume;
- no code changes during the run;
- no reroll for prettier output;
- record intent-fidelity failures, empty/rejection/repair rates, dialogue coherence, repetition, memory recall and Hard Gate results.

## 11. Grok 4.6 High handover

### Engineering truth

- Repo: `guilaile95/Dongfang-World-Engine`
- Reviewed main: `4a882eba2fbebdc934812e702d40bbd00aa6d221`
- Stage owner: Issue #55
- Evidence issues: #52, #53, #54
- No open PR at the time of the review; the documentation PR created from this review must be checked before new implementation.

### First task

Do not immediately implement #52, #53 and #54 independently.

Perform M0 on exact main:

1. map the current Simulation Adapter, Orchestrator, Narrative Envelope, Context Builder and `src/play.ts` flow;
2. propose the smallest Scene Turn contract that handles ephemeral action, persistent effects and targeted speech without a generic DSL;
3. test the contract against all real-play evidence;
4. show how current Authority invariants remain unchanged;
5. freeze one vertical implementation Issue for M1.

### Decision authority

Grok may challenge field names and sequencing. It should not challenge the North Star without new product evidence, and it must not weaken the Authority core merely to make prose easier.

### Completion standard

The next stage succeeds when the product feels like free chat with a reliable world underneath—not like a narrow game command system with an LLM explaining it.

## 12. Final self-check

- Does the correction match the original need? Yes: freeform chat remains the surface; consistency moves to the background.
- Does it discard valuable work? No: Authority, persistence, visibility, replay and provenance are retained.
- Does it turn every natural action into a new Event type? No: ephemeral actions are first-class but non-persistent.
- Does it let prose become Truth? No: persistent effects stay explicit and validated before final narration.
- Does it prematurely build Memory/RAG infrastructure? No: Context Continuity starts with local recent history and non-authoritative layered context.
- Does it prematurely build a full Dialogue system? No: one target-specific stimulus vertical slice comes first.
- Is the next step executable? Yes: Issue #55 defines M0–M4 and the real-play cases define acceptance.
