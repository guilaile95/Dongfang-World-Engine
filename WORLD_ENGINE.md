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
    World State + Lore + Claims + Character Knowledge + Relevant Memory
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

“数据库”首先表示事实权威层的概念边界；当前 Commit Kernel 使用 SQLite 承载这一层，但核心规则不依赖某个不可替换的数据库供应商。

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

客观事实、可疑命题和人物认知必须分开存储：`Fact` 表示世界实际上是什么，`Claim` 表示可能为真、为假、过时、不完整或未解决的命题，`CharacterKnowledge` 表示某个角色对某条 Claim 的认知状态与来源。Claim 不是 Truth，CharacterKnowledge 也不是 Claim 本身。

NPC 只能获得其知识权限允许进入 Context 的信息。这个边界最终必须由程序实现，不能依赖一句 Prompt：“NPC 不要知道自己不该知道的东西。”

当前 MVP 的知识来源必须是结构化 Provenance：

```text
character.learn_claim
  source = { kind: "character", characterId }
  或
  source = { kind: "event", eventId }
```

`character` 来源表示另一个角色把 Claim 告诉当前角色。Hard Validator 必须确认来源角色属于同一个 World、不是当前学习者，并且来源角色自身拥有该 Claim；来源角色的 `rumor` 可以传播为 `rumor`，不要求来源状态为 `confirmed`。

Step 2.5 的 MVP 使用精确状态复制规则：`character` 来源的 `knowledgeState` 必须与来源角色当前关于该 Claim 的 CharacterKnowledge 完全相同，不能借传播事件静默升级或降级认知状态。传播 Event 本身是审计记录，但不会因为出现在数据库中就向其他角色广播 Claim。

`event` 来源表示当前学习者从亲自参与或观察到的 Event 中获得 Claim。Hard Validator 必须确认来源 Event 属于同一个 World、`eventTime` 不晚于学习 Event、学习者存在于来源 Event 的 `actorIds` 或 `targetIds`，并且来源 Event 的结构化载荷确实关联目标 Claim。只有 `claim.record` 或另一个 `character.learn_claim` Event 可以作为 Claim 的 Event provenance；Fact 的存在、某个无关的 `fact.assert` Event 或数据库中的传播记录，都不能自动授予其他角色 Claim。

当来源 Event 是 `character.learn_claim` 时，来源载荷中的 `knowledgeState` 还必须与当前 Candidate 完全相同；这条规则防止通过引用旧的 `rumor` 学习 Event 静默升级为 `confirmed`，也防止静默降级。

Candidate 的知识状态在当前 MVP 限定为 `unknown`、`rumor`、`suspected`、`believed`、`confirmed`。Seed State 可以包含没有匹配 Fact 的 Claim，也可以包含引用 Claim 的初始 CharacterKnowledge；初始记录使用 `source_type = initial`，但必须指向该 World 的可审计 Seed 身份。`claim.record` 只持久化命题，不创建或修改 Fact。

`SqliteWorldStore.seedWorld()` 在写入前确定性验证 Seed、World、Location、Character、Fact、Claim、PredicatePolicy、CharacterKnowledge 和 Relationship 的 World 归属；Knowledge 的 Character/Claim 引用必须来自同一 Seed Input，存在的 `source_seed_id` 必须指向当前 Seed。任何失败都返回稳定的 `SEED_INVALID`，并且整个 Seed transaction 不产生部分写入。

Seed 内嵌引用也必须可解析且同世界：Character 的 `locationId`、Location 的 `parentId`、Fact/Claim 的 `subject`（Character、Location 或当前 World），以及 Relationship 的 `updatedByEventId`。未知或跨世界引用同样以 `SEED_INVALID` 拒绝。

Step 2.6 的硬边界是：

```text
Fact != Claim
Claim != CharacterKnowledge
Memory != Fact / Claim / CharacterKnowledge
```

因此错误传闻、误解和未经证实的命题可以安全存在于 Claim 层，而不会污染客观 Fact 层。当前阶段不实现 Claim 的自动真值解析、推理、欺骗、对话或信任评分。

### 2.5 Fact Predicate Policy

同一 World 可以为谓词配置确定性的 Fact cardinality：

```text
one   = 同一 subject + predicate 的不同 object 在重叠有效区间内互斥；
many = 同一 subject + predicate 可以同时拥有多个 object。
```

配置持久化在 World 级 `PredicatePolicy` 中，不引入 DSL。没有配置或配置值未知时，Hard Validator 和 Projector 都采用保守的 `one` 策略。`one` 策略保留时间转移行为：较晚有效时间的新 Truth 可以关闭较早的开放 Truth；`many` 策略不会替不同 object 自动关闭 `valid_to`。

