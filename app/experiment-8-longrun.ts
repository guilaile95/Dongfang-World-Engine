import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createNpcVoice } from "./chat/npc.js";
import { configForLog, loadConfig } from "./config.js";
import { createModelClient, formatCallLine } from "./model/client.js";
import { createNarrator } from "./narrator/client.js";
import { createModelInterpreter } from "./scene/interpreter.js";
import { openWorld, UNPARSED_HINT } from "./session.js";
import { loadWorldFile, seedCompiled } from "./world/load.js";
import { WorldStore } from "./persist/store.js";
import { assemblePrompt } from "./visibility/assemble.js";
import { assertNoSecret } from "./secrets.js";

const LINES: Array<{ id: number; tag: string; line: string }> = [
  { id: 1, tag: "生活", line: "我沿着街走走，找家还开着的早餐铺。" },
  { id: 2, tag: "生活", line: "算了，先随便吃点热的。" },
  { id: 3, tag: "闲聊", line: "同学，今天天气还行。" },
  { id: 4, tag: "信息", line: "同学，你知道附近有没有奇怪的事吗？" },
  { id: 5, tag: "拒绝", line: "算了，我不去上学了。" },
  { id: 6, tag: "后果", line: "同学，你记住：从今天起我不住这间宿舍了。这是我们说定的事。" },
  { id: 7, tag: "追问", line: "同学，我刚才让你记住的是哪一件事？" },
  { id: 8, tag: "离题", line: "我不谈宿舍了，先去便利店买瓶水。" },
  { id: 9, tag: "离题", line: "买水的时候我看了眼货架上的杂志。" },
  { id: 10, tag: "离题", line: "这本杂志封面挺吵的。" },
  { id: 11, tag: "观察", line: "我站在路边，看看周围有什么人和店铺。" },
  { id: 12, tag: "混合", line: "我把书包放下，问同学要不要一起去食堂。" },
  { id: 13, tag: "信息", line: "同学，你刚才说的那个，能再说细一点吗？" },
  { id: 14, tag: "生活", line: "那我们还是先吃饭吧。" },
  { id: 15, tag: "拒绝", line: "不，今天我不想跟任何人出门远行。" },
  { id: 16, tag: "世界", line: "我试着把刚才听到的失踪传闻写进日记。" },
  { id: 17, tag: "认知", line: "同学，卡塞尔学院在哪？" },
  { id: 18, tag: "生活", line: "我在街边坐一会儿。" },
  { id: 19, tag: "闲聊", line: "同学，你今天过得怎么样？" },
  { id: 20, tag: "离题", line: "我数了数路过的自行车。" },
  { id: 21, tag: "后果", line: "同学，你还记得我不住宿舍那件事吗？" },
  { id: 22, tag: "观察", line: "街头新闻还在播吗？" },
  { id: 23, tag: "生活", line: "我想喝口水。" },
  { id: 24, tag: "拒绝", line: "同学，先别拉我去学校。" },
  { id: 25, tag: "信息", line: "那桩失踪案，你还听说了新的吗？" },
  { id: 26, tag: "世界", line: "我把书包重新背上。" },
  { id: 27, tag: "闲聊", line: "同学，你饿不饿？" },
  { id: 28, tag: "观察", line: "我看看天色。" },
  { id: 29, tag: "生活", line: "那就往回走走。" },
  { id: 30, tag: "认知", line: "同学，龙还存在吗？" },
];

const LEAK = ["黑王", "白王", "尼伯龙根", "fact-dragons-exist", "mixed-blood-academy", "死侍", "言灵"];

