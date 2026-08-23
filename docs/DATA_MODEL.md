# World Engine Data Model

本文档描述“数据库应该如何表示一个世界”的概念模型。它只冻结实体、权威边界和关键关系，不在 MVP 阶段提前设计完整 SQL Migration、索引方案或供应商专属能力。当前 Commit Kernel 的物理实现使用 SQLite + Drizzle ORM。

核心原则：当前状态便于读取，Append-only Event Log 解释状态如何形成；客观 Fact、非权威 Claim 与每个角色的 CharacterKnowledge 分离；Memory 是可替换的召回接口，不是 Truth。

## 1. 建模约定

- 所有世界运行时实体都必须能归属到一个 `world_id`，除非它明确属于全局 Lore 或系统配置；
- 重大变化优先通过 Event 表达，再由事件更新物化的当前状态；
- `valid_from` / `valid_to` 表达事实在世界时间线上的有效区间，不等同于数据库写入时间；
- `created_at` 表达系统记录时间，便于审计，不替代 `event_time`；
- 候选状态 Delta 不是事实记录，只有通过 Validator 并 Commit 后才进入事实层；
- 具体字段可以扩展，但不能破坏 Fact、Claim、CharacterKnowledge、Event 四者的权威分工。

## 2. 核心实体

### 2.1 World

表示一个可持续运行的世界。

```text
World
  id
  name
  current_time
  revision
  era
  status
```

`current_time` 是世界时间，不应仅由聊天轮次推断；`revision` 从 `0` 开始，每个成功 Commit 的 Event 恰好推进一个版本；`status` 至少需要能区分可运行、暂停或结束等生命周期状态。Candidate 必须携带 `expected_world_revision`，过期 Candidate 以 `STALE_WORLD_STATE` 拒绝且不产生副作用。后续可扩展时间推进规则、日历和世界级配置。

### 2.2 Seed

Seed 是初始世界状态的可审计来源。MVP 保留 Seed State + Append-only Event Log → Materialized State 的模型，不把整个初始世界转换为 Event 链。

```text
Seed
  id
  world_id
  source_type
  source_ref
  metadata
```

初始 Fact、Claim 和 CharacterKnowledge 必须通过 `source_seed_id` 指向该 World 的 Seed；这使初始设定不会退化为没有来源的 `initial` 标签。当前阶段不实现 World Pack loader。

`SqliteWorldStore.seedWorld()` 会在事务写入前确定性检查所有 Seed Input 的 World 归属。CharacterKnowledge 的 `character_id`、`claim_id` 必须分别属于当前输入的 Character、Claim，非空 provenance 必须指向当前 Seed / World；Relationship 两端也必须属于当前 Character 集合。失败使用稳定的 `SEED_INVALID`，不会留下部分 Seed 状态。

同一校验还覆盖嵌入引用：Character 的 `location_id`、Location 的 `parent_id`、Fact/Claim 的 `subject`（同 World 的 Character、Location 或 World）以及 Relationship 的 `updated_by_event_id` 必须能解析到同一 Seed World；未知引用不依赖 SQLite FK 偶然失败。

### 2.3 Character

表示玩家角色、NPC 或其他具有身份与行动能力的角色。

```text
Character
  id
  world_id
  name
  type
  alive
  location_id
  identity
  personality
  current_goal
```

这些字段是 MVP 的最小稳定核心，不代表角色的全部属性。后续可以扩展外貌、能力、阵营、状态效果、秘密、计划等，但不应为了未来可能的属性把所有内容提前固定成大量列。可变属性应通过明确的扩展模型或事件载荷表达，并仍受 Validator 与 Event Log 约束。

`alive`、`location_id` 和 `current_goal` 是当前物化状态；它们的重大变化必须能回溯到 Event。

### 2.4 Location

表示角色、物品和事件可以关联的空间节点。

```text
Location
  id
  world_id
  name
  parent_id
  type
```

`parent_id` 支持地点层级，例如大陆、城市、建筑和房间。角色位置变化不能只靠文本描述，必须有来源事件或明确的初始状态。

#### 2.4.1 LocationConnection

表示 Seed 声明的有向、World 内地点连接。当前 MVP 中，它同时表示“已暴露且当前允许直接选择的一步 movement transition”，不是完整的 physical topology。连接由 `world_id + from_location_id + to_location_id` 唯一确定；同一 World 内的地点不会因为存在于同一个 World 就自动互相可达，也不按角色单独维护移动白名单。

```text
LocationConnection
  world_id
  from_location_id
  to_location_id
```

