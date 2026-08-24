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
   - code and tests for the current blocker.
3. Read the GitHub documents named in `docs/CURRENT_STAGE.md`.
4. If long-term context is needed, use the connected Notion workspace and read only the page titles named in `docs/CURRENT_STAGE.md`.
5. Do not ask the user to reconstruct previous chats.

`docs/CURRENT_STAGE.md` contains recovery coordinates, not Engineering Truth. If it is stale, report the conflict and follow live GitHub for current implementation state.

For detailed governance, use `docs/PROJECT_HANDOVER_PROTOCOL.md`.

## Freeze override

If `docs/CURRENT_STAGE.md` declares **FULL PROJECT FREEZE**:

- the freeze overrides ordinary autonomous implementation workflow;
- do not write Production Runtime / feature code;
- do not resume closed historical roadmap Issues;
- do not run frozen real-model acceptance experiments;
- perform only the audit / research work explicitly allowed by the active freeze Issue;
- treat already-merged code as replaceable audit evidence, not protected architecture;
- do not unfreeze based on Agent judgment alone — explicit project-owner approval is required.

## First output

Before implementation or freeze-audit work, report:

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

If the project is not frozen and the next action is clear and does not hit a Stop / Escalation condition, continue autonomously.

If the project is frozen, `NEXT_ACTION` must be an allowed audit action only.

## Product North Star

Preserve the freedom and intelligence of chat-first roleplay while using a persistent world layer to prevent long-session forgetting, OOC, information leakage, rule loss and causal drift.

> **Engine constrains consequences, not imagination.**

The North Star defines the product problem. It does not grant architectural authority to any current implementation.

## Product requirements vs implementation

Current product invariants / requirements may constrain outcomes, but the code used to satisfy them is not sacred.

Examples:

- `Database is Truth` does not require the current Store implementation;
- Fact / Claim / CharacterKnowledge separation does not require the current exact schema;
- no direct LLM persistent write authority does not require the current exact Kernel class;
- deterministic visibility before probabilistic relevance does not require the current exact ContextBuilder implementation.

If the active project stage is a Composition / Reuse Audit, current modules must be evaluated on equal footing with mature external alternatives.

## Recovery discipline

- Do not duplicate work already present in an Open PR.
- Do not treat green CI or implementer self-report as proof; inspect the actual diff and acceptance criteria.
- Do not reopen settled architecture unless current code, tests, real usage or explicit new product direction contradict it.
- Read only the code needed for the current Stage first; recovery is not permission for an unrelated repository-wide redesign.
- Reuse existing mature capability before adding infrastructure.
- For a new subsystem, prefer ADOPT / ADAPT / BORROW before KEEP / OWN; KEEP / OWN require evidence that mature alternatives are unsuitable.
- Do not preserve code because of sunk cost.

## Source roles

**GitHub** is current Engineering Reality: code, `main`, Issues, PRs, reviews, CI and frozen/current engineering decisions.

**Notion** is long-term product / architecture context: North Star, durable lessons, architecture direction and stage reasoning.

If GitHub implementation and Notion intent disagree, report it as an Intent-vs-Reality finding rather than silently overwriting either side.

## Handover rule

A normal cross-model handover should contain only:

```text
Repository: <owner/repo>
Read AGENTS.md and recover from live GitHub + connected Notion.
Do not rely on chat history.
Return CURRENT ENGINEERING STATE, then obey the active Stage / freeze state.
```

Pass recovery coordinates, not rewritten project history.