function digest(store: WorldStore, worldId: string) {
  const snap = store.snapshot(worldId);
  return {
    time: snap.world.time,
    revision: snap.world.revision,
    factCount: snap.facts.length,
    claimCount: snap.claims.length,
    knowledgeCount: snap.knowledge.length,
    memoryCount: snap.memories.length,
    eventCount: store.listEvents(worldId).length,
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
  let session = openWorld(
    config.worldFile,
    createNarrator(model, config.apiKey),
    compiled,
    createModelInterpreter(model, config.apiKey),
    createNpcVoice(model, config.apiKey),
  );
  const worldId = compiled.seed.world.id;
  const roommate = session.store.snapshot(worldId).characters.find((row) => row.name === "同学");
  const hybrid = session.store.snapshot(worldId).characters.find((row) => row.id === "char-hybrid");
  const started = Date.now();
  const turns: unknown[] = [];
  let p0 = false;
  let restart = { at: 15, ok: false as boolean, digestBefore: null as ReturnType<typeof digest> | null, digestAfter: null as ReturnType<typeof digest> | null };
  process.stderr.write(`experiment-8-longrun model=${publicConfig.model} world=${publicConfig.worldFile}\n`);

  try {
    for (const input of LINES) {
      if (input.id === 16) {
        const before = digest(session.store, worldId);
        session.close();
        const reopened = new WorldStore(config.worldFile);
        seedCompiled(reopened, compiled);
        const after = digest(reopened, worldId);
        restart = { at: 15, ok: after.revision === before.revision && after.time === before.time, digestBefore: before, digestAfter: after };
        reopened.close();
        if (!restart.ok) {
          p0 = true;
        }
        session = openWorld(
          config.worldFile,
          createNarrator(model, config.apiKey),
          compiled,
          createModelInterpreter(model, config.apiKey),
          createNpcVoice(model, config.apiKey),
        );
      }
      const before = digest(session.store, worldId);
      const t0 = Date.now();
      const view = await session.playTurn(input.line);
      const after = digest(session.store, worldId);
      const leaks = LEAK.filter((token) => (view.dialogue?.npcReply ?? "").includes(token) || view.prompt.includes(token));
      if (leaks.length > 0) {
        p0 = true;
      }
      const npcPack = roommate
        ? assemblePrompt({ snapshot: session.store.snapshot(worldId), observerId: roommate.id }).prompt
        : "";
      const hybridPack = hybrid
        ? assemblePrompt({ snapshot: session.store.snapshot(worldId), observerId: hybrid.id }).prompt
        : "";
      const row = {
        id: input.id,
        tag: input.tag,
        line: input.line,
        parsed: view.parsed,
        outcome: view.interpretation.outcome,
        submitted: view.interpretation.submitted,
        committed: view.envelope.committed,
        narrator: view.text.replace(/\s+/g, " ").slice(0, 280),
        npc: view.dialogue?.npcReply ?? null,
        leaks,
        before,
        after,
        latencyMs: Date.now() - t0,
      };
      turns.push(row);
      process.stderr.write(
        `#${input.id} ${input.tag} parsed=${view.parsed} outcome=${view.interpretation.outcome} submitted=${view.interpretation.submitted} leaks=${leaks.length}\n`,
      );
      if (p0) {
        process.stderr.write(`P0 at turn ${input.id}, stopping\n`);
        break;
      }
      void npcPack;
      void hybridPack;
    }
  } finally {
    session.close();
  }

  const dormMemoryHolds = (() => {
    const store = new WorldStore(config.worldFile);
    seedCompiled(store, compiled);
    const texts = store.snapshot(worldId).memories.filter((row) => row.characterId === roommate?.id).map((row) => row.text);
    store.close();
    return texts.some((text) => text.includes("宿舍") || text.includes("不住"));
  })();
  const roommateLeak = (() => {
    const store = new WorldStore(config.worldFile);
    seedCompiled(store, compiled);
    const pack = roommate
      ? assemblePrompt({ snapshot: store.snapshot(worldId), observerId: roommate.id }).prompt
      : "";
    store.close();
    return LEAK.filter((token) => pack.includes(token));
  })();

  const tokenIn = model.records.reduce((sum, record) => sum + (record.inputTokens ?? 0), 0);
  const tokenOut = model.records.reduce((sum, record) => sum + (record.outputTokens ?? 0), 0);
  const completed = turns.length;
  const passed = completed === 30 && restart.ok && !p0 && dormMemoryHolds && roommateLeak.length === 0;
  const receipt = {
    protocol: "experiment-8-longzu-30",
    follows: "experiment-7-cost-gate",
    uniqueVariable: "first real 30-turn longzu long run after 4c/5/6/7",
    model: publicConfig.model,
    worldFile: publicConfig.worldFile,
    completed,
    restart,
    dormMemoryHolds,
    roommateLeak,
    p0,
    passed,
    wallMs: Date.now() - started,
    tokenIn,
    tokenOut,
    callCount: model.records.length,
    turns,
  };
  assertNoSecret(JSON.stringify(receipt), config.apiKey, "experiment-8 receipt");
  const out = resolve("data/local/experiment-8-longrun-receipt.json");
  writeFileSync(out, `${JSON.stringify(receipt, null, 2)}\n`);
  process.stderr.write(
    `8 longrun completed=${completed}/30 restart=${restart.ok} dorm=${dormMemoryHolds} leak=${roommateLeak.length} p0=${p0} passed=${passed}\n`,
  );
  for (const record of model.records.slice(-3)) {
    process.stderr.write(`  ${formatCallLine(record)}\n`);
  }
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
