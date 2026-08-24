# 最小组合架构（Vertical Slice）

Based on [`PRODUCT.md`](PRODUCT.md) and [`COMPOSE_FIRST_SURVEY.md`](COMPOSE_FIRST_SURVEY.md).  
**Not Production Runtime.** This page answers: what is the smallest assembly that can *play* and still be better than pure Chat.

Definition of the slice:

> 最少自研代码 + 最大成熟组件复用 + 最薄 Integration Layer + 一个真实可玩的端到端闭环。

The loop must hit PRODUCT.md 第一版成功标准 1–9 without UI、MOD、Redis、复杂 Scheduler、微服务、大规模 Agent 网络或 Vector DB.

---

## 端到端闭环（玩家看见的）

```text
本机进程 + 一个本地世界文件 + 云端强模型 API

玩家打自由自然语言
        │
        ▼
①  Visibility：只组装「这个观察者有权知道的」+ 公开世界主题
        │
        ▼
②  ADAPT Vercel AI SDK：流式写出场景（不写世界）
        │
        ▼
③  独立世界推进：与玩家原句解耦的 NPC/主题一步
        │     （可与 ② 交错，但不得把玩家话压成动作枚举）
        ▼
④  OWN 提交门：只有通过门的后果进入本地世界文件
        │
        ▼
⑤  叙事是投影：已提交后果 + 本轮即兴场景；散文不能单独改写已发生之事

:quit 后同一文件再开 → ① 仍能看到情节 / 事实 / 规则 / 角色所知
```

玩家从不面对 Event、Candidate、表名或动作菜单。内部种类若存在，只给提交门和后台，不给玩家。

一个最小可玩世界：少量地点、一个玩家、两三个 NPC、一条已开始的剧情主题。手写即可，不做 World Pack。

---

## 1. 直接 ADOPT

Use as libraries, no wrappers beyond import.

| Piece | Why v1 |
|---|---|
| TypeScript + Node | Repo and AI SDK live here; one process |
| Zod | Validate *internal* durable payloads only |
| SQLite via better-sqlite3 | One local file = P3 + P8; #63 still right vs Postgres/EventStoreDB |
| Vitest | Proof of the slice, not a second product |

Not ADOPTed: Drizzle-as-architecture, old table names, the archived Closed Inn as a framework.

---

## 2. 薄 ADAPT

| Piece | Boundary |
|---|---|
| **Vercel AI SDK** (`ai`, `@ai-sdk/openai-compatible`) | Only talk to Owner’s OpenAI-compatible cloud API. `streamText` / `generateText` for **foreground scene**. Optional `generateObject` **only** for background *proposals*, never as the player API. No world I/O inside the SDK. |
| **readline / stdin CLI** | Temporary play surface. Not a product UI. |

Adapter size should stay a small client: base URL, key, model, timeout, map messages in, tokens out.

---

## 3. 只 BORROW protocol / pattern

| Pattern | From | Borrow what | Do not copy |
|---|---|---|---|
| Dual-loop | Openovel | Foreground **does not write**; background may *propose* after the beat | Agent tools writing canon/memory files as Truth |
| Off-player world | WorldX, AI Town | NPC/theme can advance when the player eats/wanders | `action-menu-builder`, Convex, god-mode sim, image stack |
| Location-scoped perception | WorldX `perceiver` | NPC only “sees” same-place public stuff | Closing that into a numbered verb menu |
| Lore trigger | ST World Info *idea* | Extra colour **after** Visibility | World Info as Truth; ST/Risu source (AGPL/GPL) |
| Append-only explain | Event-sourcing *idea* | “why did this change” is recoverable | EventStoreDB / Kafka |
| OpenAI-compatible HTTP | de facto | Owner’s existing `DWE_LLM_*` | LiteLLM proxy as a required process |

CCv3 is BORROW **spec**, import **DEFER**.

---

## 4. 必须 OWN

Only product-core gaps. Names below are **capabilities**, not a promise to keep archived classes.

### OWN-1 认知分层：客观已发生 ≠ 传闻 ≠ 角色所知 ≠ 印象回忆

- **Checked:** OpenViking Memory/Resource/Skill; Mem0; Letta; Openovel file memory/canon; ST summarize/vector; WorldX memory-eval.
- **Why not enough:** All mix or replace “what is true” with recall, files, or agent-edited identity. None encode *four* layers plus “NPC must not know secrets.”
- **Why irreplaceable:** PRODUCT.md §11–12. Pure Chat fails here; that *is* why the engine exists.
- **Maintenance:** Small typed records + invariants. Worth it. Do **not** own a memory *platform*.

### OWN-2 Visibility-before-Relevance

- **Checked:** Mem0/OV/ST retrieve by similarity or triggers; Letta pages its own memory; WorldX perception is location-based but then dumps an action menu.
- **Why not enough:** Relevance ≠ permission. A high-score secret is still a leak.
- **Why irreplaceable:** PRODUCT.md §12; “NPC 知道不该知道的” is a stated Chat failure.
- **Maintenance:** A filter **before** any ranking or prompt packing. Cheap. Ranking/RAG **DEFER**.

### OWN-3 LLM 无直接持久写权（提交门）

