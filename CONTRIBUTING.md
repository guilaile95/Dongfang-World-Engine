# Contributing

当前工作在 `greenfield/owner-reset` 上，服从 [#68 Owner Greenfield Reset](https://github.com/guilaile95/Dongfang-World-Engine/issues/68)。

不要恢复旧 Production Runtime、Closed Inn Proposal-menu、或 #65/#66/#67。不要为旧测试或 CI 保留兼容层。

优先围绕当前 slice：

- 提交门（candidate → authorize → 事务 → event → projection）
- Fact / Claim / Knowledge / Memory 分层
- Visibility-before-Relevance
- 本地单文件世界
- 前景场景不写世界

跨会话恢复从 [`AGENTS.md`](AGENTS.md) 开始。执行纪律见 [`docs/OPERATING_RULES.md`](docs/OPERATING_RULES.md)。交接文本不得保存 API Key、凭证、Raw Prompt、Raw Provider Response 或 hidden reasoning。

一次实验一个变量。失败实验不重抽成同一次。LLM 调用必须记下 usage。当前最大阻塞未解除时，不要做不能解除它的工作。
