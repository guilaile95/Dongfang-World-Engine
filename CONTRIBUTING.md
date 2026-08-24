# Contributing

当前项目仍处于 World Engine MVP 阶段。

在核心 authority chain 稳定之前，贡献应优先围绕：

- Candidate Event；
- Hard Validator；
- transactional Commit；
- Event Log；
- Materialized State；
- Character Knowledge；
- deterministic tests。

暂不接受以扩大范围为主的改动，例如复杂 UI、多 Agent、插件市场、大规模经济模拟或与某个具体第三方 IP 深度绑定的核心逻辑。

所有新增核心模块都应能回答：

1. 它读取哪一层数据；
2. 它是否提出状态变化；
3. 它经过哪个 Validator；
4. 它由哪个 Event 解释；
5. 它是否扩大某个角色的知识边界；
6. 它是否可能绕过 Database is Truth。

核心改动应通过 PR 进入 `main`，并附带对应自动化测试。

## 项目交接与恢复

跨模型 / 跨 Agent 接管时，不依赖聊天历史恢复工程状态。统一遵循 [`docs/PROJECT_HANDOVER_PROTOCOL.md`](docs/PROJECT_HANDOVER_PROTOCOL.md)：先从 live GitHub 的 `main`、Open Issues、Open PR、CI 与相关代码恢复 Current Engineering State，再按需读取 Notion 长期认知。

交接只传递恢复坐标、当前 Stage、Blocker 与核心不变量，不复制完整项目时间线，也不得在交接文本中保存 API Key、凭证、Raw Prompt、Raw Provider Response 或 hidden reasoning。
