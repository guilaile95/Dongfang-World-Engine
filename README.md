# 东方狂想

## 项目定位

这是一个面向长期文字角色扮演的 **Persistent AI World Simulator / 持久化 AI 世界模拟器**。

它不是传统聊天机器人，也不是单纯的 Character Card 工具。项目要解决的是：让一个世界能够长期运行，并让玩家的行动、NPC 的行为和后台事件持续留下可验证的后果。

核心目标：

- 世界能够长期运行；
- 世界状态不会因为上下文增长而丢失；
- NPC 拥有独立状态和认知；
- 世界事实与人物记忆分离；
- 玩家可以长期改变世界；
- LLM 负责推演和叙事，但不是事实数据库。

核心判断是：**Database is Truth**。已经确认并提交的世界状态才是事实；模型输出、聊天文本、摘要和 Memory 都只能参与提议、召回或展示，不能绕过引擎直接改写事实。

## 当前核心问题

普通的纯 Prompt / Tavern 式方案在长期运行后容易出现：

- 世界状态漂移；
- NPC 知道不该知道的信息；
- 人物 OOC；
- 已发生事实被覆盖；
- 事件因果丢失；
- 长对话失忆；
- 世界越来越围绕玩家；
- 剧情与状态互相矛盾。

这些问题的共同根因，是把叙事上下文、人物记忆和世界事实混在了一起，并让 LLM 输出隐式地承担了状态管理职责。

## 核心解决方向

世界引擎围绕以下分层构成：

```text
Canon / Lore
+
World State Database
+
Event Log
+
Claims
+
Character Knowledge
+
Memory
+
LLM Simulation
+
Validation
+
Narrative
```

运行时采用：

```text
User Action
    ↓
Context Builder
    ↓
World State + Lore + Character Knowledge + Relevant Memory
    ↓
Simulation LLM
    ↓
Candidate Events / State Delta
    ↓
Validator
    ↓
Commit Event
    ↓
Update Materialized State
    ↓
Narrator
    ↓
Player
```

详细的不可破坏规则见 [WORLD_ENGINE.md](WORLD_ENGINE.md)，概念数据模型见 [docs/DATA_MODEL.md](docs/DATA_MODEL.md)。

## 当前阶段

Step 2、2.5、2.6、2.6.1 Foundation、Step 3 Context Builder MVP、Step 4 Simulation Adapter MVP、Step 5 Turn Orchestrator MVP、Step 6 Minimal Real-Model Transport、Step 7 Minimal Narrator、Closed Inn 系列验证，以及 Vertical Slice 3 Authority proof、3.1 trusted binding、3.2 frozen real-model action sample、3.3 player-legible consequence 与 3.4 frozen real-Narrator sample 均已完成。Vertical Slice 3 后的 Stage Review 还确认并加固了回溯 Fact 替换的前置条件边界。当前没有已冻结的下一工程 Slice；Issue #47 仅记录真实 Narrator 样本暴露的 Behavioral P2，后续能力仍必须由该玩家可感知证据驱动。

第一阶段验证目标是：

> 一个世界、一个玩家、少量 NPC 和一条后台事件链，连续运行 30～50 轮后，仍保持事实、时间、位置、人物认知和因果一致。

当前 Slice 已实现一个完全确定性的闭环：

```text
Candidate Event
→ Zod Schema
→ Hard Validator
→ SQLite Transaction
→ Append-only Event Log
→ Materialized State
```

当前使用 TypeScript、Node.js、SQLite、Drizzle ORM、Zod 和 Vitest。暂不实现 UI、LLM、腾讯 Agent Memory、Memory Provider、RAG、多世界、分支时间线或复杂业务系统。

当前已实现的 Commit Kernel 支持 `character.move`、`character.die`、`character.learn_claim`、`relationship.change`、`fact.assert`、`claim.record`、`claim.transmit` 和 `world.time_advance` 八类 Candidate Event；所有提交都经过 Hard Validator 和同一 SQLite 事务，并可从初始 Seed 加 Event Log 重建关键状态。

Context Builder MVP 通过只读 API 为指定观察者构造结构化上下文：确定性过滤观察者自己的 CharacterKnowledge、Claim 和最小 provenance，暴露自身状态、当前位置、同地点角色的安全公共投影以及观察者作为 source 的有向关系；预算截断发生在可见性过滤之后，并保留完整 Knowledge causal bundle。Objective Fact 不会因为存在于数据库中而进入角色上下文；任何未来的概率相关性排序也只能发生在这个确定性可见性边界之后。