### 2.6 LLM Proposes, Engine Validates

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

本阶段的 Validator 必须是 **Hard Validator**：

```text
Hard Validator
= 确定性代码
+ 数据约束
+ 明确世界不变量
```

Hard Validator 不调用 LLM，不依赖自然语言判断，并且对相同的输入状态和 Candidate Event 给出相同结果。

未来可以增加 **Soft Validator**，用于语义检查、警告和补充判断。但 Soft Validator 永远不能授权违反 Hard Validator 的状态变化。

### 2.7 Narrative is a View of State

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

### 2.8 World Continues Without Player

玩家不是世界中心。后台事件、NPC 和势力可以继续发展，即使玩家没有参与或拒绝介入。

但是“世界不围绕玩家”不等于“所选世界与玩家永久无关”。玩家行动能够改变世界，世界已有事件也能够自然作用于玩家。后台推进必须同样经过事件记录和状态校验，不能因为玩家当前不在场就跳过因果链。

### 2.9 Player Choice Matters

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

### 2.10 Context Builder MVP

当前 Context Builder 是只读的观察者视图，不是事实写入入口。`buildCharacterContext({ worldId, observerCharacterId, budget })` 只读取同一 World 的物化状态和 Event Log，并按以下顺序工作：

```text
World Data
→ observer-specific visibility gate
→ legal visible pool
→ deterministic unit packing
→ structured Context
```

它始终返回 World envelope、观察者自身状态和当前位置（若有）；可选内容只包括观察者自己的 `CharacterKnowledge + Claim + minimal provenance` causal bundle、同地点角色的安全公共投影，以及 `sourceCharacterId == observerCharacterId` 的有向关系。预算是可配置的 MVP context-unit 上限，visibility filtering 必须先于 truncation；core envelope/self/location 不被截断，Knowledge bundle 不会拆开。

Context Builder 不读取或输出一般 objective `Fact`，不通过 `(subject, predicate, object)` 将 Claim 与 Fact 连接，也不输出其他角色的 CharacterKnowledge、`currentGoal`、`identity` 或反向关系评价。Event provenance 最多带已记录的 source id、Event type 和 Event time，不带 raw payload、actor list、target list 或无关 Event 数据。跨 World 的 observer/world 引用必须确定性拒绝；构建过程不得追加 Event、改变 State 或推进 World revision。

任何未来的概率相关性排序都必须在上述确定性 visibility gate 之后运行；本 Slice 不实现概率 reranking、Embedding、RAG 或 LLM。

### 2.11 Simulation Adapter MVP

Simulation Adapter 是 Context Builder 之后的非权威模型边界。它只接收已经过滤的 `CharacterContext`、与 observer 相同的 actor identity 和 intent，并通过可注入的 Model Client 产生 0..N 个有序 Proposal；它不能访问 `SqliteWorldStore`、原始 `WorldSnapshot` 或隐藏 Truth，也不能调用 `CommitKernel.commit()`。

Proposal 只描述六类 actor-supported Candidate 类型的非权威草案；actor 模型暂不拥有 `fact.assert` 能力，即使 Kernel 为 trusted/system producer 保留该 Candidate capability。模型不得提供 `worldId`、`expectedWorldRevision`、`occurredAt` 或 `causeEventIds`；这些 Event envelope/provenance 字段由未来 Turn Orchestrator 在每次提交前绑定。`world.time_advance.toTime` 仍是可提议的 Effect 字段，不等同于 `occurredAt`。Adapter 对模型输出执行严格确定性 Zod 校验，结构错误最多触发一次 repair，transport/provider 错误不进入无限重试；无论成功、解析失败还是 transport 失败，都不能写入 Event、Materialized State 或 World revision。

Model-facing contract 不是一句模糊的“使用六类 Proposal”，而是 provider-agnostic 的明确输出协议：顶层只能是 `{ "proposals": [...] }`，允许 `{ "proposals": [] }`，禁止 code fence、解释文本和额外字段，并逐项列出 `character.move`、`character.die`、`character.learn_claim`、`relationship.change`、`claim.record`、`world.time_advance` 的必需/可选字段。`actorId` 或 `sourceCharacterId` 必须匹配 `context.observer.id`；`relationship.change` 至少包含一个合法 change field；`character.learn_claim.source` 只能是 character 或 event 结构。Schema failure 的 repair feedback 只暴露固定上限内的 issue path、code、message；JSON parse failure 和 actor authority failure 使用明确、可执行的短原因，不暴露 raw model output、prompt、provider response、API Key 或 hidden reasoning。

