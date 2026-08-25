# Current Stage — Recovery Coordinates

Last reviewed: 2026-08-26

This file is a **recovery pointer**, not a second task database. Always verify live GitHub before acting.

## PROJECT STATUS

# OWNER GREENFIELD RESET

Active governance Issue: **[#68 — Owner Greenfield Reset](https://github.com/guilaile95/Dongfang-World-Engine/issues/68)**.

Active product Issue: **[#75 — Dragon 2009 First-Hour: Scene Lifecycle + Canon Snapshot vertical slice](https://github.com/guilaile95/Dongfang-World-Engine/issues/75)**.

Current status:

```text
OWNER_GREENFIELD_RESET
OWNER_REAL_PLAY_REJECTED
DRAGON_2009_FIRST_HOUR_CONTRACT
```

The latest Owner real play rejected PR #74 as a product candidate. The player chose to avoid the old pier and take the long route; the engine committed and narrated a transition, then stopped at a point with no new meaningful decision and no A–F. This is a **Scene Lifecycle / Decision Handoff** failure, not a missing-button defect.

## Engineering Truth

```text
main:
  a6ae4d1385e8f15d362a0bb8d528c9e6ac530ae7

open PRs:
  #73 greenfield/owner-reset
      Engine baseline
      head 82e109a2229a598be2a4be831c27ae80402dfafc
      OPEN / unmerged

  #74 feat/step18-chat-first-ui
      Chat shell + Step 18B historical implementation
      Owner real-play rejected baseline
      DRAFT / OPEN / unmerged

next branch required by #75:
  feat/dragon-2009-first-hour
  base feat/step18-chat-first-ui
```

Do not merge #73 or #74 without Owner authorization. Do not continue symptom patches directly on #74.

## What still applies

- Chat-first freeform play, not an engine-verb menu.
- Engine constrains consequences, not imagination.
- The world must not orbit the player.
- LLM / Memory / prose are not Truth.
- Fact ≠ Claim ≠ CharacterKnowledge ≠ Memory.
- Visibility before relevance/recall.
- Persistent consequences survive restart.
- Implementation ≠ Verification ≠ Product Acceptance.
- Green CI does not override Owner real-play rejection.

## Current product blocker

The runtime currently executes one `playTurn()` and then returns control. It can decide whether to display suggestions, but it does not own a complete lifecycle from one player decision to the next meaningful decision.

The next slice must freeze and implement together:

1. Scene Lifecycle / Decision Handoff;
2. Time + Route semantics;
3. deterministic Dragon 2009 Starting Snapshot schema/compiler;
4. one independently existing Background Thread;
5. bounded auto-advance, cancellation, caps, retry and idempotency.

The target proof is:

```text
enter Dragon 2009
→ first meaningful decision
→ choose a strategy
→ automatically resolve the already-decided mundane transition
→ time and an independent world event advance
→ second genuinely meaningful decision
→ stop with grounded A–F + free input
```

## Canon source boundary

The Owner-provided `龙族V1.0(1).txt` is a world-running protocol, not a complete Canon Corpus. It explicitly requires reliable original-source material for concrete history and named-character facts.

The Owner-provided local TXT directory has been inventoried. The narrow primary source is the supplied Book I–III bundle, with the First-Hour window anchored to Book I on 2009-05-15 evening/night. Repository records contain only short paraphrases and local source locators; raw paths/hashes remain in gitignored `data/local/`.

Do not populate any additional named-character or historical Truth from model memory, Wiki, adaptation material, or the protocol summary.

## Read first

1. `AGENTS.md`
2. `docs/PRODUCT.md`
3. `docs/OPERATING_RULES.md`
4. `docs/GREENFIELD_RESET.md`
5. `docs/MINIMAL_COMPOSITION.md`
6. historical `docs/SCENE_TURN_CONTRACT.md` for reusable boundaries only
7. this file
8. live Issue #75
9. live PR #73 / #74
10. Notion: `Dragon 2009 First-Hour Slice｜计划与调研设计主审结论（2026-08-26）`

Do not restore the old Closed Inn / Proposal-menu route. Do not treat historical Roadmap documents as live requirements.

## Next action

Execute Issue #75 in this order:

```text
Canon scope + provenance rules
→ Scene Lifecycle / Time / Background Thread contracts
→ Dragon Snapshot JSON/Zod schema
→ stacked implementation branch + Draft PR
→ bounded lifecycle implementation
→ delete superseded regex/keyword patch paths
→ focused tests + exact-head CI
→ two frozen real-model paths
→ Owner real play
```
