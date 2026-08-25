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
  - PR #74 (feat/step18-chat-first-ui): Step 18B UI & Opening Direction Candidate #3, DRAFT, OPEN.

ALL_FOUR_FINAL_ROOT_CAUSES_CLOSED:
  1. Opening Initialization Safe Retry & Idempotency: Engine executes Opening pre-planning and commits hook item, claim, knowledge, lore, situation, and opening scene inside a transaction ONLY after Narrator succeeds. A failed first call leaves zero dirty/corrupted state, and attempt 2 generates cleanly without duplicate records;
  2. Situation Lifecycle (preserve / update / clear): Decision Gate explicitly provides situationAction ('preserve', 'update', 'clear'). Mundane turns preserve situation; new crisis/barrier updates situation; player dismissal ("我把警告信扔了不管了") physically deletes the persistent situation from SQLite, and it never resurrects on reload or subsequent turns;
  3. Strict Decision Gate: Everyday questions ("你吃饭了吗？", "作业写完了吗？", "今天去哪儿？") produce 0 suggestions; only true urgent warnings, crises, and physical barriers activate 6 natural language suggestions (A-F);
  4. Real User Play Path in Opening Hook Tests: Real natural language "我伸手把桌上的警告纸条捡起来收好" -> carried -> 5 turns mundane eviction -> recall -> reopen persistence;
  5. World-Identity-Only Hook Planning: planOpeningHook strictly binds to world ID rather than guessing IP from common location names ("宿舍", "山门").

VERIFICATION_SUMMARY:
  - Typecheck: 0 errors on Node and Web (exactOptionalPropertyTypes: true).
  - Vitest: 23 passed / 23 suites, 105 passed, 0 skipped, 0 failed (105 total).
  - Playwright E2E: 3 passed / 3 total, 0 failed.
  - Opening Retry Path: 1st call fails (simulated LLM timeout) -> DB stays pristine -> 2nd call succeeds -> 3rd call idempotent.
  - Test Data Isolation: data/local SHA-256 digests remain 100% untouched.

NEXT_ACTION:
  - Push to feat/step18-chat-first-ui and await exact-head CI.
  - Report exact local vs CI metrics.
  - Hand over PR #74 to Owner for Real Play Candidate #3.
```
