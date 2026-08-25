import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createNpcVoice } from "./chat/npc.js";
import { configForLog, loadConfig } from "./config.js";
import { createModelClient, formatCallLine } from "./model/client.js";
import type { CallRecord } from "./model/types.js";
import { createNarrator } from "./narrator/client.js";
import { createModelInterpreter } from "./scene/interpreter.js";
import { openWorld } from "./session.js";
import { loadWorldFile, seedCompiled } from "./world/load.js";
import { assertNoSecret } from "./secrets.js";
import { WorldStore } from "./persist/store.js";

/** Same frozen lines as experiment-1/2. New sqlite. Only criterion: legal interpretation objects. */
const INPUTS: Array<{ id: number; category: string; line: string }> = [
  { id: 1, category: "普通行动", line: "我沿着街走走，找家还开着的早餐铺。" },
  { id: 2, category: "否定", line: "算了，我不去上学了。" },
  { id: 3, category: "观察", line: "我站在路边，看看周围有什么人和店铺。" },
  { id: 4, category: "闲聊", line: "同学，今天天气还行。" },
  { id: 5, category: "直接问NPC", line: "同学，你知道附近有没有奇怪的事吗？" },
  { id: 6, category: "连续追问", line: "你刚才说的那个，能再说细一点吗？" },
  { id: 7, category: "混合动作+说话", line: "我把书包放下，问同学要不要一起去食堂。" },
  { id: 8, category: "转换话题", line: "不谈这个了，我先去便利店买瓶水。" },
  { id: 9, category: "长期后果", line: "我把刚才听到的话写进日记，以后不会忘掉。" },
  { id: 10, category: "OOC/meta", line: "（OOC）这是游戏吗？我现在该怎么玩？" },
];

const PREVIOUS_WALL_MS = 205_000;

function digest(store: WorldStore, worldId: string): Record<string, unknown> {
  const snap = store.snapshot(worldId);
  const events = store.listEvents(worldId);
  return {
    time: snap.world.time,
    revision: snap.world.revision,
    factCount: snap.facts.length,
    claimCount: snap.claims.length,
    knowledgeCount: snap.knowledge.length,
    memoryCount: snap.memories.length,
    eventCount: events.length,
    playerLocation: snap.characters.find((row) => row.kind === "player")?.locationId ?? null,
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.worldSource) {
    throw new Error("DWE_WORLD_SOURCE required");
  }
  mkdirSync("data/local", { recursive: true });
  const compiled = loadWorldFile(config.worldSource);
  const publicConfig = configForLog(config);
  const model = createModelClient(config);
  const session = openWorld(
    config.worldFile,
    createNarrator(model, config.apiKey),
    compiled,
    createModelInterpreter(model, config.apiKey),
    createNpcVoice(model, config.apiKey),
  );
  const worldId = compiled.seed.world.id;
  const turns: unknown[] = [];
  let callCursor = 0;
  const wallStarted = Date.now();

  process.stderr.write(
    `experiment-3 source=${publicConfig.worldSource} world=${publicConfig.worldFile} model=${publicConfig.model} @ ${publicConfig.baseUrl}\n`,
  );

  try {
    for (const input of INPUTS) {
      const before = digest(session.store, worldId);
      const started = Date.now();
      let error: string | null = null;
      let view: Awaited<ReturnType<typeof session.playTurn>> | null = null;
      try {
        view = await session.playTurn(input.line);
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      }
      const calls = model.records.slice(callCursor);
      callCursor = model.records.length;
      for (const record of calls) {
        assertNoSecret(JSON.stringify(record), config.apiKey, "experiment call record");
      }
      const interpCall = calls.find((record) => record.purpose === "scene-interpretation");
      const parsed = interpCall?.errorCategory === "none";
      const row = {
        id: input.id,
        category: input.category,
        line: input.line,
        error,
        latencyMs: Date.now() - started,
        parsed,
        legal: parsed,
        outcome: view?.interpretation.outcome ?? null,
        submitted: view?.interpretation.submitted ?? false,
        structuredMode: interpCall?.structuredMode ?? null,
        errorCategory: interpCall?.errorCategory ?? null,
        zodIssues: interpCall?.attempts.flatMap((attempt) => attempt.zodIssues) ?? [],
        interpretation: view
          ? {
            contributions: view.interpretation.contributions,
            outcome: view.interpretation.outcome,
            futureCausal: view.interpretation.futureCausal,
            submitted: view.interpretation.submitted,
          }
          : null,
        before,
        after: digest(session.store, worldId),
        calls: calls.map((record: CallRecord) => ({
          role: record.role,
          purpose: record.purpose,
          inputTokens: record.inputTokens,
          outputTokens: record.outputTokens,
          latencyMs: record.latencyMs,
          structuredMode: record.structuredMode,
          errorCategory: record.errorCategory,
          attempts: record.attempts,
        })),
      };
      turns.push(row);
      process.stderr.write(
        `#${input.id} ${input.category} parsed=${parsed} outcome=${view?.interpretation.outcome ?? "error"} mode=${interpCall?.structuredMode ?? "-"} err=${interpCall?.errorCategory ?? error ?? "none"}\n`,
      );
      if (interpCall) {
        process.stderr.write(`  ${formatCallLine(interpCall)}\n`);
      }
    }
  } finally {
    session.close();
  }

  const parsedCount = turns.filter((row) => (row as { parsed?: boolean }).parsed).length;
  const legalCount = turns.filter((row) => (row as { legal?: boolean }).legal).length;
  const wallMs = Date.now() - wallStarted;
  const tokenIn = model.records.reduce((sum, record) => sum + (record.inputTokens ?? 0), 0);
  const tokenOut = model.records.reduce((sum, record) => sum + (record.outputTokens ?? 0), 0);
  const passed = parsedCount >= 8 && legalCount === parsedCount && wallMs <= PREVIOUS_WALL_MS;

  const resumeStore = new WorldStore(config.worldFile);
  seedCompiled(resumeStore, compiled);
  const resumed = digest(resumeStore, worldId);
  resumeStore.close();

  const receipt = {
    protocol: "experiment-3-interpretation-path",
    follows: "interpret-precheck",
    reroll: false,
    promptEdited: false,
    modelSwitched: false,
    schemaChange: "futureCausal optional default false",
    model: publicConfig.model,
    baseUrl: publicConfig.baseUrl,
    worldSource: publicConfig.worldSource,
    worldFile: publicConfig.worldFile,
    parsedCount,
    legalCount,
    total: INPUTS.length,
    wallMs,
    tokenIn,
    tokenOut,
    costUsd: model.records.every((record) => record.costUsd === null)
      ? null
      : model.records.reduce((sum, record) => sum + (record.costUsd ?? 0), 0),
    passed,
    turns,
    resumed,
  };
  const out = resolve("data/local/experiment-3-receipt.json");
  writeFileSync(out, `${JSON.stringify(receipt, null, 2)}\n`);
  process.stderr.write(
    `experiment-3 parsed=${parsedCount}/${INPUTS.length} legal=${legalCount} wallMs=${wallMs} passed=${passed}\n`,
  );
  process.stderr.write(`receipt ${out}\n`);
  if (!passed) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
