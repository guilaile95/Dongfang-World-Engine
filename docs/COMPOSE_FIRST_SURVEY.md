# Compose-first 调研（相对 PRODUCT.md 的能力，而非相对旧 Runtime）

Verified: 2026-08-24 via official GitHub API (`gh api`), first-party docs, and current source files.  
Not Production Runtime. Not a shopping list. Named projects are **candidates**, not defaults.

Reuse: GitHub #63 / `archive/composition-audit-pr-65` still holds for SillyTavern AGPL, Risu GPL, CCv3 MIT, Vercel AI SDK Apache-2.0, LiteLLM MIT+enterprise split, Mem0/Letta Apache-2.0, and “do not vendor copyleft into this MIT repo.” **Re-checked** licenses, last push, and APIs below. Material change: **OpenViking main license is now AGPLv3** (older third-party pages still say Apache-2.0; ignore those).

Decision vocabulary: **ADOPT / ADAPT / BORROW / REJECT / DEFER**.  
ADOPT = take as-is. ADAPT = integrate behind a narrow boundary. BORROW = protocol/pattern only. REJECT = do not use for this product. DEFER = maybe later, not v1.

Repo stays **MIT**. AGPL/GPL **source** cannot enter this tree.

---

## 0. 东方狂想实际需要什么

From [`PRODUCT.md`](PRODUCT.md), v1 needs these *capabilities*, not these *libraries*:

| Need | Why |
|---|---|
| P1 Chat-first 自然语言进出 | 玩家不面对动作表 |
| P2 云端强模型对话智能 | GPT/Claude 级体验；本地不替代模型 |
| P3 数据本地优先 | 世界与玩后数据在本机 |
| P4 可持久后果，且不约束想象力 | Engine constrains consequences, not imagination |
| P5 世界不围着玩家转，也不丢掉主题 | 离题日常时 NPC/剧情仍在 |
| P6 客观已发生 ≠ 传闻 ≠ 角色所知 ≠ 印象回忆 | 混用是产品失败 |
| P7 认知边界 | NPC 不能因模型读过全库而泄密 |
| P8 关档重开仍算数 | 情节/事实/规则影响下一轮 |
| P9 过去行为可留后果、因果跨时间 | 纯 Chat 会蒸发 |
| P10 引擎对玩家不可见 | 内部原语不是玩法 |

v1 **不需要**：酒馆 UI、物品框架、调度器平台、评测社会、多人云世界。

#63 里“必须自研 Visibility+Fact+Event+Hard Validator 这一整套 class”**不再**作为本调研的预设。本页只判断外部项目能否覆盖 P1–P10，以及会不会破坏这些产品对错。

---

## 1. OpenViking

**Official:** https://github.com/volcengine/OpenViking · https://docs.openviking.ai/en/getting-started/01-introduction · https://openviking.ai/  
**Status:** actively pushed (API `pushed_at` 2026-08-24). Python 3.10+, `pip install openviking`, `openviking-server`. ~33k stars.

**License:** **AGPLv3** for the main project (`LICENSE` GNU AGPL v3). `crates/ov_cli` and `examples` Apache-2.0. GitHub license key `agpl-3.0`. Older Mintlify copy still advertising “Apache 2.0” is **stale**.

**Solves:** Context as `viking://` filesystem; Memory / Resource / Skill; L0/L1/L2 tiered load; `ls`/`tree`/`find`; retrieval traces; session commit → async memory update.

**Does not solve:** Chat-first player UX; durable *world* authority (facts vs rumor vs who-knows); visibility-as-code; replay of world consequences; “world does not orbit the player.” Memory here is *agent cognition*, not objective world.

**Local data:** Server can run locally (`path="./data"` in docs). Default cloud docs also point at Volcengine hosted API (`api.vikingdb.cn-beijing.volces.com`).

**Cloud API:** Uses LLM/embed providers for processing; inference can be BYO.

