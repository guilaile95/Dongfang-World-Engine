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

PROJECT_STATUS: OWNER_GREENFIELD_RESET / STEP_18_REAL_PLAY_CANDIDATE
ACTIVE_ISSUE: #68
OPEN_PRS:
  - PR #73 (greenfield/owner-reset): Engine baseline, OPEN, awaiting Owner merge.
  - PR #74 (feat/step18-chat-first-ui): Step 18 shell, DRAFT, OPEN, depends on #73.

REJECTED_HEAD: 2eb7f829d44cc579e73d7ce0d379edcfff1f4fda
REJECTED_REASONS_RESOLVED:
  1. Test pollution: E2E and unit tests isolated to unique OS temp directories; data/local never touched.
  2. Narration leak: Internal Engine markers (Authority, Candidate, Revision, Validator, B/C/S层, A→B→C, 当前状态/最近场景) fully stripped from context, leak gate regex with presentation repair added. Zero leaks across 12 real-play rounds.
  3. Onboarding & Journey: World selection screen -> Random / Custom Player Profile -> Character Card + First Scene -> Chat.
  4. Player Profile: Persistent identity stored in SQLite player_profiles table; survives session close and reopen.
  5. Layout & Readability: Max width expanded to 1280px (prose 820px), Markdown hierarchy (react-markdown + remark-gfm), right-aligned player bubble, IME composition handling (event.isComposing).
  6. Real Play Verification: 12-round fresh real play on Longzu world passed with full causal consistency (A->B->C), zero leaks, smooth narrative.

VERIFICATION_GATES:
  - Typecheck: PASS (Node + Web)
  - Unit Tests: 92 passed (23 files)
  - Build: PASS (dist/index.html + assets)
  - Playwright E2E: 3 passed (data isolation, onboarding -> chat flow, safe new save)
  - Fresh Real Play: 12 rounds completed, zero leaks, SQLite persistence verified.

NEXT_ACTION:
  - Owner Second Real Play on PR #74 candidate. Do not merge #73 or #74 without Owner authorization.
```
