# World Engine Data Model

本文档描述“数据库应该如何表示一个世界”的概念模型。它只冻结实体、权威边界和关键关系，不在 MVP 阶段提前设计完整 SQL Migration、索引方案或供应商专属能力。当前 Commit Kernel 的物理实现使用 SQLite + Drizzle ORM。

核心原则：当前状态便于读取，Append-only Event Log 解释状态如何形成；客观 Fact 与每个角色的 CharacterKnowledge 分离；Memory 是可替换的召回接口，不是 Truth。

## 1. 建模约定

- 所有世界运行时实体都必须能归属到一个 `world_id`，除非它明确属于全局 Lore 或系统配置；
- 重大变化优先通过 Event 表达，再由事件更新物化的当前状态；
- `valid_from` / `valid_to` 表达事实在世界时间线上的有效区间，不等同于数据库写入时间；
- `created_at` 表达系统记录时间，便于审计，不替代 `event_time`；
- 候选状态 Delta 不是事实记录，只有通过 Validator 并 Commit 后才进入事实层；
- 具体字段可以扩展，但不能破坏 Fact、CharacterKnowledge、Event 三者的权威分工。

## 2. 核心实体

### 2.1 World

表示一个可持续运行的世界。

```text
World
  id
  name
  current_time
  era
  status
```

`current_time` 是世界时间，不应仅由聊天轮次推断；`status` 至少需要能区分可运行、暂停或结束等生命周期状态。后续可扩展时间推进规则、日历和世界级配置。

### 2.2 Character

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

### 2.3 Location

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

### 2.4 Fact

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
  source_type
```

`subject`、`predicate`、`object` 可以先保持概念级表示，不在此阶段锁定具体序列化格式。`source_event_id` 应能指向产生该 Fact 的已提交 Event；初始 Lore Fact 可以使用 `source_type = initial_lore` 且没有事件来源。Fact 是已确认的客观世界事实，因此不设置 `confidence`；不确定性属于 CharacterKnowledge、Lore / Claim 或 Candidate Event。

同一事实在时间线上发生变化时，应保留可解释的历史，而不是直接抹掉旧事实。对于互斥谓词，当前有效区间不能同时存在互相矛盾的记录。

### 2.5 CharacterKnowledge

这是核心隔离表，表示某个角色对某条 Fact 知道多少，而不是表示 Fact 本身是否成立。

```text
CharacterKnowledge
  character_id
  fact_id
  knowledge_state
  source
  learned_at
  confidence
```

`knowledge_state` 可以考虑以下概念状态：

```text
unknown
rumor
suspected
believed
confirmed
```

但 MVP 不应过早把枚举设计死。关键是保留“认知状态”和“认知来源”，使系统可以表达一个角色不知道、听说、怀疑、相信或确认某件事。

角色知识可以由亲历事件、他人告知、文件、观察或传闻产生。每种来源都需要由事件、权限规则或初始设定支持，NPC 不能通过 LLM 上下文意外获得不应知道的 Fact。

### 2.6 Event

Event 是 Append-only 的已提交世界事件，用来回答“世界为什么变成现在这样”。

```text
Event
  id
  world_id
  sequence（物理层提交序号）
  event_time
  type
  location_id
  actor_ids
  target_ids
  cause_event_ids
  payload
  created_at
```

`actor_ids`、`target_ids` 和 `cause_event_ids` 表达事件参与者、受影响对象和因果链；`payload` 保存该事件所需的结构化细节。重大状态变化不能只存在于 `payload` 的自由文本中，必须能被状态更新器和审计逻辑识别。

Event 一旦 Commit，不应被后续叙事直接修改或删除。物理层使用内部 `sequence` 保留提交顺序，保证 Event Log 可以确定性重放。若发生纠正、撤销或反转，应追加新的、具有因果关系的 Event。

### 2.7 Relationship

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

### 2.8 Item / Asset

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

### 2.9 Session / Save

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

### 2.10 Memory

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

### 2.11 Lore / Canon（概念层）

Lore 是世界背景设定、初始规则和 Canon 约束，可以作为初始化来源或验证规则输入。它不等同于运行时 Event，也不自动证明某件运行时事件已经发生。

本阶段不为 Lore 预先拆分大量表；只需确保 Lore 的来源可以被识别，并能与 Fact 的 `source` 或初始状态建立关系。

## 3. 关键关系

```text
World
 ├── Character ──< CharacterKnowledge >── Fact
 ├── Location
 ├── Event ──< cause_event_ids >── Event
 ├── Relationship ──> Character + updated_by_event_id
 ├── Item / Asset ──> Character / Location
 ├── Session / Save ──> World + Player Character
 └── Lore / Canon

Event ──> 更新 ──> World / Character / Fact / Relationship / Item 当前状态
Event ──> 来源 ──> Memory
```

最重要的分离是：

```text
Fact = 客观事实
CharacterKnowledge = 某个角色对事实的认知
Memory = 可召回的经历或印象
Event = 已提交的变化及其因果
```

这些对象不能因为字段相似就合并成一张“万能记忆表”。

## 4. 数据所有权

| 数据 | 权威来源 |
| --- | --- |
| 当前时间 | World State |
| 人物是否存活 | Character / Event |
| 人物位置 | World State（由 Event 更新） |
| 已发生事件 | Event Log |
| 客观秘密 | Fact |
| NPC 是否知道秘密 | CharacterKnowledge |
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

写入边界如下：

- Context Builder 只读并按角色权限过滤上下文；
- Simulation LLM 只生成候选，不拥有事实写权限；
- Validator 负责检查来源、时间、位置、知识权限、关系约束和互斥事实；
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
5. 可追溯的 Fact 与 CharacterKnowledge；
6. 一条包含后台推进的 Event 链；
7. 至少一种 Relationship 或 Item 状态变化；
8. Session / Save 能定位恢复点；
9. Memory 只作为可替换召回接口；
10. 连续运行 30～50 轮后，可以从 Event 解释当前事实、时间、位置、人物认知和因果。

当前 Slice 已将 World、Character、Location、Fact、CharacterKnowledge、Relationship 和 Event 物理化到 SQLite，并实现六类 Candidate Event 的校验、事务提交、物化投影和事件重建。当前仍不绑定腾讯 Agent Memory 或其他 Memory Provider，不引入复杂 RAG、数据库外部服务或大规模模拟。