Seed 校验必须确认连接两端都属于当前 Seed 的 Location 集合。`parentId` 只表示层级关系，不表示 adjacency。`character.move` 只能沿当前 Location 到目标 Location 的显式有向连接提交；Context Builder 只将当前地点的目标投影为稳定的 `{ locationId, name }` movement option。只有未来出现真实的 hidden/undiscovered passage 需求时，才拆分独立的 Visibility / Reachability 语义。

### 2.5 Fact

表示客观世界事实，即“世界实际上是什么”。

```text
Fact
  id
  world_id
  subject
  predicate
  object
  valid_from
  valid_to
  source_event_id
  source_seed_id
  source_type
```

`subject`、`predicate`、`object` 可以先保持概念级表示，不在此阶段锁定具体序列化格式。运行时产生的 Fact 使用 `source_event_id` 指向产生它的已提交 Event；初始 Lore Fact 使用 `source_seed_id` 指向审计 Seed。Fact 是已确认的客观世界事实，因此不设置 `confidence`；不确定性属于 CharacterKnowledge、Lore / Claim 或 Candidate Event。

同一事实在时间线上发生变化时，应保留可解释的历史，而不是直接抹掉旧事实。World 级 `PredicatePolicy` 将谓词定义为 `one` 或 `many`：`one` 的重叠不同 object 互斥并保留时间转移；`many` 允许不同 object 在同一有效区间并存；未配置谓词保守按 `one` 处理。

### 2.6 Claim

表示角色可能听到、相信、怀疑或记录的命题。Claim 是非权威的认识对象，可以为真、为假、过时、不完整或未解决；Claim 的存在不能证明对应 Fact 存在。

```text
Claim
  id
  world_id
  subject
  predicate
  object
  source_event_id
  source_seed_id
  recorded_at
```

`source_seed_id` 用于初始命题，`source_event_id` 用于运行时 `claim.record` 命题；两者至少有一个来源。当前不设置 `true` / `false` 状态，因为 Truth 仍只由 Fact 表达。`claim.record` 只持久化 proposition，不创建或修改 Fact。

### 2.7 CharacterKnowledge

这是核心隔离表，表示某个角色对某条 Claim 的认知状态，而不是表示 Claim 或 Fact 本身是否成立。

```text
CharacterKnowledge
  character_id
  claim_id
  knowledge_state
  source_type
  source_character_id
  source_event_id
  source_seed_id
  learned_at
```

`source_type` 的 MVP 值为：

```text
initial
character
event
```

Candidate Event 使用结构化来源：

```json
{ "kind": "character", "characterId": "character-zhao" }
```

或：

```json
{ "kind": "event", "eventId": "event-123" }
```

`character` 来源表示另一个角色把 Claim 告诉当前角色；Hard Validator 必须确认来源角色属于同一个 World，并且自身拥有该 Claim。来源角色的 `knowledge_state` 不要求是 `confirmed`，`rumor` 也可以传播 `rumor`。当前精确复制规则要求传播 Event 的状态与来源角色完全相同。`event` 来源表示当前角色实际参与了该 Event；Hard Validator 必须确认来源 Event 属于同一个 World、时间不晚于学习 Event、角色位于该 Event 的 `actor_ids` 或 `target_ids`，且 Event 的结构化载荷确实关联该 Claim。只有 `claim.record` 或 `character.learn_claim` Event 可以成为 Claim 的 Event provenance。

当 Event provenance 指向 `character.learn_claim` 时，来源载荷的 `knowledgeState` 必须与当前 Candidate 完全相同；不能通过引用旧的 `rumor` / `confirmed` 学习 Event 静默升级或降级。

Seed State 可以同时包含客观 Fact、没有匹配 Fact 的 Claim，以及引用 Claim 的初始 CharacterKnowledge。此时 `source_type = initial`，`source_character_id` 和 `source_event_id` 都为空，但 `source_seed_id` 必须指向 Seed。普通角色不能仅因为 Fact 存在、数据库中存在某个 `fact.assert` Event 或看到其他角色的传播记录就自动获得 Claim。

当前 MVP 的 `knowledge_state` 限定为以下状态：

```text
unknown
rumor
suspected
believed
confirmed
```

`character` provenance 的传播采用精确状态复制：学习 Event 请求的状态必须等于来源角色已有的状态，不能静默升级或降级。`event` provenance 只能来自同一 World、时间不晚于学习 Event、且学习者位于来源 Event 的 `actor_ids` 或 `target_ids`；Event 载荷必须关联目标 Claim。

