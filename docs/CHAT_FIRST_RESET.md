# Chat-first product reset

Owner unfreeze: GitHub [#66](https://github.com/guilaile95/Dongfang-World-Engine/issues/66) supersedes freeze [#63](https://github.com/guilaile95/Dongfang-World-Engine/issues/63).

Notion: [东方狂想｜Owner 解冻与 Chat-first 产品重置（2026-08-24）](https://app.notion.com/p/3c655152dfe88111aec7f6e4e21de009)

## Intent

Play as a web AI chat: freeform Chinese (or any) natural language, including off-plot daily life. Keep a local long-lived world so plot, facts, and rules survive process restart. The world must not orbit the player.

## Reuse

Play-path scene replies use **Vercel AI SDK** (`ai`, `@ai-sdk/openai-compatible`, Apache-2.0) `generateText` against `DWE_LLM_BASE_URL`. No greenfield HTTP client on the player path.

SillyTavern / RisuAI source is **not** vendored (AGPL/GPL vs this MIT repo).

SQLite + Drizzle + Zod + CommitKernel remain the durable world.

## Player path

`PlaySession.playTurn` does **not** map the player line onto seven Proposals. Mundane/off-plot lines are valid chat. An independent authored plot tick runs through CommitKernel before the scene reply.

## World does not orbit the player

Closed Inn dagger investigation advances on every in-world turn via `tickClosedInnWorld`, using authored NPC `claim.record` + `plot_stage` facts. The tick does not parse the player sentence.
