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

跨 Chat / Codex / Grok / 其他开发 Agent 接管时，统一从仓库根目录 [`AGENTS.md`](AGENTS.md) 开始。

快速恢复路径：

```text
AGENTS.md
→ docs/CURRENT_STAGE.md
→ live GitHub main / Issues / PRs / reviews / CI
→ 当前 Stage 相关代码与测试
→ CURRENT_STAGE 指定的 Notion 长期页面（按需）
→ CURRENT ENGINEERING STATE
→ 继续当前最高优先级工作
```

不要依赖聊天历史，也不要要求用户重新解释项目。

`docs/CURRENT_STAGE.md` 只保存恢复坐标；当前工程事实始终以 live GitHub 为准。详细治理、交接和 Stop / Escalation 规则见 [`docs/PROJECT_HANDOVER_PROTOCOL.md`](docs/PROJECT_HANDOVER_PROTOCOL.md)。

交接文本不得保存 API Key、凭证、Raw Prompt、Raw Provider Response 或 hidden reasoning。