**TS/Python:** First-class **Python**. Extra **server process** (`openviking-server`).

**Privacy:** Self-host keeps files local. Hosted Volcengine path sends context off-machine.

**Authority:** Can sit **outside** Authority as a *recall/index* sidecar. **Cannot** be Truth: session commit “extracts memories automatically”; agent-writable cognition.

**Truth/Visibility/Replay:** Treating OV Memory as world state would mix P6. No observer Visibility Gate. Retrieval is relevance, not rights.

**Cost:** Extra Python service + embed/LLM spend. AGPL in-process or linking typically forces this MIT repo to AGPL.

**Token claim:** README currently: OpenClaw **24.20% → 82.08%** accuracy with OV; input tokens drop **34.3–91.0%** in *that* integration. **Do not** treat 91% as Dongfang’s expected saving. Different product, different traces.

**Decision: REJECT in-process (AGPL). DEFER sidecar** only after v1 proves context-bloat *and* a non-copyleft recall layer is insufficient. Not the default memory.

---

## 2. WorldX (`YGYOOO/WorldX`)

**Official:** https://github.com/YGYOOO/WorldX  
**Status:** TypeScript, MIT (`license.spdx_id` MIT). Last push **2026-07-08**. ~1.3k stars. Node 18+, React, Phaser, SQLite.

**Checked source (not a paper diagram):**

- `server/src/simulation/simulation-engine.ts`
- `perceiver.ts` → `buildPerception`
- `action-menu-builder.ts` → `buildActionMenu` (numbered `[world_action]` lines)
- `decision-maker.ts` → `makeDecision(charId, perception, actionMenu, gameTime)`
- then `executeAction` / `completeAction`
- plus `MemoryEvalSchema`, `runReflection`, diary/micro-reflection

**Current loop is:** Perception → **Action menu** → LLM Decision → Execute, with memory eval and reflection on the side. It is **not** a documented three-box “Perception→Reflection→Planning” slogan, and it **does** use a closed action menu for agents.

**Solves:** Autonomous NPC ticks, relationships, dialogue, multi-day evolution, god-mode inject. Useful *pictures* of “world continues without the player.”

**Does not solve:** Chat-first player API (menu is the opposite of P1). Visibility/epistemic split. Strong-model scene chat as the product surface.

**Local / cloud:** Local `npm run dev`; OpenAI-compatible simulation/orchestrator/image/vision keys. Data in project SQLite.

**TS:** Native. Extra heavy stack (Phaser, image, vision).

**Authority:** Simulation LLM writes actions through an executor; memory store is LLM-evaluated. Putting this inside Authority would let the model write the world through a menu — the failure mode PRODUCT.md forbids for the *player*, and a risk for NPC ticks if unconstrained.

**Decision: BORROW** (NPC tick / world-continues-off-player; location-scoped perception). **REJECT** as the product or player path (action menu, god-sim, art pipeline).

---

## 3. KAL / Kal AI Layer

**Official source:** **Not found.** Searches for “Kal AI Layer”, JSON Flow DAG, LLM Nodes, HTTP/SSE, lint/smoke/eval did not yield a single matching maintained project. Hits were Cal AI (calorie app), KausaLayer (crypto agent), unrelated `kal` languages, LangGraph kits.

**Decision: REJECT as a named dependency.** Do not write “KAL” into architecture until Owner provides a URL. If the intent was “JSON DAG of LLM nodes for game logic,” that *pattern* tends to **restrict Chat-first** (player input becomes a graph token). For v1, **DEFER any Flow-DAG orchestrator**; do not adopt LangGraph as a substitute under this name.

---

## 4. Openovel (`Feed-Scription/openovel`)

**Official:** https://github.com/Feed-Scription/openovel  
**Status:** Apache-2.0. JS/Electron. **8 stars.** Last push **2026-06-17**. README: **beta / demo**; APIs and workspace layout may change. macOS best-tested.