角色知识可以由亲历事件、他人告知、文件、观察或传闻产生。每种来源都需要由事件、权限规则或初始设定支持，NPC 不能通过 LLM 上下文意外获得不应知道的 Claim。Fact、Claim、CharacterKnowledge 三者不合并为万能记忆表。

### 2.8 Event

Event 是 Append-only 的已提交世界事件，用来回答“世界为什么变成现在这样”。

```text
Event
  id
  world_id
  sequence（物理层提交序号）
  world_revision（World 内状态版本）
  event_time
  type
  location_id
  actor_ids
  target_ids
  cause_event_ids
  payload
  created_at
```

`sequence` 是数据库级物理提交顺序，`world_revision` 是该 World 的状态版本，`event_time` 是世界内时间；三者不是同一个概念。每个成功 Commit 的 Event 都分配恰好递增 1 的 `world_revision`，读取和调试必须暴露两个 identity 字段。`actor_ids`、`target_ids` 和 `cause_event_ids` 表达事件参与者、受影响对象和因果链；`payload` 保存该事件所需的结构化细节。重大状态变化不能只存在于 `payload` 的自由文本中，必须能被状态更新器和审计逻辑识别。

每一个成功 Commit 的 Event 都会使 `World.current_time = max(previous_current_time, event_time)`。因此 `world.time_advance` 不是唯一能够推动世界时钟的 Event；它用于没有其他事件发生但世界仍继续流逝的情况。`cause_event_ids` 中的 Event 时间不能晚于当前 Event；Knowledge 的 `event` 来源也不能晚于学习 Event。`fact.assert.valid_from` 可以描述历史有效时间，但不能让 World Clock 倒退。

Event 一旦 Commit，不应被后续叙事直接修改或删除。物理层使用内部 `sequence` 保留提交顺序，保证 Event Log 可以确定性重放。若发生纠正、撤销或反转，应追加新的、具有因果关系的 Event。

### 2.9 PredicatePolicy

表示 World 对 Fact 谓词的确定性基数策略。

```text
PredicatePolicy
  world_id
  predicate
  cardinality  // one | many
```

策略属于单个 World，持久化在 World State 边界内，不引入 DSL。未知或缺失策略默认 `one`，确保 Fact 冲突不会因为未配置而被放行。

### 2.9.1 FactAssertionRequirement

表示 Seed 声明的精确 Fact 断言前置条件。它是 World-scoped、Seed-static Authority State，不由 Candidate、Event 或 LLM 创建。

```text
FactAssertionRequirement
  world_id
  asserting_subject
  asserting_predicate
  asserting_object
  required_subject
  required_predicate
  required_object
```

关系按完整七元组唯一。`asserting_*` 精确匹配一个 `fact.assert` 的 proposition；同一 asserting 三元组的多行全部必须满足（AND），没有匹配行则不增加限制。每个 required 精确三元组必须在 asserting Candidate 的 `valid_from` 时点满足半开区间：`required.valid_from <= asserting.valid_from < required.valid_to`，其中开放 Fact 的 `required.valid_to = null`。

Seed validation 必须确认两个 subject 都是当前 Seed World 的 Character、Location 或 World，并拒绝跨 World、空 predicate/object 与重复关系。required Fact 不要求在 Seed 中已经存在，因为它可以由较早的合法 Event 产生。

该关系既阻止不满足前置条件的新 Fact assertion，也阻止 `PredicatePolicy = one` 的替换投影回溯关闭所需 Fact，从而让已由 Event 提交或本次待提交的匹配 assertion 在其 `valid_from` 时失去前置条件。检查只覆盖本次替换会直接关闭的精确 required Fact；Seed 初始 Fact 不会被追溯解释为曾经过 Candidate 前置校验，与现有依赖无关或发生在依赖断言之后的历史替换仍可提交。它不自动产生、撤销或重算 Fact，不支持 OR、NOT、递归、优先级或通用规则求值。`FACT_PRECONDITION_FAILED` 拒绝保持 Event、Materialized State 和 World revision 不变。

### 2.10 Relationship

表示角色之间的关系。不要只保存一个“好感度”，因为信任、敌意和亲近程度可能同时变化，且方向未必一致。

```text
Relationship
  source_character_id
  target_character_id
  trust
  hostility
  closeness
  relationship_type
  updated_by_event_id
```

