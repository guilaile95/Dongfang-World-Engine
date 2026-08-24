# Composition / Reuse Audit

Status: audit complete — awaiting **owner unfreeze**

Owner Issue: #63

Freeze baseline: `2bda6c38a032a0297a3b4b755399d95c77454e55`

Audit head: `092f0442ccba92956c045e025ef5beb38ab0cb66` (freeze docs #64 on top of baseline)

Repo license today: **MIT**

Principle: **Compose-first. Own only the irreducible product core.**

Sunk cost has zero authority. Already-merged modules are judged the same as unbuilt ones.

Product problem (unchanged): preserve chat-first roleplay freedom while preventing long-session forgetting, OOC, information leakage, rule loss and causal contradiction.

> Engine constrains consequences, not imagination.

That is a **product invariant**, not a warrant for the current classes, tables, or files.

---

## 1. Current Capability Map

Every meaningful local subsystem, why it exists, and what it actually is.

| ID | Subsystem | Files (approx. LOC) | Why it was built | What it actually is |
|---|---|---|---|---|
| C1 | Chat / play surface | `src/play.ts` (~391) | First player-facing loop | stdin CLI mixed with Closed Inn scenario policy, provider env, SQLite session, delayed-consequence producer |
| C2 | Character / world content | `src/testkit/world-builder.ts` (~443) | Test fixture + playable world | Closed Inn dagger mystery seed; not a World Pack / Character Card loader |
| C3 | LLM transport | `openai-compatible-simulation-client.ts` (~169) | Talk to one Chat Completions server | Hand-rolled `fetch`, timeout, no streaming, no provider catalog, duplicated by Narrator |
| C4 | Structured output / simulation | `simulation-adapter.ts` (~394) | Constrain model to seven Proposal types | Zod parse + one repair; product-drifted into an action menu |
| C5 | Scene interpretation | `scene-interpreter.ts` (~138), `scene-turn.ts` (~92) | Chat-first lane routing (M1) | Second JSON contract on the same HTTP client; lane router, not a DSL |
| C6 | Scene resolution | `scene-resolver.ts` (~365) | Deterministic strips before Kernel | OOC gate, ask-only Knowledge strip, time mint, substring ephemeral surface, snapshot gate |
| C7 | Turn orchestration | `turn-orchestrator.ts` (~432) | Bind envelope and commit proposals | Still used by Closed Inn continuation and older tests |
| C8 | Context / visibility | `context-builder.ts` (~283) | Observer-safe Context | Deterministic Visibility Gate + id-order packing; no relevance |
| C9 | Narrative | `narrative.ts` (~288) | Player-facing projection | Envelope from committed outcomes + optional ephemeral surface; second HTTP client |
| C10 | Memory / retrieval | *absent* | Original product need | Not implemented; M3 was deferred then frozen |
| C11 | Dialogue / stimulus | Scene `targetedStimuli` only | M2 not built | Ask≠transmit strip exists; no NPC reply path; no transcript store |
| C12 | Persistence | `schema.ts` (~291), `sqlite-store.ts` (~539) | Local-first Truth | SQLite file + Drizzle; seed, snapshot, event list, revision |
| C13 | Event log / replay | events table + `projector.ts` (~395) | Events Explain State | Append-only log + materialize; rebuild-from-log proven in tests |
| C14 | Epistemic model | `domain/types.ts`, facts/claims/knowledge tables | Fact ≠ Claim ≠ Knowledge | Implemented and tested; shape is local |
| C15 | Visibility / knowledge boundary | Context Builder + Validator | No cross-character leak | Code-enforced, not prompt-enforced |
| C16 | Validation / authority | `validator.ts` (~693), `commit-kernel.ts` (~182), `candidate.ts` (~124) | LLM has no direct write | Deterministic legality + SQLite transaction |
| C17 | Scheduler / NPC autonomy | `play.ts` continuation | World continues | Not a scheduler: NPC rotation by time-advance count; authored reaction |
| C18 | Tests / eval / smoke | `tests/**`, `src/smoke/**` | Authority + play proofs | ~175 unit tests; opt-in real-model smokes; Canon 3.x harnesses |
| C19 | Desktop / packaging | *absent* | Local-first product | CLI + sqlite file only |
| C20 | Import / export / ecosystem | *absent* | World Pack deferred | No Character Card / lorebook I/O |
| C21 | Scenario policy in product entry | Closed Inn ids, `displayText`, delayed Claim in `play.ts` | Vertical proof | Product world is still a test fixture |

Dependencies already composed: **Zod** (MIT), **Drizzle ORM** (Apache-2.0), **better-sqlite3** (MIT), **Vitest** (MIT), **TypeScript**.

Self-developed surface that duplicates ecosystem work is concentrated in C3, C4 transport, C9 transport, C1 mixing, and the missing C10/C19/C20 (which we would otherwise reinvent).

---

## 2. Ecosystem Map

Candidates inspected. Not predetermined winners.

### 2.1 Roleplay / chat surfaces

| Project | License | What it owns | Local-first | TS/Node | Authority fit |
|---|---|---|---|---|---|
| **SillyTavern** | **AGPL-3.0** | Chat UI, Prompt Manager, World Info, Character Cards, extensions, providers | Yes (local install) | JS | Prompt/context as Truth. No Fact/Claim/Knowledge/Event Kernel. Summaries officially may hallucinate. |
| **RisuAI** | **GPL-3.0** | Friendlier RP UI, Character Card V3, lorebooks, regex, **Tauri** desktop | Yes | TS + Tauri | Same: chat/prompt engine, not a causal world authority. |
| **Agnai** | **AGPL-3.0** | Multi-user/multi-bot RP chat, CCv2 | Yes/self-host | TS | Same class as ST. |
| TypingMind / AI Dungeon | proprietary / hosted | Chat UX, memory products | No (cloud) | n/a | Violates local-first and data ownership. |

### 2.2 Character / lore formats

| Artifact | License | Notes |
|---|---|---|
| Character Card V2 (`malfoyslastname/character-card-spec-v2`) | spec (community) | PNG+JSON; ST/Agnai/Risu compatible |
| Character Card V3 (`kwaroran/character-card-spec-v3`) | **MIT** | Extends V2; Risu origin |
| SillyTavern World Info / lorebook JSON | ST (AGPL) as code; format is de-facto JSON | Triggered insertion; not Truth |

### 2.3 LLM transport / structured output

| Project | License | Fit |
|---|---|---|
| **Vercel AI SDK** (`ai`, `@ai-sdk/*`) | **Apache-2.0** | `generateText` / `streamText` / `generateObject` / tools; 25+ providers; Zod peer; Node 18+. Direct replacement for C3+C4 transport. Does **not** write world state. |
| **LiteLLM** | **MIT** (OSS proxy; separate enterprise) | Self-hosted OpenAI-compatible gateway. Useful if many keys; extra process. Heavier than AI SDK in-process. |
| OpenRouter | hosted, not a library | Optional provider behind AI SDK. Not local-first for keys. |
| Current hand-rolled `fetch` client | MIT (ours) | Duplicate of what AI SDK already does, worse. |

### 2.4 Memory / retrieval / stateful agents

| Project | License | Fit |
|---|---|---|
| **Mem0** | **Apache-2.0** OSS; cloud paid | Add/search memories; Python+TS; self-host with pgvector. **Recall aid, not Truth.** Cloud Mem0 is a privacy miss. OSS can sit *after* Visibility. |
| **Letta** (ex-MemGPT) | **Apache-2.0** | Stateful agents that rewrite their own memory/identity. Treats memory as the agent. **Conflicts** with Database-is-Truth and Visibility-as-code. |
| LangGraph / LlamaIndex | MIT/Apache variants | Orchestration/RAG frameworks. Would become a second engine. Not a world Kernel. |
| SillyTavern Summarize / Vector Storage | AGPL | ST docs warn summaries omit/hallucinate. Confirms Memory ≠ Truth. |

### 2.5 Persistence / event sourcing

| Project | License | Fit |
|---|---|---|
| **SQLite + better-sqlite3 + Drizzle** | MIT / Apache-2.0 | Already adopted. Single-file local-first is the product. |
| EventStoreDB / Kafka / Marten | various | Serverful. Wrong for one-player local file. Pattern BORROW only. |
| Generic TS event-sourcing kernels | MIT-ish | Provide log+version, **not** Fact/Claim/Knowledge/Visibility. Would still require our domain. |

### 2.6 Desktop

| Project | License | Fit |
|---|---|---|
| **Tauri 2** | MIT OR Apache-2.0 | Local-first desktop. Risu already uses it. Compose later; do not build Electron. |
| Electron | MIT | Heavier; no reason given local-first. |

### 2.7 Testing

| Project | License | Fit |
|---|---|---|
| Vitest | MIT | Already adopted. KEEP. |
| Promptfoo / eval harnesses | MIT | Optional later for real-model eval; DEFER. |

No inspected project implements: observer-specific **code** Visibility + Fact/Claim/Knowledge + append-only causal Event log + Hard Validator with **no LLM write**. That combination is the product, not an accidental local stack.

---

## 3. Reuse Matrix

Decision vocabulary: ADOPT / ADAPT / BORROW / KEEP / REPLACE / DELETE / DEFER.

`KEEP` / owned-core require named alternatives and a rejection reason.

| Subsystem | Decision | Alternatives named | Why this decision |
|---|---|---|---|
| Chat UI / future desktop shell | **DEFER** UI; when built **ADAPT sidecar or Tauri-from-scratch**, never in-repo ST/Risu | SillyTavern AGPL, Risu GPL, Agnai AGPL, Tauri MIT/Apache | Adopting ST/Risu **source** relicenses this MIT repo to AGPL/GPL. Sidecar process is the only clean reuse of their UI. Tauri is the desktop kit. Current CLI is a proof, not a product UI. |
| `play.ts` as mixed product/scenario/runtime | **REPLACE** (split); scenario **DELETE** from product entry | none needed | File is a vertical proof. Closed Inn policy is not the engine. |
| Character Card / World Info formats | **BORROW** CCv3 (MIT spec) + lorebook JSON shape; **DEFER** importer | CCv2/V3, ST World Info | Format compatibility is valuable. Cards/lorebooks are **not** Truth and must not write Kernel. |
| LLM provider transport | **REPLACE** with **ADAPT Vercel AI SDK** | AI SDK Apache-2.0; LiteLLM MIT; OpenRouter hosted | Current client is a worse subset: no stream, no catalog, duplicated. AI SDK sits **outside** Authority (it only returns tokens/JSON). LiteLLM only if a separate local gateway is later required. |
| Structured output / repair | **ADAPT** AI SDK `generateObject` + existing Zod schemas | AI SDK; keep Zod | SceneTurnPlan / Proposal Zod stays **ours**. Transport+parse+retry belongs to the SDK. |
| `simulation-adapter.ts` as Player surface | **DELETE** as product surface (already superseded by SceneTurnPlan); **REPLACE** remaining use | Scene Interpreter + AI SDK | Seven-Proposal adapter caused the RPG-menu drift. Keep only if continuation still needs it, then fold into Scene Interpreter. |
| Scene Interpreter | **ADAPT** (schema KEEP, client REPLACE) | AI SDK generateObject | Lane routing contract is Dongfang-specific. HTTP client is not. |
| Scene Resolver deterministic strips | **KEEP** (owned rules) | no library encodes ask≠transmit, `/ooc`, ephemeral substring, time mint | These are Authority-adjacent **rules**, not prompt hopes. No ST/Risu/Mem0 equivalent. |
| Context Builder visibility gate | **KEEP** algorithm / **REPLACE** implementation toward thinner module | Mem0, Letta, ST World Info | Those maximize recall or trigger lore. None filter by CharacterKnowledge before ranking. Visibility-before-relevance is a requirement; the current packing-by-id is disposable. |
| Relevance / RAG | **DEFER**; later **ADAPT** Mem0 OSS or a local ranker **after** Visibility | Mem0, ST vector, LlamaIndex | No evidence yet. Do not own a RAG platform. |
| Memory / summary | **DEFER**; later **ADAPT** Mem0 OSS as non-Truth | Mem0, Letta, ST Summarize | Letta rejected as Truth-shaped agent memory. Mem0 acceptable only as recall after Visibility, never overwriting Fact/Claim/Knowledge/Event. |
| Dialogue framework | **DELETE** as a platform goal; M2 stimulus if unfrozen is a **narrow Kernel Event**, not ST chat | ST/Risu transcripts | Product needs targeted stimulus + visibility, not a chat app inside the engine. |
| Persistence engine (SQLite file) | **KEEP** (already ADOPTed libs) | EventStoreDB, Postgres | Local one-file resume is the product. Serverful stores fail local-first. |
| Drizzle / better-sqlite3 / Zod / Vitest | **KEEP** | Prisma (heavier), raw SQL | Already composed. No reason to rewrite. |
| Event log + projector | **KEEP** as owned core **pattern**; tables not sacred | generic ES libraries | Libraries give append+version, not our epistemic projections. Replacing SQLite log with EventStoreDB would change the product (no longer a local file world). |
| Fact / Claim / CharacterKnowledge | **KEEP** as owned **model**; **REPLACE** schema if a thinner shape appears | none in RP ecosystem | This *is* the differentiator versus prompt-memory products. |
| Validator + CommitKernel | **KEEP** as owned core | Soft validators, LangGraph | Requirement is deterministic, LLM-free legality + atomic commit. No mature RP or agent library does this for world facts. Class names/files are not sacred; the boundary is. |
| Scheduler / always-on NPC | **DELETE** / **DEFER** | Generative Agents, ST extensions | Current rotation is scenario glue. A generic scheduler is unjustified. |
| Canon 3.x smoke runners | **KEEP** as **regression evidence**; **DELETE** as a growth path | n/a | They proved Kernel properties. They must not drive product architecture. |
| Custom dual HTTP clients | **DELETE** (fold into one AI SDK adapter) | AI SDK | Two copies of the same transport. |
| Food / Inventory / Item / World Pack compiler / Branch | **DELETE** / **DEFER** (already out of scope) | n/a | No new evidence. |
| Desktop packaging | **DEFER**; **ADOPT Tauri** when UI exists | Tauri, Electron | No UI now. |
| Import/export | **DEFER**; **BORROW** CCv3 | CCv3 | After engine composition, not before. |

---

## 4. License / Distribution Matrix

This repository is **MIT**. Relicensing to AGPL/GPL is a **product-owner** decision, not an audit default. Until that happens, copyleft frontends cannot be vendored.

| Component | License | Can enter this MIT repo? | Redistribution implication |
|---|---|---|---|
| SillyTavern | AGPL-3.0 | **No** (source/fork) | Linking/vendoring AGPL typically requires offering this project under AGPL. Network use of a modified ST also triggers AGPL source offer. |
| RisuAI | GPL-3.0 | **No** (source/fork) | GPL infects derivative works distributed together. |
| Agnai | AGPL-3.0 | **No** | Same as ST. |
| ST/Risu as **separate process** talking HTTP to MIT engine | AGPL/GPL stays in **their** process | **Yes, as sidecar** | Engine remains MIT. UI repo stays AGPL/GPL. Users who want ST UX run two processes. |
| Character Card V3 spec | MIT | **Yes** | Implement parser ourselves; do not copy Risu UI code. |
| Vercel AI SDK | Apache-2.0 | **Yes** | Notice + NOTICE if required; compatible with MIT. |
| LiteLLM OSS | MIT | **Yes** | Optional gateway process. |
| Mem0 OSS | Apache-2.0 | **Yes** | Cloud Mem0 is a **privacy** issue (data leaves machine). OSS self-host only. |
| Letta | Apache-2.0 | License **yes**; product **no** | License is fine. Architecture fights Truth/Visibility. |
| Tauri | MIT OR Apache-2.0 | **Yes** | Standard desktop kit. |
| Drizzle | Apache-2.0 | Already in | OK |
| better-sqlite3, Zod, Vitest, TypeScript | MIT / Apache-2.0 | Already in | OK |
| Closed Inn fixture | original | Yes | Test world; not third-party IP. |

**Hard rule:** do not fork SillyTavern or Risu into `Dongfang-World-Engine`. If the owner wants that UX, create a **separate** repo or document an external-process integration.

---

## 5. Target Composition Architecture

Smallest assembly: mature components + only irreducible Dongfang code.

```text
[optional] SillyTavern / Risu / future Tauri UI     ← other process or later ADOPT Tauri
        |  OpenAI-compatible or thin HTTP
        v
Application shell (thin)                             ← REPLACE play.ts
        |
        +-- Vercel AI SDK                            ← ADOPT/ADAPT transport + structured output
        |     generateObject(SceneTurnPlan)
        |     streamText(Narrator)
        |
        v
Dongfang Authority Core (OWN)                        ← KEEP boundary, files not sacred
  Visibility Gate (observer CharacterKnowledge)
  Scene Resolver rules (OOC, ask≠transmit, time mint, ephemeral surface ⊆ contribution)
  Candidate → Hard Validator → SQLite Tx → Event → Projector
  Fact / Claim / CharacterKnowledge
  Replay / provenance
        |
        v
SQLite file via Drizzle + better-sqlite3             ← already ADOPTed
        |
        +-- [later] Mem0 OSS recall AFTER Visibility ← ADAPT, non-Truth, DEFER
```

What this is **not**:

- not a SillyTavern fork with a database bolted on;
- not Letta/MemGPT as the world;
- not LangGraph as Kernel;
- not EventStoreDB in the cloud;
- not a generic Action DSL.

Player experience: one chat box. Engine only commits consequences.

---

## 6. Deletion / Migration Plan

No Production Runtime is changed in this audit. This is the plan **if the owner unfreezes**.

### Delete (stop treating as architecture)

| Code | Action |
|---|---|
| `openai-compatible-simulation-client.ts` as the long-term transport | Replace with one AI SDK adapter; delete the hand-rolled client |
| Second copy of HTTP in `OpenAICompatibleNarrativeModelClient` | Same adapter, different `generateObject` vs `streamText` |
| `simulation-adapter.ts` **as the Player API** | Player path is SceneTurnPlan; do not grow seven-Proposal surface |
| Closed Inn policy inside `play.ts` | Move to `src/testkit` / `src/scenario/closed-inn`; product entry must not hard-code dagger ids |
| New Canon 3.x runners | No more. Existing harnesses stay as regression tests only |
| Any plan to own RAG / Dialogue Framework / Scheduler / Food | Delete from roadmap as implementation targets |

### Wrap / replace (keep tests, change guts)

| Code | Action |
|---|---|
| Scene Interpreter model I/O | `generateObject` against `sceneTurnPlanSchema` |
| Narrator model I/O | `streamText` / `generateText` with the same envelope rules |
| Context packing | Keep Visibility Gate; replace id-order truncation when relevance exists |
| `TurnOrchestrator` | Keep until continuation is scenario-local; do not add features |

### Keep as owned core (see §7)

Validator, CommitKernel, Projector, Candidate schema, Event log, Fact/Claim/Knowledge, Visibility Gate algorithm, Scene Resolver **rules**, SQLite file world.

### Migration order (only after unfreeze)

1. Introduce AI SDK behind a single `ModelPort` that cannot call `CommitKernel`.
2. Point Scene Interpreter + Narrator at it; delete custom fetch clients.
3. Extract Closed Inn from `play.ts`.
4. Do **not** start M2 Dialogue or Mem0 until (1)–(3) land or the owner explicitly skips them.

Replay tests must stay green across (1)–(3). That is the regression bar, not a reason to keep the HTTP client.

---

## 7. Owned Core Justification

Every remaining self-developed subsystem must fail mature alternatives.

### OWN-1 — Epistemic world model (Fact ≠ Claim ≠ CharacterKnowledge ≠ Memory)

- **Need:** Objective truth, rumor, and per-character knowledge are different; Memory cannot overwrite them.
- **Tried:** SillyTavern lore/summary, Risu lorebook, Mem0, Letta.
- **Rejected because:** all treat text/memory as the working state, or (Letta) as the agent's identity. None model a Claim that can be false while a Fact is true, with per-character Knowledge rows and provenance.
- **If we deleted this:** the product collapses to another prompt-chat frontend. That **would** change the product (#63 stop-rule case, answered: we keep the invariant and therefore this model).

### OWN-2 — Deterministic Visibility Gate before any ranking

- **Need:** A character must not see another's private Knowledge/Facts because a ranker thought it relevant.
- **Tried:** World Info triggers, Mem0 search, Letta recall, RAG.
- **Rejected because:** they select *more* context, they do not enforce *legal* context. Relevance after Visibility can be borrowed later; the gate cannot.
- **Implementation:** current `ContextBuilder` file is replaceable; the gate is not.

### OWN-3 — LLM has no persistent write authority

- **Need:** Models propose; code commits or rejects atomically; rejected writes leave no partial state.
- **Tried:** tool-calling agents (AI SDK tools, LangGraph, Letta) writing directly; ST lore updates from chat.
- **Rejected because:** tool-calling *can* be the proposal channel (ADAPT), but the **authorizer** must stay deterministic and LLM-free. AI SDK `generateObject` is allowed **only** as proposal I/O.
- **Kernel class name is not sacred.** A future smaller `commit()` is fine. A model that `INSERT`s is not.

### OWN-4 — Append-only Events explain Materialized State; replayable locally

- **Need:** “Why did trust change?” → Event id, cause, time; rebuild from seed+log; one local file.
- **Tried:** EventStoreDB, generic ES libs, Mem0 as source of truth, chat logs as history.
- **Rejected because:** chat logs are not causal legality; Mem0 is recall; EventStoreDB is not a local sqlite world. A 50-line ES helper still needs our projections. Owning a small projector is cheaper than adopting a server.

### OWN-5 — Scene Resolver rules (not the JSON client)

- **Need:** OOC does not tick time; ask is not `claim.transmit`; ephemeral surface ⊆ player text; time only via `world.time_advance`.
- **Tried:** prompt-only ST, AI SDK tools without a resolver.
- **Rejected because:** M0/M1 evidence showed prompt-only substitution (`我不想去找匕首` → move; question → transmit). Those strips are code. The Interpreter HTTP layer is **not** owned (ADAPT AI SDK).

### Explicitly NOT owned

| Thing | Why not owned |
|---|---|
| Provider HTTP, streaming, retries | AI SDK |
| Multi-provider catalog | AI SDK / optional LiteLLM |
| Chat GUI, lorebook editor, card painter | ST/Risu sidecar or later Tauri |
| Vector memory platform | Mem0 later or nothing |
| Stateful “agent person” runtime | Letta — rejected |
| ORM, sqlite binding, test runner | already adopted |
| Action/Effect DSL, Scheduler, Food | unjustified |

**Stop-rule note:** preserving Truth/Visibility/Replay **does** require a custom engine core. That core is ~ Validator + Kernel + Projector + epistemic tables + Visibility Gate + Resolver rules — not the whole repo. The rest should shrink.

---

## 8. Unfreeze Proposal

**Do not unfreeze on this document alone.** Owner must explicitly approve.

### Recommended unfreeze (smallest composition Slice)

**Slice U0 — Replace transport, do not add product features**

- Add Vercel AI SDK (`ai` + one OpenAI-compatible provider).
- One `ModelPort` used by Scene Interpreter (`generateObject`) and Narrator (`generateText`/`streamText`).
- Delete `openai-compatible-simulation-client.ts` and the duplicate Narrator HTTP class.
- No M2, no Mem0, no UI, no Kernel rewrite, no real-model “pretty” rerolls.
- Acceptance: existing 175 tests + typecheck; Scene Resolver rules unchanged; Kernel untouched.

This is the smallest reduction of self-developed surface that does not touch Authority.

### Explicitly not the next Slice unless owner overrides

- #59 real-model acceptance (frozen; still optional later, not a gate for U0)
- #53 / M2 NPC conversation
- Mem0 / Context Continuity v1
- Tauri UI
- Character Card importer
- Relicensing to AGPL to fork SillyTavern

### Alternative compositions (need owner choice if they disagree)

| Strategy | When to pick | Cost |
|---|---|---|
| **A. MIT engine + optional AGPL sidecar UI** (recommended) | Keep MIT; users who want ST run ST separately against our API later | Two processes; engine stays small |
| **B. Relicense engine AGPL and fork ST** | Owner wants one binary that *is* SillyTavern | Loses MIT; owns a huge frontend; still must bolt Kernel on — high risk of prompt-as-Truth regression |
| **C. Keep hand-rolled fetch** | Owner rejects AI SDK dependency | Continues duplicating a solved problem; not recommended |

If the owner prefers B or C, that is a **stop-and-escalate** fork: two materially different compositions. This audit recommends **A + U0**.

### After U0 (only if owner continues)

1. Split `play.ts` (app vs Closed Inn).
2. Product proof: real-model chat-first on the composed stack (then M2 stimulus if still needed).
3. Memory: Mem0 OSS **after** Visibility, or nothing.

---

## 9. Evidence summary (why this is not a market-scan)

| Claim | Evidence |
|---|---|
| ST/Risu cannot be the Authority core | Their own docs: summaries hallucinate; World Info is prompt insertion; no Event/Validator/Knowledge split |
| ST/Risu cannot be vendored into this MIT repo | AGPL-3.0 / GPL-3.0 vs current MIT |
| AI SDK can replace C3 | Apache-2.0; `generateObject` + Zod; OpenAI-compatible providers; no world write |
| Mem0 cannot be Truth | Designed as memory layer; would sit after Visibility or not at all |
| Letta fights the product | Stateful agent memory/identity vs Database-is-Truth |
| Current Kernel is not “because we wrote it” | No ecosystem module implements the epistemic+visibility+atomic-commit combo; deleting it changes the product |
| Current HTTP client *is* sunk cost | AI SDK is the mature subset |

---

## 10. What Dongfang must still own (short)

After composition, the self-developed remainder should be:

1. Epistemic schema and projections (Fact / Claim / Knowledge / Event).
2. Deterministic Validator + transactional Commit + replay.
3. Visibility Gate.
4. Scene Resolver **rules** (not its HTTP).
5. A thin app shell and test worlds.

Everything else is ADOPT, ADAPT, BORROW, DEFER, or DELETE.

Owner action required: approve or reject **Unfreeze Slice U0** (and strategy A vs B vs C). Until then, FULL PROJECT FREEZE remains in force.