**Architecture (README + `src/runtime/permissionPolicy.js`):**

- **Foreground narrator:** streaming model call, **no tools, no file writes**.
- **Background team:** Showrunner + World Keeper / Director / Card Manager / Memory (or legacy Storykeeper). After the turn they **update Markdown/JSON files** (`story/canon`, `guidance`, `context-cards`, `memory`, `state`, agent notebooks).
- File-native; **no vector DB in default runtime**.
- Tool permissions: default-allow with deny/ask rules; bash tool default-on, sandboxed to workspace.

**Solves:** Dual-loop — low-latency chat vs background world maintenance. Closest *pattern* to “engine hidden behind chat.”

**Does not solve:** Code-enforced Visibility; fact vs rumor vs knowledge; deterministic replay of consequences. Background agents **write the files that become next-turn Truth**.

**Conflict with “prose/memory is not Truth”:** Direct. Canon/state/memory files are updated by LLM agents after a permission check, not after an independent world-authority commit. Fine as IF notes; unsafe as Dongfang durable world.

**Local / cloud:** `~/.openovel`; BYO OpenAI-compatible or Anthropic keys.

**TS:** JS/Electron app, not a library. Extra desktop process if used as sidecar.

**Decision: BORROW** dual-loop (narrator does not write; background may propose). **REJECT** adopting file-state + agent write authority.

---

## 5. AI Town (`a16z-infra/ai-town`)

**Official:** https://github.com/a16z-infra/ai-town · MIT. ~10.4k stars. Last push **2026-06-12**. TypeScript. Inspired by Stanford Generative Agents.

**Solves:** Agent scheduling, nearby chat, shared town sim, engagement loops.

**Does not solve:** Chat-first single-player RP; local-first without Convex; epistemic Visibility.

**Local / cloud:** Default **Convex** (cloud or `convex-local`). Not a single-file world.

**Authority:** Agent messages and memories are the sim. No Dongfang-style consequence kernel.

**Decision: BORROW** scheduling / “agents act when the player is elsewhere.” **REJECT** Convex-shaped stack as v1 persistence.

---

## 6. Emergence World (`EmergenceAI/Emergence-World`)

**Official:** https://github.com/EmergenceAI/Emergence-World · https://world.emergence.ai · arXiv:2606.08367  
**Status:** Last push **2026-07-01**. ~582 stars. Seasoned as a **lab**, not a game engine.

**License:** **CC BY-NC 4.0** (“Research-Only License Notice” in `LICENSE`). Share/adapt for **non-commercial research only**. Cannot drop into this MIT product tree as code.

**Solves:** Long-horizon multi-agent eval, cost/behavior drift across model families, 15-day studies.

**Does not solve:** Player chat product. 120+ tools and ComputeCredits economy are research apparatus.

**Decision: DEFER** as **eval methodology to read**, not copy. **REJECT** runtime/code incorporation (NC license + wrong product).

---

## 7. SillyTavern / RisuAI

**ST:** https://github.com/SillyTavern/SillyTavern · **AGPL-3.0** · ~32.6k stars · pushed 2026-08-21. Docs: https://docs.sillytavern.app/licensecredits/  
**Risu:** https://github.com/kwaroran/RisuAI · **GPL-3.0** · ~1.6k stars · TS+Tauri · pushed 2026-08-22.

#63 evidence still valid: prompt/World Info as context, not world authority; ST summaries may omit/hallucinate.

**Solves:** Mature RP chat UX, World Info triggers, Character Cards, provider lists.

**Does not solve:** P4–P9 as *code*. PRODUCT.md already lists “not a tavern clone.”

**Local:** Yes. Extra process if sidecar.

**MIT repo:** Vendoring source → copyleft infection. Sidecar HTTP is legally cleaner.

**Decision: REJECT source. BORROW** World Info *trigger* idea (keyword → extra context, **after** Visibility, never as Truth). Optional later **sidecar**, not v1.