Simulation Adapter MVP 只接收已经过滤的 `CharacterContext`、匹配该 Context observer 的 actor 和自然语言 intent，通过窄的可注入 Model Client 生成 0..N 个有序、经 Zod 校验的七类 actor Candidate Proposal；model-facing system contract 明确要求顶层 `{\"proposals\":[...]}`、允许空列表、禁止 markdown/prose，并列出七类 Proposal 的精确字段与 actor ownership 规则。actor 模型暂不能生成 `fact.assert`。Proposal 不是已提交 Truth，不包含模型控制的 `worldId`、`expectedWorldRevision`、`occurredAt` 或 `causeEventIds`，Adapter 不读取 Store、不调用 CommitKernel，也不执行 proposal；最多允许一次结构修复，repair 只携带有界的 schema path/code/message 或具体 authority reason。Kernel 仍可为 trusted/system producer 保留 `fact.assert` 能力，Kernel capability 不等于 actor-model capability。

Turn Orchestrator MVP 接收 `worldId + actorCharacterId + intent`，自行构造当前角色 Context，调用 Simulation Adapter，再由自身为每个 Proposal 绑定可信的 World、revision、当前世界时间和空 cause provenance，并按顺序通过 CommitKernel 提交。首次 Commit 前会对整个 Proposal plan 做 schema 与 actor authority 预校验；单回合 Proposal 数量受小型、可配置的 execution cap 限制，越界或非法 plan 都不会产生部分写入。多 Proposal 使用已成功提交事件返回的 revision chaining；首次提交前世界变更最多触发一次 Context 重建与重新模拟，产生 committed prefix 后不再自动重模拟，失败结果保留已提交前缀且不会自动创建 `action.failed` Event。

Step 6 只增加一个窄的 OpenAI-compatible Chat Completions `SimulationModelClient` transport，以及一个开发者 opt-in 的单回合 headless smoke。Transport 只把现有 `SimulationModelRequest` 映射为 system instruction 与 `{ context, intent }` user payload，并只返回 assistant content；Simulation Adapter 继续负责 JSON/Zod/repair，Turn Orchestrator 和 Commit Kernel 继续拥有全部权威边界。Smoke 使用内存测试世界和真实 Context Builder → Simulation Adapter → Turn Orchestrator → Commit Kernel 链路，但不进入 CI，必须通过 `DWE_LLM_BASE_URL`、`DWE_LLM_API_KEY`、`DWE_LLM_MODEL` 显式提供凭据。

Step 7 增加一个 observer-scoped `NarrativeEnvelope`：Turn 完成后重新构造合法 CharacterContext，并将 committed actor outcomes 转成显式安全投影，再交给窄 Narrator boundary。Narrator 不能接收 raw `TurnResult.state`、WorldSnapshot、Store、CommitKernel、一般 Fact 或其他角色私有认知；Narrative text 只是展示投影，不写入 World、Event 或 Truth。Narrated smoke 使用现有 OpenAI-compatible chat boundary，仍是开发者 opt-in，不进入 CI。

Vertical Slice 0 增加 Closed Inn 最小测试场景与同地点 source-authored `claim.transmit` 传播能力：由拥有该 Claim 认知的角色主动发起传播，经同地点和存在性严格校验后为目标角色生成具备确定性 Event Provenance 的 CharacterKnowledge，且不赋予任何客观 Truth 权威；配备无通用 Scheduler 依赖的 10-turn Headless Test Harness。

Step 2.5 进一步冻结了内核的审计边界：每个 World 从 `revision = 0` 开始，Candidate 必须携带 `expectedWorldRevision`，成功提交同时产生全局 `sequence` 和该 World 的 `worldRevision`；过期 Candidate 以 `STALE_WORLD_STATE` 拒绝且不产生副作用。Fact 的谓词可以按 World 配置为 `one` 或 `many`，未配置时保守采用 `one`。初始 Fact、Claim 与 CharacterKnowledge 通过可审计 Seed 身份追溯，知识传播只允许结构化 character/event provenance，且角色传播必须精确复制来源知识状态。

Vertical Slice 3 增加 Seed-authoritative `FactAssertionRequirement`：手写 World 可以声明某个精确 Fact 三元组在被断言时所需的精确前置 Fact。Hard Validator 在 Candidate 的 `validFrom` 时点按半开有效区间检查全部前置条件；对于 `PredicatePolicy = one` 的替换，还会在投影前拒绝任何会让已提交 Fact 或本次待提交 Fact 在其断言时点失去前置条件的回溯关闭。不满足时统一以稳定错误拒绝，且不追加 Event、不投影 Fact、不推进 revision。与依赖无关的历史 `validFrom` 仍可提交；系统不会自动撤销或重算既有 Fact。该关系不进入 actor Proposal、Event payload 或角色 Context，也不是通用 Canon / Rule / Timeline Engine。

