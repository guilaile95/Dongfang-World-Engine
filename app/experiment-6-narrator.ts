import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createNpcVoice } from "./chat/npc.js";
import { configForLog, loadConfig } from "./config.js";
import { createModelClient } from "./model/client.js";
import { createNarrator } from "./narrator/client.js";
import { createModelInterpreter } from "./scene/interpreter.js";
import { openWorld } from "./session.js";
import { loadWorldFile } from "./world/load.js";
import { assertNoSecret } from "./secrets.js";

function loc(session: ReturnType<typeof openWorld>, worldId: string): string | null {
  return session.store.snapshot(worldId).characters.find((row) => row.kind === "player")?.locationId ?? null;
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.worldSource) {
    throw new Error("DWE_WORLD_SOURCE required");
  }
  mkdirSync("data/local", { recursive: true });
  const compiled = loadWorldFile(config.worldSource);
  const model = createModelClient(config);
  const session = openWorld(
    config.worldFile,
    createNarrator(model, config.apiKey),
    compiled,
    createModelInterpreter(model, config.apiKey),
    createNpcVoice(model, config.apiKey),
  );
  const worldId = compiled.seed.world.id;
  const started = Date.now();
  const loc0 = loc(session, worldId);

  const a = await session.playTurn("同学，你记住：从今天起我不住这间宿舍了。这是我们说定的事。");
  const bMove = await session.playTurn("我走进校园食堂。");
  const bItem = await session.playTurn("我把柜台上的金条装进口袋。");
  const bDeath = await session.playTurn("同学当场死了。");

  const locEnd = loc(session, worldId);
  const committedA = a.envelope.committed;
  const aOk = a.parsed && a.interpretation.submitted && committedA.length > 0
    && /记|听|说/.test(a.text)
    && !/已经搬走|已成为事实|世界已经确认/.test(a.text);
  const moveAsserted = /你已经走进|你走进了校园食堂|你走进校园食堂/.test(bMove.text);
  const itemAsserted = /你(?:已经)?(?:把|将).*(?:金条|装进)/.test(bItem.text) && bItem.envelope.committed.length === 0;
  const deathAsserted = /同学(?:已经)?死了|同学当场死去/.test(bDeath.text) && bDeath.envelope.committed.length === 0;
  const locationUnchanged = loc0 === locEnd;
  const bOk = bMove.envelope.committed.length === 0 && !moveAsserted && !itemAsserted && !deathAsserted
    && locationUnchanged;

  const passed = Boolean(aOk && bOk);
  const receipt = {
    protocol: "experiment-6c-narrator-baseline",
    follows: "experiment-6b-narrator-baseline",
    uniqueVariable: "narrator projection contract only (committed vs uncommitted durable attempts)",
    model: configForLog(config).model,
    worldFile: config.worldFile,
    caseA: {
      line: "同学，你记住：从今天起我不住这间宿舍了。这是我们说定的事。",
      parsed: a.parsed,
      submitted: a.interpretation.submitted,
      committed: committedA,
      narrator: a.text.replace(/\s+/g, " ").slice(0, 420),
      ok: aOk,
    },
    caseB: {
      move: { committed: bMove.envelope.committed, narrator: bMove.text.replace(/\s+/g, " ").slice(0, 280), asserted: moveAsserted },
      item: { committed: bItem.envelope.committed, narrator: bItem.text.replace(/\s+/g, " ").slice(0, 280), asserted: itemAsserted },
      death: { committed: bDeath.envelope.committed, narrator: bDeath.text.replace(/\s+/g, " ").slice(0, 280), asserted: deathAsserted },
      loc0,
      locEnd,
      ok: bOk,
    },
    passed,
    wallMs: Date.now() - started,
    tokenIn: model.records.reduce((sum, record) => sum + (record.inputTokens ?? 0), 0),
    tokenOut: model.records.reduce((sum, record) => sum + (record.outputTokens ?? 0), 0),
    calls: model.records.map((record) => ({
      purpose: record.purpose,
      structuredMode: record.structuredMode,
      errorCategory: record.errorCategory,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      latencyMs: record.latencyMs,
    })),
  };
  assertNoSecret(JSON.stringify(receipt), config.apiKey, "experiment-6 receipt");
  const out = resolve("data/local/experiment-6c-narrator-receipt.json");
  writeFileSync(out, `${JSON.stringify(receipt, null, 2)}\n`);
  process.stderr.write(`6 narrator aOk=${aOk} bOk=${bOk} moveAssert=${moveAsserted} itemAssert=${itemAsserted} deathAssert=${deathAsserted} passed=${passed}\n`);
  process.stderr.write(`receipt ${out}\n`);
  session.close();
  if (!passed) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
