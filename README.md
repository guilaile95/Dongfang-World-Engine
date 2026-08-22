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

Step 2、2.5、2.6、2.6.1 Foundation 与 Step 3 Context Builder MVP 已完成；当前实现 **Step 4 Simulation Adapter MVP**。

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

当前已实现的 Commit Kernel 支持 `character.move`、`character.die`、`character.learn_claim`、`relationship.change`、`fact.assert`、`claim.record` 和 `world.time_advance` 七类 Candidate Event；所有提交都经过 Hard Validator 和同一 SQLite 事务，并可从初始 Seed 加 Event Log 重建关键状态。

Context Builder MVP 通过只读 API 为指定观察者构造结构化上下文：确定性过滤观察者自己的 CharacterKnowledge、Claim 和最小 provenance，暴露自身状态、当前位置、同地点角色的安全公共投影以及观察者作为 source 的有向关系；预算截断发生在可见性过滤之后，并保留完整 Knowledge causal bundle。Objective Fact 不会因为存在于数据库中而进入角色上下文；任何未来的概率相关性排序也只能发生在这个确定性可见性边界之后。

Simulation Adapter MVP 只接收已经过滤的 `CharacterContext`、匹配该 Context observer 的 actor 和自然语言 intent，通过窄的可注入 Model Client 生成 0..N 个有序、经 Zod 校验的六类 actor Candidate Proposal；actor 模型暂不能生成 `fact.assert`。Proposal 不是已提交 Truth，不包含模型控制的 `worldId`、`expectedWorldRevision`、`occurredAt` 或 `causeEventIds`，Adapter 不读取 Store、不调用 CommitKernel，也不执行 proposal；最多允许一次结构修复，revision 绑定与顺序提交属于未来 Turn Orchestrator。Kernel 仍可为 trusted/system producer 保留 `fact.assert` 能力，Kernel capability 不等于 actor-model capability。

Step 2.5 进一步冻结了内核的审计边界：每个 World 从 `revision = 0` 开始，Candidate 必须携带 `expectedWorldRevision`，成功提交同时产生全局 `sequence` 和该 World 的 `worldRevision`；过期 Candidate 以 `STALE_WORLD_STATE` 拒绝且不产生副作用。Fact 的谓词可以按 World 配置为 `one` 或 `many`，未配置时保守采用 `one`。初始 Fact、Claim 与 CharacterKnowledge 通过可审计 Seed 身份追溯，知识传播只允许结构化 character/event provenance，且角色传播必须精确复制来源知识状态。

Step 2.6 明确冻结认知边界：`Fact` 只表示客观世界 Truth，`Claim` 表示可能为真、为假、过时、不完整或未解决的命题，`CharacterKnowledge` 只记录角色对 Claim 的认知。Claim 不会自动成为 Fact，Fact 也不会自动授予角色 Claim；`character.learn_claim` 是唯一的 Claim 认知变更事件，`claim.record` 只记录命题，不创建或修改 Fact。

本阶段不接入真实 LLM Provider、Memory、RAG、Narrative、UI、Branch、Save 或其他后续系统；Simulation Adapter 仍完全不执行任何 Event、State 或 World revision 写入。
