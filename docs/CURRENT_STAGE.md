# Current Stage — Recovery Coordinates

Last reviewed: 2026-08-24

This file is a **recovery pointer**, not a second task database. Always verify live GitHub before acting.

## PROJECT STATUS

# OWNER UNFROZEN — Chat-first product reset

Active owner Issue: **#66 — Owner unfreeze: Chat-first product reset**

#63 FULL PROJECT FREEZE is **closed / superseded**. Do not stay frozen.

Product path:

- freeform scene chat via **Vercel AI SDK** (`ai` / `@ai-sdk/openai-compatible`);
- independent authored world/plot tick so the world does not orbit the player;
- same SQLite world file resumes plot / facts / rules.

Do **not** reopen #52–#59 as the player API. Seven-Proposal / Scene Interpreter JSON is not the play surface.

See `docs/CHAT_FIRST_RESET.md`.

## Product problem

The product still aims to preserve the freedom and intelligence of chat-first roleplay while preventing long-session forgetting, OOC, information leakage, rule loss and causal contradiction.

> **Engine constrains consequences, not imagination.**

This product goal does **not** imply that the current engine implementation must survive.

## Current play path

`npm run play` opens `PlaySession`: independent `tickClosedInnWorld` then Vercel AI SDK scene chat. Off-plot lines are valid. Same `DWE_WORLD_FILE` resumes.

Do not treat #63 freeze language below this heading as active. Historical audit docs remain evidence.

## No sacred implementation

**Sunk cost provides zero architectural authority.**

Every already-merged subsystem is eligible for:

- ADOPT external solution;
- ADAPT external solution behind a narrow boundary;
- BORROW protocol / format / pattern;
- KEEP current implementation;
- REPLACE current implementation;
- DELETE unnecessary implementation;
- DEFER capability entirely.

This includes, without exception:

- provider client / model transport;
- Simulation Adapter;
- Scene Interpreter / Scene Resolver;
- Context Builder;
- Narrative layer;
- `play.ts` loop;
- persistence / SQLite wiring;
- Candidate / Kernel / Validator / Event implementation;
- replay / test harnesses;
- schema and API shapes.

A product requirement may remain while its current implementation is replaced.

Examples:

- `Database is Truth` does not make the current Store sacred;
- `Fact != Claim != CharacterKnowledge` does not make current tables sacred;
- no direct LLM write authority does not make the current Kernel class sacred;
- deterministic visibility before relevance does not make the current ContextBuilder sacred.

## Audit principle

> **Compose-first. Own only the irreducible product core.**

For every subsystem, mature alternatives must be named and evaluated before KEEP / OWN is allowed.

At minimum inspect relevant capabilities from:

- SillyTavern;
- RisuAI;
- Vercel AI SDK / provider ecosystem;
- Mem0;
- Letta;
- additional current mature alternatives discovered during the audit.

These are candidates, not predetermined winners.

## Required output of #63

The audit is written in `docs/COMPOSITION_REUSE_AUDIT.md` (eight deliverables).

#63 is closed. Owner unfreeze is #66. The audit is evidence; the play path is the chat-first reset, not Slice U0-only transport swap.

## Read First — GitHub

1. `AGENTS.md`
2. Issue #66 (owner unfreeze) — #63 is closed
3. this file
4. `README.md`
5. `docs/CHAT_FIRST_RESET.md`
6. current play path: `src/engine/play-session.ts`, `src/engine/scene-chat.ts`, `src/engine/world-tick.ts`

## Read First — Notion

Use Notion for durable product intent and historical reasoning, not as an implementation authority.

Start with:

- `东方狂想｜Dongfang World Engine`
- `东方狂想｜Owner 解冻与 Chat-first 产品重置（2026-08-24）`
- `东方狂想｜Chat-first 产品纠偏、需求规格与 Grok 接管（2026-08-24）`
- `东方狂想｜架构风险、长期约束与可伸缩因果模拟设计`
- `东方狂想｜软件开发与工程接管手册`

Any old current-state snapshot is subordinate to live GitHub.

## Recovery Output

```text
CURRENT ENGINEERING STATE

EXACT_MAIN:
PROJECT_STATUS: OWNER_UNFROZEN
ACTIVE_ISSUE: #66
OPEN_PRS:
NEXT_ACTION: chat-first play path (freeform scene chat + independent world tick)
```
