# Current Stage — Recovery Coordinates

Last reviewed: 2026-08-25

This file is a **recovery pointer**, not a second task database. Always verify live GitHub before acting.

## PROJECT STATUS

# OWNER GREENFIELD RESET

Active owner Issue: **[#68 — Owner Greenfield Reset](https://github.com/guilaile95/Dongfang-World-Engine/issues/68)**.

This Owner decision **outranks** previous GitHub Issues, PRs, ADRs, and Notion current-route pages.

Product spec: [`PRODUCT.md`](PRODUCT.md). Operating rules: [`OPERATING_RULES.md`](OPERATING_RULES.md). Compose survey: [`COMPOSE_FIRST_SURVEY.md`](COMPOSE_FIRST_SURVEY.md). Minimal architecture: [`MINIMAL_COMPOSITION.md`](MINIMAL_COMPOSITION.md). Runtime choice: [`RUNTIME_CHOICE.md`](RUNTIME_CHOICE.md). Governance: [`GREENFIELD_RESET.md`](GREENFIELD_RESET.md).

### What this means

- Previous Production Runtime may be discarded. No compatibility layers.
- Do not merge or continue **#65**, **#66**, **#67**.
- Do not reopen **#52–#59** or the Closed Inn Proposal-menu path as the product.
- New work: branch `greenfield/owner-reset`.
- Recover old bits only from archive tags:
  - `archive/pre-greenfield-reset` (`main` = `092f0442ccba92956c045e025ef5beb38ab0cb66`)
  - `archive/chat-first-pr-67`
  - `archive/composition-audit-pr-65`

### What still applies (product, not code)

- Chat-first freeform play (web AI chat), not an engine-verb menu.
- Engine constrains consequences, not imagination.
- The world must not orbit the player.
- Persistent local world: plot / facts / rules survive restart.
- LLM / Memory / prose are not Truth and cannot write durable world state directly.
- Compose-first; MIT repo; no AGPL/GPL frontend vendoring.

## Read First — GitHub

1. `AGENTS.md`
2. `docs/PRODUCT.md` — North Star, invariants, non-goals, v1 success
3. `docs/OPERATING_RULES.md` — 执行守则（当前指令、实验、成本、空转）
4. `docs/COMPOSE_FIRST_SURVEY.md` — compose-first research (no runtime)
5. `docs/MINIMAL_COMPOSITION.md` — ADOPT/ADAPT/BORROW/OWN/DEFER slice
6. `docs/RUNTIME_CHOICE.md` — language/runtime after Step 3
7. `docs/GREENFIELD_RESET.md` — archive / do-not-restore
8. this file
9. live GitHub: `main`, Open Issues, Open PRs, tags `archive/*`
10. Notion pages listed below (intent only; same product spec)

Do **not** treat `docs/CHAT_FIRST_PRODUCT_RESET.md`, `docs/SCENE_TURN_CONTRACT.md`, `docs/ROADMAP.md`, `docs/COMPOSITION_REUSE_AUDIT.md`, or `WORLD_ENGINE.md` as live implementation requirements. They are historical evidence.

## Read First — Notion

Use Notion for durable product intent. Do not copy GitHub timelines.

Start with:

- `东方狂想｜Dongfang World Engine` (root; Greenfield banner)
- Product spec page (same content as `docs/PRODUCT.md`) — https://app.notion.com/p/3c655152dfe881bb8e06edd007391884
- Operating doctrine (durable method only) — https://app.notion.com/p/3c655152dfe881e9b74ac1c6e36f9d10
- Historical / Superseded: Chat-first 纠偏、Owner 解冻、Build-vs-Borrow 审计、项目复盘、Vertical Slice 策略、旧 Authority 实现页

## Recovery Output

```text
CURRENT ENGINEERING STATE

PROJECT_STATUS: OWNER_GREENFIELD_RESET / STEP_18B_REAL_PLAY_CANDIDATE
ACTIVE_ISSUE: #68
OPEN_PRS:
  - PR #73 (greenfield/owner-reset): Engine baseline, OPEN, awaiting Owner merge.
  - PR #74 (feat/step18-chat-first-ui): Step 18B UI & Opening Direction Candidate, DRAFT, OPEN.

ALL_ROOT_CAUSE_ITEMS_CLOSED:
  1. Opening Hook Architecture: Engine pre-plans opening hook (commits hook item & durable claim/lore content to Authority SQLite before prompting Narrator); Narrator describes pre-approved hook without inventing Authority items; durable item content accurately recalled 5+ turns later after opening scene is evicted from recent buffer;
  2. Meaningful Decision Presentation Gate: Mundane NPC small talk (e.g. weather, chitchat) produces 0 suggestions; critical NPC warnings/crises or physical action barriers activate 6 natural language suggestions (A-D distinct routes, E extreme, F absurd);
  3. Persistent "眼下" (Current Situation): Represents active unresolved situation, persists across mundane actions (drinking water, watching rain), updates on new events/barriers, and restores upon reopen;
  4. True Cross-World Isolation: Cultivation and Mystery protocol worlds completely stripped of modern/Longzu defaults (no schoolbag, no campus, no coastal missing persons news);
  5. Perspective Repair Secondary Validation: Repaired prose verified against both hasPerspectiveViolation and hasNarrationLeak with safe 2nd-person fallback;
  6. Verification Metrics: Vitest (103 passed, 0 skipped, 0 failed / 103 total), Playwright (3 passed, 0 failed / 3 total), Real Model (gpt-5.6-luna) multi-turn interactive run passed with 100% causal consistency.

VERIFICATION_SUMMARY:
  - Typecheck: 0 errors on Node and Web (exactOptionalPropertyTypes: true).
  - Unit/Integration: 103 passed across 23 test files in Vitest (0 skipped, 0 failed).
  - E2E: 3 passed in Playwright (desktop, mobile, safe new save, era drawer, suggestions).
  - Real Model 8-Round Test (gpt-5.6-luna): Verified durable hook pre-planning, 5-turn memory recall across recent window eviction, decision gate chitchat filtering vs barrier activation, and reopen persistence.
  - Test Data Isolation: data/local SHA-256 digests remain 100% untouched.

NEXT_ACTION:
  - Hand off PR #74 to Owner for Real Play Candidate #3.
  - Do not merge #73 or #74 without Owner authorization.
```