Vertical Slice 3.1 用一个 purpose-built headless scenario 证明最小 action-to-consequence 绑定：玩家仍只能通过现有 actor Proposal 提交合法 `character.move`；scenario-local trusted producer 只根据 Store 中当前 Head 的精确已提交 move Event ID，经 CommitKernel 断言 B′，并把该 move Event 记录为 cause。raw intent、未提交 Proposal、错误角色、错误目的地或被拒绝 Turn 都不能触发 B′；actor 模型仍不能生成 `fact.assert`。该证明不增加通用 Action/Effect Resolver、Rule Engine 或 Scheduler。

Vertical Slice 3.2 提供一个冻结的、开发者 opt-in real-model action-selection 入口：`npm run smoke:canon-divergence`。它只读取 `DWE_LLM_BASE_URL`、`DWE_LLM_API_KEY`、`DWE_LLM_MODEL`，复用现有 OpenAI-compatible transport 与 3.1 harness，并只输出 model identifier、execution mode、no-reroll protocol marker、provider call count 和 safe result。CI 的 injected fake fetch 明确标记为 `injected_test / formalSample=false`；只有非注入 CLI 网络路径标记为 `formal_network / formalSample=true`。正式样本必须在 exact-main 上调用一次，不能因结果不理想而重跑。

该正式样本已从 exact main `0c4efff7e45ecd2f507a8034dccdf165a44b2f8a` 执行一次：`providerCalls = 1`、`repair = 0`、无 reroll。真实模型基于合法 observer Context 提交了 Player `character.move`；scenario-local trusted producer 随后经 CommitKernel 产生 B′，精确旧 C 的直接提交以 `FACT_PRECONDITION_FAILED` 被拒绝且没有部分状态，独立 D 继续成功，最终 `worldRevision = committed Event count = 4`，full canonical replay 一致。正式输出未记录凭据、raw prompt/response、hidden reasoning、WorldSnapshot 或 private Knowledge。

Vertical Slice 3.3 让该 authoritative consequence 对 Player 合法可知，而不向 Context 或 Narrator 暴露 objective Fact。只在 trusted B′ 成功后，scenario-local producer 经 CommitKernel 记录一条与 B′ 命题一致的 Player-observed Claim，再以该 `claim.record` Event 作为结构化来源提交 Player `character.learn_claim = confirmed`。现有 Context Builder 随后自然提供完整 Claim / CharacterKnowledge / acquisition provenance bundle，现有 NarrativeEnvelope 只收到该合法认知与原始 Player move；B′ Fact、前置条件、旧 C rejection、独立 D、raw Event payload 和其他角色私有认知仍不可见。该 Slice 没有修改 Candidate、Validator、Context Builder、Narrator 或 Event 类型，也没有进行新的真实 provider 调用。

Vertical Slice 3.4 从 exact main `6f64c9aaed20bef984c6b55f0557a8eec9765814` 执行了一次冻结的真实 Narrator 样本：确定性本地 Simulation 不调用 provider，Narrator provider 只调用一次，禁止 redirect/retry，任何失败也会返回 `sampleConsumed = true` 的安全 receipt。该样本 Hard Gate 通过：B′、Player confirmed Knowledge、旧 C 原子拒绝、独立 D 和 full canonical replay 均保持正确，没有观察到 Truth/private-Knowledge/凭据/raw request 泄漏。行为问题判定为 **NO**：Narrative 虽提到 Player 已确认与西塔有关的路线信息，却把 `watch_route` 模糊表达为“有人监视西塔的路线”，没有清楚说明守卫队长的巡逻路线改到西塔或玩家行动产生的后果。该结果是 Behavioral P2，不是 Truth Authority 缺陷；样本不重跑，最小语义 grounding 问题记录于 Issue #47。

Step 2.6 明确冻结认知边界：`Fact` 只表示客观世界 Truth，`Claim` 表示可能为真、为假、过时、不完整或未解决的命题，`CharacterKnowledge` 只记录角色对 Claim 的认知。Claim 不会自动成为 Fact，Fact 也不会自动授予角色 Claim；`character.learn_claim` 与 `claim.transmit` 是合法的 Claim 认知变更事件，`claim.record` 只记录命题，不创建或修改 Fact。

本阶段不实现 provider framework、fallback chain、复杂 retry、Memory、RAG、Scheduler、Item/Inventory Framework、Dialogue Framework、UI、Branch 或 Save；CI 仍完全不依赖真实模型/API，Narrative text 仍不成为 Truth，Simulation Adapter 仍不执行任何 Event、State 或 World revision 写入。
