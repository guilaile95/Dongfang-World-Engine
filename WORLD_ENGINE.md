# World Engine Constitution

## 世界引擎宪法

本文档定义 Persistent AI World Simulator 的核心架构和不可轻易破坏的规则。它优先约束事实、因果、知识边界和提交流程，而不是规定 UI、提示词风格或具体供应商实现。

如果实现便利性与本文档的权威边界冲突，必须先保护世界事实的可追溯性和角色知识隔离，再讨论实现折衷。

## 1. 核心运行模型

世界的运行闭环必须遵循：

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

其中：

1. Context Builder 只组装当前请求允许看到的上下文；
2. Simulation LLM 只能提出 Candidate Events / State Delta；
3. Validator 检查候选变化是否符合当前事实、规则、权限和不变量；
4. Commit 将通过校验的事件追加到 Event Log；
5. Materialized State 根据已提交事件更新当前状态；
6. Narrator 只把已确认的结果转化为给玩家看的剧情文本。

## 2. 不可破坏的核心原则

### 2.1 Database is Truth

数据库中经过确认并提交的状态，是世界事实的唯一权威来源。

LLM 输出、聊天文本、剧情摘要、Memory 和上下文缓存都不能直接覆盖数据库事实。它们最多是候选变化、召回材料或非权威展示。

“数据库”在本阶段表示事实权威层的概念边界，不意味着现在就要选定或引入某个数据库产品。

### 2.2 Events Explain State

重大世界状态变化必须能够追溯到事件。不能只记录：

```text
楚子航 trust = 10
```

还必须能够回答：

```text
为什么从 45 变成 10？
哪个事件导致了变化？
该事件由什么原因触发？
当时哪些角色参与或受影响？
```

因此系统采用 **当前状态 + Append-only Event Log**，而不是只保存最终结果。当前状态用于高效读取，事件日志用于解释、审计、恢复和重放。

### 2.3 Memory is not Truth

Memory 负责：

- 召回过去；
- 查找相关经历；
- 表达人物印象；
- 保存对话记忆；
- 提供长期模式。

Memory 不能直接决定：

- 谁活着；
- 谁在哪里；
- 谁拥有什么；
- 某事件是否发生；
- NPC 是否知道某个秘密。

Memory 可以有错误、过时、缺失或带有人物偏见；数据库事实不能因为 Memory 内容被自动改变。若 Memory 提供了与当前事实冲突的内容，它只能作为待验证输入，不能成为覆盖事实的命令。

### 2.4 Knowledge is Per Character

系统必须区分：

```text
系统知道
玩家角色知道
NPC A 知道
NPC B 知道
未知
传闻
推测
```

客观事实与人物认知必须分开存储。Fact 表示世界实际上是什么，CharacterKnowledge 表示某个角色对某条 Fact 的认知状态、来源和置信度。

NPC 只能获得其知识权限允许进入 Context 的信息。这个边界最终必须由程序实现，不能依赖一句 Prompt：“NPC 不要知道自己不该知道的东西。”

### 2.5 LLM Proposes, Engine Validates

LLM 不能直接修改数据库。正确流程是：

```text
玩家输入
→ 获取世界状态
→ 获取相关 Lore
→ 获取人物可知信息
→ LLM 提出 Candidate Events / State Delta
→ Validator 校验
→ Commit
→ 更新世界状态
```

LLM 负责提出可能发生的变化和叙事意图；World Engine 负责决定变化是否合法、是否有来源、是否与当前状态和不变量冲突。未通过校验的候选结果不得产生事实副作用。

### 2.6 Narrative is a View of State

剧情文本不是事实源。正确方向是：

```text
先确定发生了什么
→ 提交世界事件与状态
→ 再生成叙事
```

禁止：

```text
先让 LLM 自由写故事
→ 再从故事里猜世界发生了什么
```

Narrator 只能文学化已经确认的事件和状态。叙事中的修辞、视角、未确认猜测不能自动成为世界事实；如果文本需要声明新的重大事实，必须回到 Simulation → Validation → Commit 流程。

### 2.7 World Continues Without Player