- **Checked:** Openovel background file writes; Letta self-edit memory; WorldX `executeAction` from LLM decision; LangGraph-as-engine; KAL unlocated.
- **Why not enough:** They let the model (or its tools) become the database.
- **Why irreplaceable:** PRODUCT.md §4, §13–14. Scene prose may invent flavour; it may not silently unhappen a fact.
- **Maintenance:** One gate: structured proposal → legality → transaction. Empty proposal is valid (eating, refusing, chatting). Worth it.

### OWN-4 可解释的因果历史

- **Checked:** Generic event stores; Openovel append-only scene log (prose); Emergence CC BY-NC logs; WorldX event-store.
- **Why not enough:** Logs of *text* or sim events are not “this fact exists because that committed consequence, visible to whom.” NC license / cloud sim are unusable as product core.
- **Why irreplaceable:** PRODUCT.md §14–15; 关档重开仍要能说清为什么。
- **Maintenance:** Append-only records that *explain* materialized state. Not a distributed log product.

### OWN-5 叙事是投影

- **Checked:** ST/Risu (chat *is* state); Openovel narrator (good: no writes) but later files feed the next prompt as if true; WorldX dialogue generator mixed with action execution.
- **Why not enough:** If the scene transcript is the world, we are back to pure Chat.
- **Why irreplaceable:** Engine hidden *and* consequences durable. Narration shows what the observer may know of committed outcomes + ephemeral colour.
- **Maintenance:** A prompt assembly rule, not a narrator framework.

### OWN-6 离题时世界仍在（薄政策，不是 Scheduler）

- **Checked:** WorldX tick; AI Town scheduler; Emergence 120+ tools; Openovel resident team; ST extensions.
- **Why not enough:** Those are either menu-driven autonomy, cloud towns, research societies, or agent swarms. v1 forbids 复杂 Scheduler / 大规模 Agent 网络.
- **Why irreplaceable:** “World does not orbit the player” *and* “world does not lose its theme.” Pure Chat and player-verb engines both fail this.
- **Maintenance:** **Once per player turn**, independent of the sentence: advance a little world time + one authored or NPC-visible step that was *not* parsed from the player. No Redis, no job queue, no always-on sim.

If a later extractor proposes durable effects *from the player’s line*, it is background-only, goes through OWN-3, and **must allow empty**. It must never become the player API (that was the Proposal-menu failure).

---

## 5. 现在完全 DEFER

| Item | Why not this slice |
|---|---|
| UI / Tauri / ST sidecar | CLI is enough to prove the loop |
| Mem0 / OpenViking / Vector DB | **OpenViking REJECT in-process (AGPLv3; Memory ≠ Truth).** Mem0 not adopted. Thin OWN recall after Visibility indexes public lore + observer namespace only. |
| LiteLLM proxy | One OpenAI-compatible endpoint |
| CCv3 importer, World Pack, MOD | One hand-authored slice world |
| Letta, KAL, Funloom, Emergence runtime | REJECT or unlocated / NC |
| Inventory, dialogue framework, time-branch, multi-world slots | PRODUCT 非目标 |
| Redis, microservices, agent mesh, complex scheduler | Explicitly out |
| Ranking / RAG | Visibility first; nothing to rank yet |

---

## 最薄 Integration Layer

Four functions, one process, one file:

1. **`openWorld(path)`** — create or resume the local SQLite file.
2. **`contextFor(observer)`** — OWN-2 then pack; never include hidden facts.
3. **`playTurn(playerLine)`**  
   - blank/`/ooc` do not have to advance the world;  
   - always produce a scene via AI SDK;  
   - always run OWN-6 once for in-world lines;  
   - optional background proposals → OWN-3;  
   - never require the line to match an action enum.
4. **`close()`** — flush/close the file.

That is the slice API. Old `play.ts` / Kernel / SceneInterpreter **need not survive**; only these jobs must.

---

## 闭环证明什么（对照 PRODUCT 成功标准）

| 标准 | 本 slice 如何碰到 |
|---|---|
| 本机 + 云端 API 连续玩 | Node + env + AI SDK |
| 只打自然语言，无未知动作 | Foreground is chat; empty durable proposal is success |
| 吃/拒绝/问/闲聊/调查/战斗/即兴都有场景 | AI SDK scene; not a verb list |
| 不必懂内部原语 | CLI 只有 `>` 和 `:quit` |
| 关档重开仍在 | Same SQLite file; contextFor reads it |
| 多轮不是靠上下文窗口凑 | Durable layers, not chat dump |
| 离题日常时主题与 NPC 仍在 | OWN-6 independent of the sentence |
| NPC 不泄密 | OWN-2 |
| 早先行为仍被世界认出 | OWN-3 + OWN-4, even if v1 only has a few consequence kinds |

---

## 明确不是

- 不是旧 Runtime 的迁移图。
- 不是 WorldX/Openovel/ST 的嵌入。
- 不是先做平台再做玩。
- 不是把 OWN-1…6 实现成六套微服务。

下一步若实现，只允许在 `greenfield/owner-reset` 上按本页搭这一条闭环；删旧代码不必等待兼容层。
