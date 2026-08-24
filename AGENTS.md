# Agent Recovery Entry

This repository must be recoverable without previous chat history.

## 30-second recovery

Before significant work:

1. Read `docs/CURRENT_STAGE.md`.
2. Inspect live GitHub:
   - exact `main` SHA;
   - Open Issues;
   - Open PRs / Draft PRs;
   - latest review comments;
   - relevant CI;
   - code and tests for the **current** Stage only.
3. Read the GitHub documents named in `docs/CURRENT_STAGE.md`.
4. If long-term context is needed, use the connected Notion workspace and read only the page titles named in `docs/CURRENT_STAGE.md`.
5. Do not ask the user to reconstruct previous chats.

`docs/CURRENT_STAGE.md` contains recovery coordinates, not Engineering Truth. If it is stale, report the conflict and follow live GitHub.

## Owner Greenfield Reset (active)

Owner decision: **[#68 Greenfield Reset](https://github.com/guilaile95/Dongfang-World-Engine/issues/68)**. It outranks previous Issues, PRs, ADRs, and Notion “current route” pages.

Read `docs/GREENFIELD_RESET.md`.

Hard rules:

- Do **not** resume, merge, or continue **#65 / #66 / #67** or Roadmap Issues **#52–#59** as the product path.
- Do **not** restore old Production Runtime, APIs, schemas, class names, or compatibility layers because of tests, CI, PRs, or sunk cost.
- Old git objects are preserved as archive tags/branches (`archive/pre-greenfield-reset`, `archive/chat-first-pr-67`, `archive/composition-audit-pr-65`). Use them as evidence, not as the live architecture.
- New implementation happens on `greenfield/owner-reset`. Old runtime **may be deleted** on that branch.
- Product problems and long-term **invariants** from real play still apply. Implementations do not.

Do not treat a green CI on an archive branch as permission to merge the old route.

## First output

Before implementation, report:

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

`NEXT_ACTION` must obey the Greenfield Reset. Do not pick up archived Issues/PRs.

## Product North Star

Preserve the freedom of **chat-first** long-form text roleplay (as in a web AI chat) while a persistent local world prevents long-session forgetting, attention drift, missing plot, OOC, rule loss, information leakage, causal contradiction, and **the world orbiting the player**.

> **Engine constrains consequences, not imagination.**
> **The world must not orbit the player.**

The North Star is a product problem. It does not grant authority to any current file, class, table, or library choice.

## Compose-first

Prefer ADOPT / ADAPT / BORROW of mature projects before KEEP / OWN. KEEP / OWN need evidence that alternatives are unsuitable.

Do not vendor SillyTavern (AGPL) or RisuAI (GPL) into this MIT repository.

## Source roles

**GitHub** is Engineering Reality: code, `main`, Issues, PRs, reviews, CI, tags.

**Notion** is long-term product intent: North Star, invariants, architecture reasons, cross-stage lessons. Do not duplicate the GitHub timeline there.

If GitHub implementation and Notion intent disagree, report Intent-vs-Reality. After this Reset, Notion “current route” pages that predate Greenfield are **Historical / Superseded**.

## Handover rule

```text
Repository: guilaile95/Dongfang-World-Engine
Read AGENTS.md and recover from live GitHub + connected Notion.
Do not rely on chat history.
Do not restore archived runtime (#65/#66/#67, Closed Inn RPG-adapter path).
Return CURRENT ENGINEERING STATE, then obey the Greenfield Reset.
```