关系必须有方向：`A → B` 与 `B → A` 是两条不同状态。关系方向、维度和单位可以后续扩展。重大关系变化必须指向 `updated_by_event_id`，不能由聊天文本或 Memory 直接覆盖。

### 2.11 Item / Asset

表示世界中的物品、资产或可被持有与转移的资源。MVP 先保持简单：

```text
Item / Asset
  id
  world_id
  name
  owner_id
  location_id
  status
```

所有权和位置通常互相约束。转移、丢失、损坏或销毁应通过 Event 解释，不能只修改 `owner_id` 或 `status`。

### 2.12 Session / Save

用于承载玩家当前所处的运行上下文和可恢复存档。

```text
Session / Save
  id
  world_id
  player_character_id
  save_point
  created_at
```

它至少支持：

- 当前玩家；
- 当前世界；
- 存档；
- 恢复。

当前 MVP 只有单一权威时间线，暂不实现 `branch_id` 或从旧存档恢复后创建新时间线。未来如需分支，单独设计 `Branch`、`parent_branch`、`fork_event` 和 `head_event`。Session / Save 是运行入口和恢复指针，不应成为另一套独立事实源。

### 2.13 Memory

Memory 只定义接口关系，不把某一种 Memory 实现写入世界事实模型。

```text
Memory
  provider
  owner_type
  owner_id
  source_event_id
  content_ref
  retrieval_metadata
```

未来可以由以下任一类 Provider 提供：

```text
BuiltIn Memory
TencentDB Agent Memory
Mem0
其他 Provider
```

World Engine 不应依赖某个特定 Memory 实现。Memory 的内容可以被召回、排序和注入上下文；它不能直接决定谁活着、谁在哪里、谁拥有什么、事件是否发生或 NPC 是否知道某个秘密。

### 2.14 Lore / Canon（概念层）

Lore 是世界背景设定、初始规则和 Canon 约束，可以作为初始化来源或验证规则输入。它不等同于运行时 Event，也不自动证明某件运行时事件已经发生。

本阶段不为 Lore 预先拆分大量表；只需确保 Lore 的来源可以被识别，并能与 Fact 的 `source` 或初始状态建立关系。

### 2.15 Context Builder（只读观察者视图）

Context Builder 不新增事实表，也不写入 Event、Materialized State 或 World revision。它从一个 World 的当前快照和 Event Log 构造结构化观察者上下文，包含 World envelope、observer 自身 Character、当前位置、当前地点显式连接到的安全 `movementOptions`、同地点角色的安全公共投影、observer 自己的 `CharacterKnowledge + Claim + provenance` causal bundle，以及 observer 作为 source 的有向 Relationship。

可见性过滤先于预算 packing。MVP budget 表示可选 context unit 的数量上限，不是固定 token 方案；core envelope、self、当前位置和 movement options 始终保留，Knowledge bundle 以完整因果单元参与截断。Context Builder 不输出一般 Fact，不通过 Claim 与 Fact 的字段匹配泄露 Truth，不合并其他角色的认知或隐藏 Character 字段，也不输出 raw Event payload、actor/target 列表或 raw LocationConnection topology。

确定性的 visibility gate 是后续任何概率相关性排序、Embedding、RAG 或 LLM 的前置边界；本 Slice 不实现这些能力。

### 2.16 Simulation Adapter（非权威 Proposal 视图）

Simulation Adapter 只接收 `CharacterContext + actorCharacterId + intent`，并通过可注入 Model Client 返回六类 actor-supported、结构化、有序的 Proposal 列表。Proposal 是待后续 Orchestrator 绑定并验证的草案，不是 Candidate Event，也不携带模型可控制的 `worldId`、`expectedWorldRevision`、`occurredAt` 或 `causeEventIds`；`world.time_advance.toTime` 仍是 Effect 字段。actor 模型暂不拥有 `fact.assert`，Kernel capability 不等于 actor-model capability；Adapter 不读取原始 Snapshot、Facts 或 SQLite Store，不执行 Commit。

模型输出先经过确定性 schema validation；system instruction 明确声明顶层 `{ "proposals": [...] }`、空 Proposal 合法、七类 Proposal 精确字段、actor ownership 和禁止的 authority 字段；`character.move.toLocationId` 必须从 `context.movementOptions` 选择。Malformed output 最多允许一次 repair；repair 只收到固定上限内的 schema issue path/code/message，或 invalid JSON / actor mismatch 的具体原因。第二次仍失败则返回包含最后安全 validation summary 的稳定 Adapter error，transport/provider failure 不进行 retry storm。revision 绑定、逐 Proposal 提交和读取新 revision 属于 Turn Orchestrator。

