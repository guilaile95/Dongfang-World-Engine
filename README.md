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

当前只做 **World Engine MVP**。

第一阶段验证目标是：

> 一个世界、一个玩家、少量 NPC 和一条后台事件链，连续运行 30～50 轮后，仍保持事实、时间、位置、人物认知和因果一致。

本阶段不实现 UI、不接入腾讯 Agent Memory、不创建复杂业务代码，也不引入数据库依赖。先冻结世界运行架构，再用一个最小代码 Slice 验证“候选事件 → 校验 → 提交 → 状态更新 → 叙事”的闭环。
