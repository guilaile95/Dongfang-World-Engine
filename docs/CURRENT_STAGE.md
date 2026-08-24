# Current Stage — Recovery Coordinates

Last reviewed: 2026-08-24

This file is a **recovery pointer**, not a second task database. Always verify live GitHub before acting.

## PROJECT STATUS

# FULL PROJECT FREEZE

Active owner Issue: **#63 — PROJECT FREEZE: Full Composition / Reuse Audit before any further implementation**

Freeze baseline at decision time:

`main = 2bda6c38a032a0297a3b4b755399d95c77454e55`

There were no Open PRs when the freeze began.

The previous implementation roadmap is no longer active:

- #52 closed `not_planned` — evidence preserved;
- #53 closed `not_planned` — M2 implementation frozen;
- #54 closed `not_planned` — evidence preserved;
- #55 closed `not_planned` — Chat-first Scene Loop sequencing no longer presumed correct;
- #59 closed `not_planned` — M1 acceptance frozen; merged M1 code is not certified as the future architecture.

Do **not** reopen or continue these Issues mechanically.

## Product problem

The product still aims to preserve the freedom and intelligence of chat-first roleplay while preventing long-session forgetting, OOC, information leakage, rule loss and causal contradiction.

> **Engine constrains consequences, not imagination.**

This product goal does **not** imply that the current engine implementation must survive.

## Freeze meaning

No Production Runtime / feature implementation may proceed until #63 is complete and the project owner explicitly unfreezes development.

During the freeze:

- no M1 real-model acceptance run;
- no M2 / targeted NPC implementation;
- no Memory / RAG implementation;
- no UI / desktop implementation;
- no provider refactor;
- no new Dialogue / Scheduler / Item / World-Pack system;
- no speculative refactor preparing future architecture.

Allowed work is audit-only:

- read current code;
- inspect mature external projects / libraries;
- license analysis;
- compatibility and integration analysis;
- architecture comparison;
- narrowly scoped non-production compatibility spikes only when evidence cannot be obtained otherwise;
- documentation of findings.

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

The audit must produce:

1. Current Capability Map;
2. Ecosystem Map;
3. Reuse Matrix: ADOPT / ADAPT / BORROW / KEEP / REPLACE / DELETE / DEFER;
4. License / Distribution Matrix;
5. Target Composition Architecture;
6. Deletion / Migration Plan for already-written code;
7. Owned Core Justification for every remaining custom subsystem;
8. explicit Unfreeze Proposal.

No subsystem may be marked KEEP / OWN merely because it already exists.

## Read First — GitHub

1. `AGENTS.md`
2. Issue #63
3. this file
4. `README.md`
5. current source / tests as audit evidence
6. historical architecture / stage docs only to understand why existing code was built — not as automatic future requirements

Historical docs such as `docs/SCENE_TURN_CONTRACT.md`, `docs/CHAT_FIRST_PRODUCT_RESET.md`, `docs/ROADMAP.md` and ADRs are evidence and prior decisions. During #63 they may be retained, superseded or revised where the owner-approved product requirements allow it.

## Read First — Notion

Use Notion for durable product intent and historical reasoning, not as an implementation authority.

Start with:

- `东方狂想｜Dongfang World Engine`
- `东方狂想｜Chat-first 产品纠偏、需求规格与 Grok 接管（2026-08-24）`
- `东方狂想｜架构风险、长期约束与可伸缩因果模拟设计`
- `东方狂想｜软件开发与工程接管手册`

Any old current-state snapshot is subordinate to live GitHub.

## Recovery Output during freeze

A new Agent should report:

```text
CURRENT ENGINEERING STATE

EXACT_MAIN:
PROJECT_STATUS: FULL_FREEZE
ACTIVE_ISSUE: #63
OPEN_PRS:
OPEN_IMPLEMENTATION_ISSUES: none
AUDIT_SCOPE:
SOURCE_CONFLICTS:
NEXT_AUDIT_ACTION:
```

Then continue **audit work only**. Do not implement or run frozen product experiments unless the project owner explicitly unfreezes them.
