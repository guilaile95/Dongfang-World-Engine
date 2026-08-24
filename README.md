# 东方狂想 / Dongfang World Engine

给自己玩的、本地优先的 AI 文字世界模拟器。推理走云端强模型；世界留在本机一个文件里。

> **Engine constrains consequences, not imagination.**
> **The world does not orbit the player.**

玩家只打自然语言。引擎藏在聊天后面：约束可持久的后果，不把想象力收成动作表。

这不是酒馆前端，也不是旧 Production Runtime 的续写。Owner Greenfield Reset：**[#68](https://github.com/guilaile95/Dongfang-World-Engine/issues/68)**。

## 当前骨架

Step 3 组合结论之后才选了运行时，见 [`docs/RUNTIME_CHOICE.md`](docs/RUNTIME_CHOICE.md)：

- **TypeScript + Node 22 + Zod**（不是因为旧仓库是 TS）
- 聊天 ADAPT：[Vercel AI SDK](https://github.com/vercel/ai) + `@ai-sdk/openai-compatible`（Apache-2.0）
- 本地世界：SQLite / `better-sqlite3` 单文件
- 没有 Pydantic、LiteLLM、第二套 Schema framework

产品规格：[`docs/PRODUCT.md`](docs/PRODUCT.md)  
组合架构：[`docs/MINIMAL_COMPOSITION.md`](docs/MINIMAL_COMPOSITION.md)  
恢复入口：[`AGENTS.md`](AGENTS.md)、[`docs/CURRENT_STAGE.md`](docs/CURRENT_STAGE.md)

## 本机运行

```powershell
npm ci
copy .env.example .env
# 在 .env 里填 DWE_LLM_API_KEY 和 DWE_LLM_MODEL，不要把真实 key 提交进 Git
npm run play
```

或直接设环境变量：

```powershell
$env:DWE_LLM_BASE_URL = "http://localhost:10100/v1"
$env:DWE_LLM_API_KEY = "your-key"
$env:DWE_LLM_MODEL = "your-model"
npm run play
```

提示符是 `>`。输入自然语言。`:quit` 退出。权威世界默认在 `data/local/world.sqlite`，关档再开仍是同一世界。

API Key **只**来自环境变量或平台凭证。不要写进代码、fixture、日志或模型 trace。

```powershell
npm test
npm run typecheck
npm run build
```

## 目录（按职责，不按来源项目名）

```text
app/
  cli.ts                 临时玩法入口
  session.ts             openWorld / playTurn / close
  config.ts              只读 DWE_* 环境变量
  secrets.ts             脱敏；禁止把 key 打进日志
  authority/             提交门：candidate → 校验 → 事务 → 事件 → 投影
  persist/               一个本地 SQLite 文件
  world/                 手写最小世界 + 每回合一次独立推进
  visibility/            先可见性，再打包给模型
  chat/                  AI SDK 场景适配；前景不写世界
test/                    针对本 slice 的证明
```

没有 `openviking_adapter/`、`worldx_style/`、`qingjiao_pattern/` 这类来源目录。

LLM 输出即使通过 Zod 也不是 Truth。`llm` 不能 `fact_assert`、不能授予知识、不能拨时间。拒绝的写入不留半截状态。

## 明确不是

- 不是 SillyTavern / Risu 克隆
- 不是旧 Closed Inn Proposal-menu 路径（不要 merge #65 / #66 / #67）
- 不是 Production Runtime；本目录只承担当前 Vertical Slice