玩家不是世界中心。后台事件、NPC 和势力可以继续发展，即使玩家没有参与或拒绝介入。

但是“世界不围绕玩家”不等于“所选世界与玩家永久无关”。玩家行动能够改变世界，世界已有事件也能够自然作用于玩家。后台推进必须同样经过事件记录和状态校验，不能因为玩家当前不在场就跳过因果链。

### 2.8 Player Choice Matters

玩家的重要决定必须产生真实状态变化。A/B/C/D 等剧情分支不能是假选择。

不同选项至少应该改变以下一项：

- 信息；
- 关系；
- 风险；
- 地点；
- 势力；
- 资源；
- 事件走向；
- 长期因果。

如果某个选项在世界状态、角色认知和后续事件上都不产生差异，就不应把它伪装成有意义的分支。

## 3. Invariants

以下是不变量。任何产生状态 Delta 的路径，包括玩家行动、后台事件、脚本和 LLM 候选，都必须经过这些规则的检查：

- 已确认死亡角色不得无因复活；
- 角色不得无来源瞬移；
- NPC 不得获得无来源秘密；
- 已发生重大事件不得被后续文本直接抹除；
- 玩家拒绝事件不代表后台事件停止；
- 重大关系变化必须可追溯；
- 重大世界状态变化必须有 Event；
- Memory 不得直接覆盖 Truth；
- Narrative 不得直接 Commit 状态；
- 不允许两个互相矛盾的当前事实同时有效。

“有因”或“有来源”必须能指向合法的已提交事件、明确的初始设定或可审计的系统规则，而不是只存在于一段不可验证的自由文本中。

## 4. 权威边界与职责

| 层 | 负责什么 | 不负责什么 |
| --- | --- | --- |
| Canon / Lore | 世界背景、初始规则、设定约束 | 不自动证明运行时事件已经发生 |
| World State | 当前时间、位置、存活状态、持有物等物化状态 | 不替代事件因果记录 |
| Event Log | 记录已提交的变化、原因和参与者 | 不把未校验的模型输出当成事件 |
| Character Knowledge | 记录每个角色对事实的认知 | 不改写客观 Fact |
| Memory | 召回经历、印象和长期模式 | 不作为 Truth 或权限绕过 |
| Simulation LLM | 提出候选事件、状态 Delta 和推演 | 不直接写入数据库 |
| Validator | 检查权限、来源、规则、不变量和冲突 | 不负责文学化叙事 |
| Narrator | 将已确认结果呈现给玩家 | 不从文本直接提交世界状态 |

## 5. 提交语义

一次有效的世界推进应尽可能具有以下边界：

1. 读取同一版本或同一逻辑时点的 World State、Lore、CharacterKnowledge 和 Relevant Memory；
2. 产生候选事件和候选 State Delta；
3. 验证所有引用的角色、地点、物品、知识来源和因果关系；
4. 将通过校验的事件追加到 Append-only Event Log；
5. 根据事件更新 Materialized State；
6. 更新受影响角色的 CharacterKnowledge 和 Memory 索引（若适用）；
7. 基于已提交结果生成 Narrative。

如果任一关键候选无法校验，整次事实提交应失败或进入明确的待处理状态，不能部分写入后再让叙事文本掩盖不一致。

## 6. MVP 范围

第一阶段只证明核心世界状态能稳定运行。明确不实现：

- 每 NPC 一个 Agent；
- 多世界并行；
- 腾讯 Agent Memory 深度绑定；
- 复杂 RAG；
- 插件市场；
- 多人游戏；
- 复杂数值 RPG；
- 大规模经济模拟。

MVP 的最小验证对象是：一个世界、一个玩家、少量 NPC 和一条后台事件链，连续运行 30～50 轮后，事实、时间、位置、人物认知和因果仍然一致。

## 7. 变更纪律

后续新增模块必须明确回答：

- 它读取哪一层数据；
- 它是否能够提出状态变化；
- 它通过哪个 Validator 入口；
- 它由哪个 Event 解释；
- 它是否会扩大某个角色的知识边界；
- 它是否可能绕过 Database is Truth。

任何无法回答以上问题的功能，暂不进入核心运行链路。
