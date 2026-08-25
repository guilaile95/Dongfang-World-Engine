# 执行守则

Owner 对后续任务的工程纪律。Agent 在动手前读本页。

本页是 **GitHub 上的执行规则**，不是产品 North Star（那是 [`PRODUCT.md`](PRODUCT.md)），也不是当前任务看板（那是 live GitHub + [`CURRENT_STAGE.md`](CURRENT_STAGE.md)）。

Notion 只保存其中会跨阶段仍然成立的**方法**；不在 Notion 复制本页全文或实验时间线。

---

## 权威顺序

1. **当前用户明确指令**
2. Owner Greenfield Reset（[#68](https://github.com/guilaile95/Dongfang-World-Engine/issues/68) + [`GREENFIELD_RESET.md`](GREENFIELD_RESET.md)）
3. live GitHub：代码、Issue、PR、Diff、测试、CI
4. Notion 上仍标记为当前的长期意图页
5. 归档 git / 历史文档（只当证据）
6. 历史聊天
7. 模型推测

当前用户指令 **大于** GitHub 与 Notion 的旧路线。Greenfield Reset 是新的 Owner 产品决策。旧代码和旧路线没有沉没成本权威；历史证据必须保留（archive tags / 不删 git history）。

**GitHub = Engineering Reality。** 代码、Issue、PR、Diff、测试、CI、实际工程状态以 live GitHub 为准。

**Notion = Durable Product Intent。** 保存 North Star、不变量、长期经验、重大阶段切换原因。不复制 GitHub 时间线。

---

## 组合与所有权

Compose-first。新的非平凡能力先检查本仓库、已有依赖、成熟外部方案，再决定 ADOPT / ADAPT / BORROW / OWN / DEFER。

**OWN 必须举证。**「自己写起来很简单」不是 OWN 的理由。

允许反向删除。已经完成的模块没有保护权。发现无价值、或成熟方案更好时，可以删除或替换，但保留 Git history。

---

## 证据与条件触发

证据驱动。所有条件触发步骤必须由 **真实玩法、测试、profiling 或成本数据** 触发。

前提条件必须可验证。触发条件必须是可检查的事实，不是主观判断。无法客观验证的条件不是有效触发条件。

不要机械执行完整 Roadmap。编号步骤大量是条件分支，不是「做到编号就必须开发」。

---

## 实验与验收

真实模型实验不重抽。实验开始后不得为了漂亮结果换 Prompt、换模型，或 reroll 后仍称为同一次实验。

实验失败就是失败。不允许用「再跑一次可能就好了」推迟修复。下一步是：分析失败日志 → 定位根因 → 最小修复 → **新实验**验证。

**一次实验一个变量。** 同时改两件事，结果只能归因于组合，无法单独定位。

Implementation ≠ Verification ≠ Product Acceptance。三者必须分开说，分开验收。

真实内容与测试 Fixture 分离：Product / integration / real-model acceptance 用真实世界资料；deterministic unit 与 adversarial tests 允许最小 synthetic fixture。

---

## 成本、日志、安全

成本前置。每增加一个 LLM 调用职责，立即测量真实 token 与 cost，并且 **必须把该调用的 usage 记完整**。调用了但没记账，等于没有测量。

失败日志的分辨率决定修复速度。一个笼统的错误枚举值不是日志，是黑箱。失败处理必须产出足够定位根因的结构化信息（字段路径、原因、截断后的非法载荷类别）。只记枚举、没有原因，这个错误处理本身就不完整。

安全底线。API Key 不进入 Git、日志、Prompt dump 或测试输出。任何涉及信息流的新模块都必须重新跑 Visibility regressions。

---

## 世界与叙事

Memory ≠ Truth。Memory、Summary、RAG、Embedding、retrieval 都没有世界真相权限。

Visibility before Relevance。概率系统只在合法信息池中工作。

Narrative is Projection。文学表达不能成为第二条写状态通道。

世界不围绕玩家。世界与 NPC 可以独立变化，但不代表所有 NPC 常驻调用 LLM。

---

## 产品优先与空转

每个重要 Slice 后重新问：

> 当前最大真实产品失败是什么？如果不修它，下一次实验还有没有价值？

**不空转。** 如果当前最大阻塞是解释层通路，任何不直接服务于打通解释层的工作都是空转。空转的定义不是没有产出，而是产出不能解除当前最大阻塞。

每次继续前检查 live state。新 Agent / 新对话按 `AGENTS.md`、`CURRENT_STAGE.md`、live GitHub、blocker 代码与测试、必要 Notion 恢复。不要求用户重新解释项目历史。

最终判断只有一个：当前工作是否真正让这个长期 AI 世界变得 **更自由、更连续、更可信、更好玩**。