---

## 8. Character Card V3

**Official:** https://github.com/kwaroran/character-card-spec-v3 · **MIT** · last push **2024-07-20** (spec, not an app). PNG `ccv3` tEXt chunk, JSON, CHARX.

**Solves:** Interchange format for persona/lorebook-ish blobs.

**Does not solve:** World authority. A card is prompt material.

**Decision: BORROW spec. DEFER importer** until after a playable v1. Never let a card write durable facts.

---

## 9. LiteLLM (`BerriAI/litellm`)

**Official:** https://github.com/BerriAI/litellm · https://www.litellm.ai/  
**Status:** Extremely active (pushed 2026-08-24). ~57k stars.

**License:** **MIT** for content outside `enterprise/`; `enterprise/` has a separate license (`LICENSE` split header).

**Two shapes:**

| | Python SDK | Proxy Server |
|---|---|---|
| Process | in-process Python | extra FastAPI gateway |
| Role | `completion()` unified API | OpenAI-compatible gateway, keys, routing |
| Fit for Dongfang | poor: product is TS/Node | only if many keys/routing become real |

**Solves:** Multi-provider, retry/fallback, cost tracking.

**Does not solve:** World, visibility, chat UX.

**v1:** Owner already has one OpenAI-compatible endpoint. Extra Python gateway is unjustified.

**Decision: DEFER.** Prefer in-process TS provider. Revisit Proxy only if multi-key routing hurts.

---

## 10. Vercel AI SDK (`vercel/ai`, `@ai-sdk/*`)

**Official:** https://github.com/vercel/ai · **Apache-2.0** (`LICENSE`). Pushed 2026-08-24. ~26k stars. Peer Zod. Node (package engines historically 18+/22+).

**Solves:** `generateText` / `streamText` / `generateObject`, OpenAI-compatible providers (`@ai-sdk/openai-compatible`), retries, streaming. **Does not write world state.**

**#63 + #67:** Already the right *transport* candidate. #67 used it on the *old* runtime — that experiment is archived; the library evidence still stands.

**Local / cloud:** Client only; talks to Owner’s cloud API. Keys stay in env.

**TS:** Native, in-process. Outside Authority.

**Decision: ADAPT** for P1/P2 (chat + stream + optional structured output for *background proposals only*). Not a world engine.

---

## 11. Mem0 vs Letta vs OpenViking (memory)

### Mem0 (`mem0ai/mem0`)

Apache-2.0. ~64k stars. Pushed 2026-08-24. Python + JS SDKs. OSS self-host vs **cloud platform** (docs.mem0.ai platform-vs-oss).

**Solves:** Add/search conversational memories.  
**Does not solve:** World facts, Visibility.  
**Privacy:** Cloud Mem0 leaves the machine — **REJECT cloud**. OSS self-host can sit **after** Visibility as non-Truth recall.

**vs OpenViking:** Mem0 is **Apache-2.0** (can enter MIT repo); OV is **AGPL**. OV’s filesystem metaphor is nicer for *lore files*; Mem0 is a thinner memory API. Neither is world Truth.

**Decision: DEFER; later ADAPT OSS-only after Visibility.** Not v1-blocking.

### Letta (`letta-ai/letta`, ex-MemGPT)

Apache-2.0. ~24k stars. Pushed 2026-08-23. Agent **runtime**: core/archival memory the **agent edits**. Current product surface also `letta-code`.

**Solves:** Long-lived agent identity.  
**Does not solve:** Dongfang — it *is* the agent, and memory is self-written Truth.

**Decision: REJECT** as world/memory authority (architecture, not license).

---

## 12. Funloom AI

**Found as:** commercial hosted Chinese AI text-game / co-creation platform (公司「库兰织梦」, 产品 Funloom AI). Sources: 36氪 interviews (2026-05 / 2026-08), Dealroom financing notes. **No public OSS repo or engine spec located.**

