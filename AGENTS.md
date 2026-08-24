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

If the next action is clear and does not hit a Stop / Escalation condition, continue autonomously.

## Product North Star

Preserve the freedom and intelligence of chat-first roleplay while using the World Engine in the background to prevent long-session forgetting, OOC, information leakage, rule loss and causal drift.

> **Engine constrains consequences, not imagination.**

## Frozen authority boundaries

- Database is Truth.
- Events Explain State.
- Fact != Claim != CharacterKnowledge != Memory.
- LLM has no direct persistent write authority.
- Deterministic Visibility Gate precedes probabilistic relevance.
- Persistent change uses Candidate → Hard Validator → Transaction → Event → Projection.
- Narrative is non-authoritative and is never parsed back into Truth.
- Rejected writes must not leave partial state.
- Replay / provenance must remain explainable.

A current instruction may change priorities. If it would change one of these frozen boundaries, treat that as an explicit architecture decision instead of silently changing the rule.

## Recovery discipline

- Do not duplicate work already present in an Open PR.
- Do not treat green CI or implementer self-report as proof; inspect the actual diff and acceptance criteria.
- Do not reopen settled architecture unless current code, tests, real usage or explicit new product direction contradict it.
- Read only the code needed for the current Stage first; recovery is not permission for a repository-wide redesign.
- Reuse existing capability before adding infrastructure.

## Source roles

**GitHub** is current Engineering Reality: code, `main`, Issues, PRs, reviews, CI and frozen ADRs.

**Notion** is long-term product / architecture context: North Star, durable lessons, architecture direction and stage reasoning.

If GitHub implementation and Notion intent disagree, report it as an Intent-vs-Reality finding rather than silently overwriting either side.

## Handover rule

A normal cross-model handover should contain only:

```text
Repository: <owner/repo>
Read AGENTS.md and recover from live GitHub + connected Notion.
Do not rely on chat history.
Return CURRENT ENGINEERING STATE, then continue the highest-priority unblocked work.
```

Pass recovery coordinates, not rewritten project history.