### 2.17 Turn Orchestrator（可信 Commit 绑定）

Turn Orchestrator 接收 `world_id + actor_character_id + intent`，自行调用 Context Builder 取得当前观察者视图，再调用 Simulation Adapter 取得非权威 Proposal。它不接受调用方提供的执行 Context，也不向模型暴露原始 WorldSnapshot、Store 或 CommitKernel。

Orchestrator 为每个 Proposal 在提交时绑定可信 envelope：`world_id`、当前 expected `world_revision`、普通事件的 `occurred_at = World.current_time` 和 `cause_event_ids = []`。`world.time_advance.to_time` 是唯一仍由 Proposal 描述的时间 Effect；提交成功后，后续 Proposal 使用提交返回 Snapshot 的新 `current_time`。下一项的 `expected_world_revision` 必须来自本轮前一项成功 Event 的 `world_revision`，不能从外部最新 revision 静默续接。

在首个 Commit 前，完整 Proposal plan 必须通过 actor Proposal schema 与 actor ownership 预校验；后续项出现 malformed、Kernel-only 类型或其他 actor attribution 问题时，整个 Turn 返回 `proposal_invalid`，不产生前缀写入。Plan 同时受确定性的 execution cap 约束，MVP 默认最多 8 项并允许通过 Orchestrator 配置覆盖；超过上限返回稳定 `PROPOSAL_LIMIT_EXCEEDED`，不改变 Event、State 或 World revision。

有序执行采用 committed-prefix 结果：零 Proposal 为 `empty`，全部成功为 `success`，首项失败为 `rejected`，前缀成功后失败为 `partial`。首个 Commit 前发现 stale 最多允许一次 Context 重建与重新 Simulation；再次 stale 则返回稳定 stale 结果且不提交本轮 Event。已有前缀后不自动重模拟、不回滚、不继续后续项，Kernel rejection 也不会隐式生成 `action.failed` Event。actor Proposal surface 仍不包含 `fact.assert`，即使 Kernel 对 trusted/system producer 支持该 Candidate。

### 2.18 Real-model transport（非权威模型连接）

Real-model transport 不新增 World 数据表或权威字段。它只是现有 `SimulationModelClient` 的一个 OpenAI-compatible HTTP 实现：`SimulationModelRequest.instructions` 进入 system message，`context` 与 `intent` 组成 user payload，provider 的 assistant content 原样交回 Simulation Adapter。Transport 不接触 raw Snapshot、SQLite、Event、State 或 revision，也不解析、授权或提交 Proposal。

HTTP/network/timeout/provider response 错误属于 transport boundary；模型 JSON 的解析、repair、actor Proposal surface 和权限仍由 Simulation Adapter 负责。真实模型调用只通过开发者 opt-in 的单回合 headless smoke 触发，CI 使用 fake fetch 并保持 credential-free、deterministic。该 Slice 不引入 provider router、fallback、复杂 retry、Memory、RAG 或 Narrative。

### 2.19 Narrative Envelope（非权威观察者投影）

Narrative Envelope 由 `TurnResult + Turn 完成后重建的 CharacterContext` 组成：`intent`、Turn status、observer-scoped Context、显式 committed outcome projections，以及只含 `kind/code` 的安全 rejection。它不从 `TurnResult.state` 读取数据，也不携带 raw WorldSnapshot、Store、CommitKernel、一般 Fact、其他角色的私有 Knowledge/currentGoal/identity、raw Event payload、Event id 或 cause provenance。

Narrator 只接收 Narrative Envelope 和 provider-agnostic narrative instructions，输出有界 plain text。文本属于展示层，不写入 Event、World State、Fact、Claim 或 CharacterKnowledge；空、rejected、stale、partial Turn 只能基于安全 Context、真实 committed prefix 和安全状态描述。Narrative projection 不增加任何 World authority。

### 2.20 Source-authored Claim Transmission（知识传播）

知识传播事件 `claim.transmit` 允许一个角色向同一地点的另一个角色传播其所掌握的 Claim：
- 传播必须由 source 角色发起（Proposal 校验 `sourceCharacterId === context.observer.id`）；
- Hard Validator 校验 source 角色持有该 Claim 的有效认知，且 source 与 target 均存活并处于同一 Location；
- Projector 精确复制 source 角色的 `knowledgeState` 到 target 角色的 `CharacterKnowledge`，并记录 `sourceType = "character"`、`sourceCharacterId` 与 `sourceEventId`；
- 知识传播绝不创建或修改客观世界 Fact，也不赋予 Claim 任何客观 Truth 权威；目标角色若已有更高确定性状态或冲突认知，受既有防回退与不变量规则约束。