### 2.12 Turn Orchestrator MVP

Turn Orchestrator 是从非权威 Proposal 到权威 Commit 的最小运行桥接层。调用方只提供 `worldId`、`actorCharacterId`、intent 和可选 Context budget；Orchestrator 自己通过 Context Builder 构造观察者上下文，再把上下文交给 Simulation Adapter。调用方和模型都不能提供用于执行的任意 raw Context。

模型 Proposal 仍不是 Candidate Event，也不能控制 Event envelope。Orchestrator 在每次提交前绑定：

- 当前请求的 `worldId`；
- `expectedWorldRevision`；
- 普通 Proposal 的 `occurredAt = 当前权威 World.currentTime`；
- `causeEventIds = []`。

`world.time_advance.toTime` 仍由 Proposal 描述并由 Kernel 校验；成功推进后，后续 Proposal 使用新 Materialized State 的 `currentTime`。所有持久化变化必须经过现有 CommitKernel，Orchestrator 不直接写 Event、State 或 revision，也不能将 actor `fact.assert` 加回可执行 Proposal surface。

在首个 Proposal Commit 前，Orchestrator 会对完整 SimulationPlan 的每一项执行严格 schema 校验和 actor ownership 校验；任何后续项非法都会使整个 Turn 以 `proposal_invalid` 拒绝，且不会提交前面的合法项。Plan 还受确定性的 Proposal execution cap 约束（MVP 默认上限为 8，可通过 Orchestrator 配置覆盖）；超过上限返回稳定的 `PROPOSAL_LIMIT_EXCEEDED`，不产生 Event、State 或 revision 变化。

有序 Proposal 按 committed-prefix 语义执行：零 Proposal 返回 `empty`；全部成功返回 `success`；首项 Kernel rejection 返回 `rejected`；已有成功提交后停止并返回 `partial`，不回滚前缀、不继续后续 Proposal，也不自动创建 `action.failed` Event。下一项只使用本次前一项成功 Commit 返回的 revision，不会静默采用其他写入者产生的更新 revision。

由于 Simulation 是异步的，Orchestrator 在首个 Commit 前检查 Context revision；若 World 已变化，最多重建一次 Context 并重新 Simulation。第二次仍陈旧时返回稳定 stale 结果且不提交本轮 Event。首项发生 `STALE_WORLD_STATE` 也共享这一次重试额度；一旦已有 committed prefix，任何 stale 或其他 Kernel rejection 都只返回前缀，不自动重模拟。

### 2.13 Minimal Real-Model Transport and Headless Smoke

Step 6 的 real-model boundary 只实现一个窄的 OpenAI-compatible Chat Completions `SimulationModelClient`。它接收现有 `SimulationModelRequest`，把 `instructions` 放入 system message，把经过 Context Builder 的 `context` 与 intent 放入 user message，并只把 provider 返回的 assistant content 交回 Simulation Adapter。Transport 不读取 SQLite 或 raw `WorldSnapshot`，不构造 Context，不调用 CommitKernel，不解析或授权 Proposal，也不拥有 `fact.assert` 能力。

Transport 只负责一次 HTTP 请求、响应映射和一个小的 timeout safety setting。HTTP、network、timeout 或 malformed provider response 都以稳定 transport error 抛出；不实现 provider fallback、retry chain、复杂 backoff 或 provider-specific world logic。Simulation Adapter 仍独自拥有 JSON/Zod 解析和最多一次 repair，CI 使用 injected fake fetch，不调用真实模型。

`npm run smoke:real-model` 是开发者 opt-in 的单回合 headless smoke。它使用内存测试 World，经过正常 Context Builder、Simulation Adapter、Turn Orchestrator 和 Commit Kernel，最后只输出 status、rejection、提交 Event type/revision/time 和最终 World revision。需要 `DWE_LLM_BASE_URL`、`DWE_LLM_API_KEY`、`DWE_LLM_MODEL`，可选 `DWE_SMOKE_INTENT`；程序不会打印 API Key、原始 prompt、provider raw response 或 hidden reasoning。该 smoke 不属于 GitHub Actions CI。

### 2.14 Minimal Narrator and Narrative Projection

Narrative 是已提交 Turn 的 observer-scoped 展示投影，不是第二个 Simulation Engine，也不是事实写入入口。`NarrativeEnvelopeBuilder` 在 Turn 完成后为同一 actor、同一 World 重新构造 `CharacterContext`，并把本次 Turn 的 committed actor Event 转成显式 allowlist projection。它不使用 `TurnResult.state` 或 raw `WorldSnapshot`，不转发 raw Event payload、Event id、cause provenance、World revision、一般 Fact 或其他角色的私有 Knowledge/currentGoal/identity。