**Decision: REJECT as a technical dependency.** Do not treat press copy as architecture. UX anecdotes (one-sentence playable demo) are **unverified** for our invariants (local-first, visibility, off-plot world). **Not cited as a design fact.**

---

## 13. Newly noticed (not requested)

**Covel (`ackness/covel`)** — MIT, TypeScript, pushed 2026-08-24, ~32 stars. README: narrator + parallel plugin agents, SQLite local-first, optional suggested actions. Overlaps Openovel’s dual-loop. Too small to ADOPT. **DEFER**; if we BORROW dual-loop, prefer reading Openovel (clearer narrator-no-write) first.

---

## 14. Decision matrix

| Candidate | Decision | One-line why |
|---|---|---|
| Vercel AI SDK | **ADAPT** | Only mature TS in-process chat/stream/structured-output that stays outside Authority |
| Character Card V3 | **BORROW** + **DEFER** import | MIT spec; cards ≠ Truth |
| Openovel | **BORROW** dual-loop | Narrator without writes; **REJECT** agent-written files as world |
| WorldX | **BORROW** off-player NPC tick | Source is menu+perception loop; **REJECT** as player path |
| AI Town | **BORROW** scheduling idea | **REJECT** Convex as v1 store |
| SillyTavern / Risu | **REJECT** source; **BORROW** lore-trigger idea | AGPL/GPL |
| Mem0 OSS | **DEFER** then **ADAPT** | Recall after Visibility; **REJECT** cloud |
| LiteLLM | **DEFER** | Extra Python/proxy; one endpoint is enough for v1 |
| OpenViking | **REJECT** in-process; **DEFER** sidecar | **AGPLv3**; memory ≠ world; 91% not portable |
| Letta | **REJECT** | Agent self-writes memory/identity |
| Emergence World | **DEFER** eval reading; **REJECT** code | CC BY-NC |
| KAL / Kal AI Layer | **REJECT** (unlocated) | No official source |
| Funloom AI | **REJECT** | Hosted proprietary; no engine to compose |
| Covel | **DEFER** | Young MIT dual-loop; watch, don’t adopt |

Nothing above is adopted *because it was named*.

---

## 15. v1 composition (intent, not a class diagram)

Smallest assembly that matches PRODUCT.md:

```text
Player: free natural language
        ↓
ADAPT  Vercel AI SDK  → streaming scene (no world write)
        ↓
OWN    consequence / visibility / “what is true vs rumored vs known”
       + local world file (implementation unspecified)
        ↓
BORROW optional background tick so the world continues off-plot
       (pattern from Openovel/WorldX; not their menus or file-Truth)
```

Later, not v1: Mem0 OSS recall after Visibility; CCv3 import; LiteLLM proxy if keys explode; OV/ST only as extra processes if Owner accepts AGPL/GPL isolation.

**Do not compose:** Letta as the world, OV in-process, ST/Risu source, WorldX action menu as player API, KAL/Funloom as unnamed magic, Emergence as a game loop.

---

## 16. Sources (primary)

- OpenViking: GitHub API 2026-08-24; `LICENSE` AGPL v3; README license split + OpenClaw token range; docs.openviking.ai introduction.
- WorldX: GitHub API; `server/src/simulation/{simulation-engine,perceiver,decision-maker,action-menu-builder}.ts`.
- Openovel: GitHub API; README dual-loop; `src/runtime/permissionPolicy.js`.
- Emergence: `LICENSE` CC BY-NC 4.0; arXiv 2606.08367.
- LiteLLM: repo `LICENSE` MIT + `enterprise/` split.
- Vercel AI: repo `LICENSE` Apache-2.0.
- Mem0/Letta/ST/Risu/CCv3/AI Town: GitHub `license.spdx_id` + official READMEs as of 2026-08-24.
- Funloom: 36氪 / Dealroom — journalism only.
- #63 archive: `archive/composition-audit-pr-65`.