## 3. 关键关系

```text
World
 ├── Seed
 ├── Character ──< CharacterKnowledge >── Claim
  ├── Location
  ├── LocationConnection ──> Location + Location
  ├── Event ──< cause_event_ids >── Event
 ├── Fact
 ├── FactAssertionRequirement ──> asserting Fact triple + required Fact triple
 ├── Relationship ──> Character + updated_by_event_id
 ├── PredicatePolicy
 ├── Item / Asset ──> Character / Location
 ├── Session / Save ──> World + Player Character
 └── Lore / Canon

Event ──> 更新 ──> World / Character / Fact / Relationship / Item 当前状态
Event ──> 来源 ──> Memory
Seed ──> 来源 ──> 初始 Fact / Claim / CharacterKnowledge
```

最重要的分离是：

```text
Fact = 客观事实
Claim = 可能为真、为假、过时、不完整或未解决的命题
CharacterKnowledge = 某个角色对 Claim 的认知
Memory = 可召回的经历或印象
Event = 已提交的变化及其因果
```

必须保持以下边界：`Fact != Claim`、`Claim != CharacterKnowledge`、`Memory != any of the above`。Claim 的存在不能创建 Fact；Fact 的存在不能自动创建 CharacterKnowledge。

这些对象不能因为字段相似就合并成一张“万能记忆表”。

## 4. 数据所有权

| 数据 | 权威来源 |
| --- | --- |
| 当前时间 | World State |
| World revision | World State / Commit Kernel |
| 人物是否存活 | Character / Event |
| 人物位置 | World State（由 Event 更新） |
| 移动可达性 | Seed LocationConnection（有向、World 内） |
| 已发生事件 | Event Log |
| 客观秘密 | Fact |
| 非权威命题 | Claim |
| NPC 对命题的认知 | CharacterKnowledge |
| Fact 基数策略 | PredicatePolicy |
| Fact 断言前置条件 | Seed FactAssertionRequirement |
| 初始 Fact / Knowledge 来源 | Seed |
| NPC 过去经历 | Event + Memory |
| 长期对话召回 | Memory |
| 世界背景设定 | Lore |
| 剧情文本 | 非权威展示层 |

“World State”在表格中表示当前的物化状态，通常由 World、Character、Location、Item 等实体承载；它不是独立于 Event Log 的第二个真相来源。

## 5. 数据流与写入边界

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

写入边界如下：

- Context Builder 只读并按角色权限过滤上下文；
- Context Builder 先执行确定性的 observer visibility gate，再进行有界 packing；它不产生任何事实写入；
- Simulation LLM 只生成候选，不拥有事实写权限；
- Validator 负责检查来源、时间、显式有向 LocationConnection、知识权限、关系约束、Claim 跨 World 引用、互斥事实，以及匹配 Seed `FactAssertionRequirement` 的有效前置 Fact；`one` 基数替换还必须在投影前检查其直接关闭不会回溯破坏既有断言的前置条件；
- Commit Event 是进入事实层的唯一入口；
- Materialized State 只能由已提交事件或初始化过程更新；
- Narrator 只能读取已确认结果并生成展示文本；
- Memory Provider 可以记录或索引经历，但不能绕过 Commit 修改事实。

## 6. MVP 建模边界

本阶段不提前设计几十张表，也不实现完整 SQL Migration。优先验证以下最小闭环：


1. 一个 World；
2. 一个玩家 Character；
3. 少量 NPC Character；
4. 少量 Location；
5. 可追溯的 Fact、Claim 与 CharacterKnowledge；
6. 一条包含后台推进的 Event 链；
7. 至少一种 Relationship 或 Item 状态变化；
8. Session / Save 能定位恢复点；
9. Memory 只作为可替换召回接口；
10. 连续运行 30～50 轮后，可以从 Event 解释当前事实、时间、位置、人物认知和因果。

当前 Slice 已将 World、Seed、Character、Location、LocationConnection、Fact、Claim、CharacterKnowledge、PredicatePolicy、FactAssertionRequirement、Relationship 和 Event 物理化到 SQLite，并实现 Candidate Event 的校验、事务提交、物化投影和事件重建。当前仍不绑定腾讯 Agent Memory 或其他 Memory Provider，不引入复杂 RAG、数据库外部服务或大规模模拟。