Narrator 只接收 `NarrativeEnvelope` 与明确的负边界指令，输出有界的 player-facing plain text。Narrator 不能访问 Store、SQLite、CommitKernel 或 mutation capability；`fact.assert` 等非 actor outcome 不进入 narrative projection。空 Turn 只能从 observer-visible context 描述观察/停顿；rejected、stale、partial 只能描述实际 committed prefix 与安全 rejection status。Narrative text 不持久化到 Event、World State 或 Truth 表。

Step 7 的 narrated smoke 使用同一个窄 OpenAI-compatible chat transport，经过 Simulation → Turn Orchestrator → Envelope → Narrator 的完整单回合链路。它是开发者 opt-in 的 real-model review gate，不属于 CI，不引入 provider router、fallback、第二个 critic 或复杂 retry。

## 3. Invariants

以下是不变量。任何产生状态 Delta 的路径，包括玩家行动、后台事件、脚本和 LLM 候选，都必须经过这些规则的检查：

- 已确认死亡角色不得无因复活；
- 角色不得无来源瞬移；
- NPC 不得获得无来源秘密；
- NPC 不得获得无来源 Claim；
- 已发生重大事件不得被后续文本直接抹除；
- 玩家拒绝事件不代表后台事件停止；
- 重大关系变化必须可追溯；
- 重大世界状态变化必须有 Event；
- Memory 不得直接覆盖 Truth；
- Narrative 不得直接 Commit 状态；
- 对 `PredicatePolicy = one` 的谓词，不允许两个互相矛盾的当前事实同时有效；`many` 谓词按显式策略允许多个不同 object 并存。
- Claim 的存在不得自动创建 Fact；Fact 的存在不得自动创建 CharacterKnowledge。

“有因”或“有来源”必须能指向合法的已提交事件、明确的初始设定或可审计的系统规则，而不是只存在于一段不可验证的自由文本中。

## 4. Persistent State Boundary

不是 Narrative 中的所有细节都进入数据库。只有会影响未来、需要可靠记忆或需要审计的内容进入 Persistent State。

必须持久化：

- 生死；
- 重大伤势；
- 重要位置变化；
- 身份；
- 关键物品；
- 重大关系变化；
- 获得或失去的重要 Fact；
- 角色获得或失去的重要 Claim 认知；
- 承诺；
- 任务；
- 重大决定；
- 世界事件；
- 其他会影响未来的状态。

通常不持久化：

- 喝水；
- 普通表情；
- 无后果动作；
- 临时景物；
- 普通桌椅；
- 纯文学修辞；
- 对未来没有影响的微小细节。

判断原则是：**如果未来剧情需要可靠地记住它，才进入 Persistent State。**

## 5. 权威边界与职责

| 层 | 负责什么 | 不负责什么 |
| --- | --- | --- |
| Canon / Lore | 世界背景、初始规则、设定约束 | 不自动证明运行时事件已经发生 |
| World State | 当前时间、位置、存活状态、持有物等物化状态 | 不替代事件因果记录 |
| Event Log | 记录已提交的变化、原因和参与者 | 不把未校验的模型输出当成事件 |
| Fact | 记录已确认的客观 Truth | 不表达角色的传闻或误解 |
| Claim | 记录可能为真、为假、过时、不完整或未解决的命题 | 不自动成为 Truth |
| Character Knowledge | 记录每个角色对 Claim 的认知 | 不改写客观 Fact，也不等同于 Claim |
| Memory | 召回经历、印象和长期模式 | 不作为 Truth 或权限绕过 |
| Simulation LLM | 提出候选事件、状态 Delta 和推演 | 不直接写入数据库 |
| Validator | 检查权限、来源、规则、不变量和冲突 | 不负责文学化叙事 |
| Narrator | 将已确认结果呈现给玩家 | 不从文本直接提交世界状态 |

## 6. 提交语义

一次有效的世界推进应尽可能具有以下边界：


1. 读取同一版本或同一逻辑时点的 World State、Lore、Claims、CharacterKnowledge 和 Relevant Memory；
2. 产生候选事件和候选 State Delta；
3. 验证所有引用的角色、地点、物品、知识来源和因果关系；
4. 将通过校验的事件追加到 Append-only Event Log；
5. 根据事件更新 Materialized State；
6. 更新受影响角色的 CharacterKnowledge 和 Memory 索引（若适用）；
7. 基于已提交结果生成 Narrative。

