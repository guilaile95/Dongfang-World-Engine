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
- frozen contract: `docs/SCENE_TURN_CONTRACT.md`.

M1 implementation is merged:

- PR #61 merged;
- implementation main hint: `365a1625e8dbfbd4068edf7861a509de6948822c`;
- deterministic / injected-provider coverage and CI passed;
- Kernel / Validator / Event types remained unchanged.

## Immediate Work

**Issue #59 — M1 real-model acceptance gate**

The implementation is on `main`, but #59 has been reopened because its frozen acceptance criteria explicitly require one opt-in real-model smoke and no recorded M1 real-model sample was found in PR #61 / Issue #59 evidence.

Do not start M2 until this acceptance sample is recorded and classified.

Required real-model M1 cases include the natural inputs that originally exposed the product failure:

- `我不想去找匕首`;
- `我只是看看周围`;
- `我想吃饭`;
- ask-only question to 赵先生;
- one unsupported-material / OOC-style case from the frozen M1 protocol.

Verify observable behavior only:

- no unrelated `character.move`;
- no Food / Inventory state;
- ask-only does not become Claim / Knowledge write;
- time advances only when `consume_scene_time`;
- no Truth/private-Knowledge leak;
- no replay / authority regression.

Formal sample discipline applies: no reroll for prettier prose; safe trace only.

## Next After M1 Acceptance

**M2 / Issue #53 — targeted Player → NPC utterance / response**

#53 remains the observed M2 blocker. Do not expand it into a full Dialogue Framework.

Issues #52 / #54 remain real-play evidence / regression references for M1 and should not become separate action-specific architectures.

## Read First — GitHub

1. `README.md`
2. `docs/SCENE_TURN_CONTRACT.md`
3. `docs/CHAT_FIRST_PRODUCT_RESET.md`
4. `docs/ARCHITECTURE_DECISIONS.md` — especially ADR-007 through ADR-012
5. Issue #55
6. Issue #59 and its latest comments
7. PR #61 when reviewing the merged M1 implementation
8. Issue #53 only after the M1 real-model gate passes
9. actual source + tests relevant to the active blocker

Before implementing, inspect live Open PRs. If another PR already addresses the active work, review / continue it instead of opening a duplicate path.

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

## Deferred Scope

Unless real evidence proves a blocker, do not build before the M1 acceptance gate completes:

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
