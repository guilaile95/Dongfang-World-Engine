import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createNpcVoice } from "./chat/npc.js";
import { loadConfig } from "./config.js";
import { createModelClient } from "./model/client.js";
import type { CallRecord } from "./model/types.js";
import { createNarrator } from "./narrator/client.js";
import { createModelInterpreter } from "./scene/interpreter.js";
import { createModelStopDecider } from "./scene/stop.js";
import { openWorld } from "./session.js";
import { loadWorldFile } from "./world/load.js";

const SOURCE = resolve("app/world/fixtures/dragon-2009-first-hour.json");
const outDir = resolve("data/local");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const experimentId = process.env.DWE_EXPERIMENT_ID?.trim() || `dragon-2009-first-hour-${stamp}`;
const config = { ...loadConfig(), maxRetries: 0, fallbackModel: null };

interface PathResult {
  path: "A" | "B";
  status: "passed" | "failed";
  error: string | null;
  turns: Array<{ line: string; text: string; parsed: boolean; receipt: import("./session.js").TurnReceipt; exposure: string[] }>;
  structuredCalls: CallRecord[];
  narratorCalls: CallRecord[];
  inputTokens: number | null;
  outputTokens: number | null;
  wallTimeMs: number;
  costUsd: number | "unknown/not configured";
  restartDigest: string;
  restarted: { time: string; locationId: string | null; threadStage: string | null; executedBeatIds: string[] };
}

async function runPath(path: "A" | "B"): Promise<PathResult> {
  const started = Date.now();
  const model = createModelClient(config);
  const compiled = loadWorldFile(SOURCE);
  const db = join(outDir, `dragon-2009-real-${stamp}-${path.toLowerCase()}.sqlite`);
  const session = openWorld(db, createNarrator(model, config.apiKey), compiled, createModelInterpreter(model, config.apiKey), createNpcVoice(model, config.apiKey), createModelStopDecider(model));
  const profile = { worldId: "longzu", name: path === "A" ? "林念安" : "陈若晨", age: "18", gender: path === "A" ? "女" : "男", background: "仕兰中学的一名普通学生。", startingLocation: "仕兰中学教学楼", personality: "谨慎但不多疑" };
  const lines = path === "A"
    ? ["我避开老码头，走经老街和24小时药店的远路回家。"]
    : ["我明确不理会刚才的路况提醒，照常走老码头那条近路回家。", "我不再理会刚才的动静，在家安静等二十五分钟。"];
  const turns: PathResult["turns"] = [];
  let error: string | null = null;
  try {
    session.store.initializePlayerProfile(profile);
    await session.projectOpening(profile);
    for (const [index, line] of lines.entries()) {
      const turn = await session.handlePlayerTurn(line, `real-${path}-${index + 1}`);
      turns.push({ line, text: turn.text, parsed: turn.parsed, receipt: turn.receipt, exposure: turn.envelope.ephemeral.ambient });
    }
  } catch (cause) {
    error = (cause instanceof Error ? cause.message : String(cause)).replaceAll(config.apiKey, "[REDACTED]").slice(0, 500);
  } finally {
    session.close();
  }

  const reopened = openWorld(db, createNarrator(model, config.apiKey), compiled, createModelInterpreter(model, config.apiKey), createNpcVoice(model, config.apiKey), createModelStopDecider(model));
  const snapshot = reopened.store.snapshot("longzu");
  const player = snapshot.characters.find((row) => row.id === compiled.playerId);
  const restart = { time: snapshot.world.time, locationId: player?.locationId ?? null, threadStage: snapshot.backgroundThreads[0]?.currentStage ?? null, executedBeatIds: snapshot.backgroundThreads[0]?.executedBeatIds ?? [] };
  const restartDigest = createHash("sha256").update(JSON.stringify(restart)).digest("hex");
  reopened.close();
  const input = sum(model.records.map((row) => row.inputTokens));
  const output = sum(model.records.map((row) => row.outputTokens));
  const knownCosts = model.records.map((row) => row.costUsd);
  return {
    path,
    status: error ? "failed" : "passed",
    error,
    turns,
    structuredCalls: model.records.filter((row) => row.structuredMode !== "none"),
    narratorCalls: model.records.filter((row) => row.role === "narrator"),
    inputTokens: input,
    outputTokens: output,
    wallTimeMs: Date.now() - started,
    costUsd: knownCosts.every((value) => value !== null) ? knownCosts.reduce((sum, value) => sum + (value ?? 0), 0) : "unknown/not configured",
    restartDigest,
    restarted: restart,
  };
}

function sum(values: Array<number | null>): number | null {
  return values.every((value) => value !== null) ? values.reduce((total, value) => total + (value ?? 0), 0) : null;
}

mkdirSync(outDir, { recursive: true });
const selected: Array<"A" | "B"> = process.env.DWE_EXPERIMENT_PATH === "A" || process.env.DWE_EXPERIMENT_PATH === "B" ? [process.env.DWE_EXPERIMENT_PATH] : ["A", "B"];
const paths: PathResult[] = [];
for (const path of selected) paths.push(await runPath(path));
const result = { experiment: experimentId, noReroll: true, source: "app/world/fixtures/dragon-2009-first-hour.json", startedAt: new Date().toISOString(), paths };
const outputPath = join(outDir, `dragon-2009-real-model-${stamp}.json`);
writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ output: outputPath, paths: result.paths.map((path) => ({ path: path.path, status: path.status, error: path.error, turns: path.turns.map((turn) => turn.receipt), inputTokens: path.inputTokens, outputTokens: path.outputTokens, costUsd: path.costUsd, wallTimeMs: path.wallTimeMs, restartDigest: path.restartDigest })) }, null, 2)}\n`);
if (paths.some((path) => path.status === "failed")) process.exitCode = 1;
