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

Step 2、2.5、2.6、2.6.1 Foundation、Step 3 Context Builder MVP、Step 4 Simulation Adapter MVP、Step 5 Turn Orchestrator MVP、Step 6 Minimal Real-Model Transport 与 Step 7 Minimal Narrator 已完成；当前实现 **Step 8 Vertical Slice 0: Closed Inn 10-turn Causal Loop Proof**。

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

Step 8 增加 Closed Inn 最小测试场景与同地点 source-authored `claim.transmit` 传播能力：由拥有该 Claim 认知的角色主动发起传播，经同地点和存在性严格校验后为目标角色生成具备确定性 Event Provenance 的 CharacterKnowledge，且不赋予任何客观 Truth 权威；配备无通用 Scheduler 依赖的 10-turn Headless Test Harness。

本阶段不实现 provider framework、fallback chain、复杂 retry、Memory、RAG、Scheduler、Item/Inventory Framework、Dialogue Framework、UI、Branch 或 Save；CI 仍完全不依赖真实模型/API，Narrative text 仍不成为 Truth，Simulation Adapter 仍不执行任何 Event、State 或 World revision 写入。