如果任一关键候选无法校验，整次事实提交应失败或进入明确的待处理状态，不能部分写入后再让叙事文本掩盖不一致。

每个 World 从 `revision = 0` 开始。Candidate 必须携带它读取到的 `expectedWorldRevision`；Hard Validator 只有在该值等于当前 World revision 时才继续。成功 Commit 为该 World 分配恰好递增 1 的 `worldRevision`，并在同一事务中追加 Event、投影状态、推进 World revision；失败或 Rollback 不增加 revision。过期 Candidate 返回 `STALE_WORLD_STATE`，且 Event Log、Materialized State 和 World revision 都不变。

Event identity 有三个不同语义：

- `sequence`：数据库级物理追加顺序，用于全局审计和确定性读取；
- `worldRevision`：单个 World 的状态版本，每个成功 Event 恰好增加 1；
- `eventTime`：事件在世界时间线中的发生/提交时间。

因此同一 `eventTime` 可以有多个 Event；它们仍按 `sequence` 提交，并拥有不同的 `worldRevision`。`World.currentTime` 对每个成功 Event 都执行 `max(previousWorldTime, event.eventTime)`，`world.time_advance` 不是唯一的时钟推进入口。

Commit 必须在同一个 SQLite 事务中完成：

```text
Validate
↓
BEGIN TRANSACTION
↓
Append Event
↓
Project Materialized State
↓
Update Knowledge / Relationship / World revision 等派生状态
↓
COMMIT
```

任意一步失败都必须 Rollback，不能出现“角色已经移动但 Event 写入失败”或“Event 已写入但当前状态未更新”的半提交状态。

已提交 Event 是 Append-only：不得 UPDATE 核心内容，不得 DELETE；纠正或逆转必须追加具有因果关系的新 Event。Event Log 对外读取必须暴露 `sequence` 和 `worldRevision`，便于审计、调试和重放。

世界时间规则如下：

- 每一个成功 Commit 的 Event 都推进 `World.current_time = max(previousWorldTime, event.eventTime)`；
- `world.time_advance` 仍用于没有其他事件发生但世界时间继续流逝的情况，不是唯一的时钟推进入口；
- Hard Validator 拒绝 `eventTime < currentWorldTime`；
- `cause_event_ids` 引用的 Event 时间不得晚于当前 Candidate 的 `eventTime`；
- Knowledge 的 `event` 来源时间不得晚于 `character.learn_claim` 的 `eventTime`；
- `sequence` 只表示提交顺序，`eventTime` 表示世界内时间，二者不等价；
- `fact.assert.validFrom` 可以描述历史有效时间，但不能让 World Clock 倒退。

当前 MVP 只支持单一权威时间线。Session / Save 不实现从旧存档分叉新时间线；未来如需分支，单独设计 `Branch`、`parent_branch`、`fork_event` 和 `head_event`。

当前 Commit Kernel 已实现以下 Candidate Event：`character.move`、`character.die`、`character.learn_claim`、`relationship.change`、`fact.assert`、`claim.record`、`claim.transmit` 和 `world.time_advance`。Candidate 先经过 Zod Schema，再进入确定性的 Hard Validator；未通过校验的 Candidate 不产生事实副作用。初始状态保留为 Seed + Event Log → Materialized State 的双层模型，不把整个 Seed 转换为 Event 链；初始 Fact、Claim 和 CharacterKnowledge 通过 `source_seed_id` 指向 Seed。Item、Session / Save 的物理实现和其他事件类型暂不在本 Slice 内。

## 7. MVP 范围

第一阶段只证明核心世界状态能稳定运行。明确不实现：

- 每 NPC 一个 Agent；
- 多世界并行；
- 腾讯 Agent Memory 深度绑定；
- 复杂 RAG；
- 插件市场；
- 多人游戏；
- 复杂数值 RPG；
- 大规模经济模拟。

MVP 的最小验证对象是：一个世界、一个玩家、少量 NPC 和一条后台事件链，连续运行 30～50 轮后，事实、时间、位置、人物认知和因果仍然一致。当前 Commit Kernel 已用 90 个合法与非法 Candidate Event 的混合测试证明没有半提交状态，并且关键状态可以由初始 Fixture 加 Event Log 重建。

## 8. 变更纪律

后续新增模块必须明确回答：


- 它读取哪一层数据；
- 它是否能够提出状态变化；
- 它通过哪个 Validator 入口；
- 它由哪个 Event 解释；
- 它是否会扩大某个角色的知识边界；
- 它是否可能绕过 Database is Truth。

任何无法回答以上问题的功能，暂不进入核心运行链路。
