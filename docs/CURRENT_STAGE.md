# Current Stage — Recovery Coordinates

Last reviewed: 2026-08-24

This file is a **recovery pointer**, not a second task database.

Always verify live GitHub before acting. The SHA / Issue / PR values below are hints and may already be stale.

## Product North Star

Preserve the freedom and intelligence of chat-first roleplay while using an independent persistent World Engine to prevent long-session forgetting, attention drift, OOC, rule loss, information leakage and causal contradiction.

> **Engine constrains consequences, not imagination.**

## Current Stage

**Chat-first Scene Loop**

Stage owner: **Issue #55 — Chat-first Scene Loop**

M0 is complete:

- Issue #57 closed;
- PR #58 merged;
- frozen contract: `docs/SCENE_TURN_CONTRACT.md`;
- last reviewed main hint: `ec09353d8aa12b9dd334cde70eea5583119d6a91`.

## Immediate Work

**Issue #59 — M1: Intent-faithful Scene Turn + Ephemeral lane**

M1 is now unblocked and must implement from the merged M0 contract.

Evidence / acceptance Issues:

- #52 — Player intent fidelity;
- #54 — mundane low-causal ephemeral actions.

Do not implement #52 / #54 as separate action-specific architectures.

M2 blocker remains:

- #53 — targeted Player → NPC utterance / response.

Do not pull M2 dialogue response or durable stimulus into M1 unless #59 Stop Rule fires.

## Read First — GitHub

1. `README.md`
2. `docs/SCENE_TURN_CONTRACT.md` — M0 implementation source of truth
3. `docs/CHAT_FIRST_PRODUCT_RESET.md`
4. `docs/ARCHITECTURE_DECISIONS.md` — especially ADR-007 through ADR-012
5. Issue #55
6. Issue #59 and its latest comments
7. Issues #52 / #54 as M1 evidence; #53 only for M2 boundary
8. actual source + tests touched by #59

Before implementing, inspect live Open PRs. If another PR already implements #59, review / continue that work instead of opening a duplicate path.

## Read First — Notion

Use the connected Notion workspace only after live GitHub recovery. Search these exact page titles:

1. `东方狂想｜Dongfang World Engine`
2. `东方狂想｜Chat-first 产品纠偏、需求规格与 Grok 接管（2026-08-24）`

Read only if needed for deeper context:

- `东方狂想｜软件开发与工程接管手册`
- `东方狂想｜架构风险、长期约束与可伸缩因果模拟设计`
- `东方狂想｜玩法机制设计备忘：机制链、机制环、机制网`

If Notion current-state prose conflicts with live GitHub, GitHub wins for Engineering Reality. Preserve Notion as long-term intent and report the conflict.

## Frozen Invariants

- Database is Truth.
- Events Explain State.
- Fact != Claim != CharacterKnowledge != Memory.
- LLM has no direct persistent write authority.
- Visibility Gate precedes probabilistic relevance.
- Only future-causal effects enter the persistent authority chain.
- Persistent writes use Candidate → Hard Validator → Transaction → Event → Projection.
- Narrative / Memory / Summary are not Truth.
- Final prose is never parsed back into authoritative state.
- Player-private Context is never copied into an NPC Context.

## M1 Boundary

M1 should prove the smallest vertical path for:

- negation does not cause unrelated persistent actions;
- observation can remain non-persistent;
- mundane low-causal actions can succeed ephemerally;
- `/ooc` does not consume World time;
- World time is no longer coupled to raw input-line count;
- ask-only turns do not become `claim.transmit` / `learn_claim` / Player `claim.record`;
- persistent effects still use the existing Kernel and remain replayable;
- ephemeral beats use exact Player surface + non-authoritative classification, not Interpreter-authored replacement scene prose.

Do not reopen the M0 architecture unless #59 Stop Rule fires or new code / real-play evidence contradicts the frozen contract.

## Deferred Scope

Unless real evidence proves a blocker, do not build during M1:

- full NPC reply / durable dialogue path — M2;
- Memory / RAG / vector DB / rolling summary — M3;
- generic Action / Effect DSL;
- Food / Hunger / Inventory merely to support eating;
- generic Scheduler / Always-on NPC agents;
- World Pack Compiler;
- Tauri UI;
- Branch / Multiverse;
- provider router / microservices;
- Kernel / Validator rewrite.

## Recovery Output

After reading `AGENTS.md` and live GitHub, return:

```text
CURRENT ENGINEERING STATE

EXACT_MAIN:
CURRENT_STAGE:
ACTIVE_ISSUE:
ACTIVE_PR / HEAD:
CI:
CURRENT_BLOCKER:
CONFIRMED_P0_P1:
BEHAVIORAL_PRODUCT_BLOCKERS:
DEFERRED_SCOPE:
SOURCE_CONFLICTS:
NEXT_ACTION:
```

Then continue the smallest unblocked high-value action.
