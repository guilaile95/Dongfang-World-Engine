import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createNpcVoice } from "./chat/npc.js";
import { configForLog, loadConfig } from "./config.js";
import { createModelClient, formatCallLine } from "./model/client.js";
import { createNarrator } from "./narrator/client.js";
import { createModelInterpreter } from "./scene/interpreter.js";
import { openWorld } from "./session.js";
import { loadWorldFile } from "./world/load.js";
import { assertNoSecret } from "./secrets.js";

const ACTION = "我背起书包，走进校园食堂。";
const FOLLOW = "同学，你看我现在人在哪儿？";

function playerLocation(store: ReturnType<typeof openWorld>["store"], worldId: string): string | null {
  return store.snapshot(worldId).characters.find((row) => row.kind === "player")?.locationId ?? null;
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
  const loc0 = playerLocation(session.store, worldId);
  const facts0 = session.store.snapshot(worldId).facts.length;
  const claims0 = session.store.snapshot(worldId).claims.length;
  const mem0 = session.store.snapshot(worldId).memories.length;
  const started = Date.now();

  process.stderr.write(`experiment-smoke loc0=${loc0} model=${publicConfig.model}\n`);

  let error: string | null = null;
  try {
    const t1 = await session.playTurn(ACTION);
    const interp = model.records.find((row) => row.purpose === "scene-interpretation");
    const loc1 = playerLocation(session.store, worldId);
    const snap1 = session.store.snapshot(worldId);
    const t2 = await session.playTurn(FOLLOW);
    const loc2 = playerLocation(session.store, worldId);
    const npcSeesLocation = Boolean(
      t2.dialogue?.npcPrompt.includes(loc1 ?? "") ||
        t2.dialogue?.npcReply.includes("食堂") ||
        t2.prompt.includes("食堂"),
    );
    const locationChanged = loc1 !== loc0;
    const durableWrite =
      snap1.facts.length > facts0 ||
      snap1.claims.length > claims0 ||
      snap1.memories.filter((row) => row.characterId === compiled.playerId).length > mem0;
    const parsed = interp?.errorCategory === "none";
    const narratorMatchesCommit =
      t1.envelope.committed.length === 0
        ? !(t1.text.includes("食堂") && locationChanged === false && durableWrite === false)
        : t1.envelope.committed.every((line) => t1.text.includes(line.slice(0, Math.min(12, line.length))));
    const narratorFabricatedMove = t1.envelope.committed.length === 0 && /食堂|书包/.test(t1.text);
    const passed = Boolean(parsed && locationChanged && durableWrite && t2.dialogue);

    const receipt = {
      protocol: "experiment-smoke-e2e",
      follows: "experiment-3-interpretation-path",
      model: publicConfig.model,
      worldFile: publicConfig.worldFile,
      action: ACTION,
      follow: FOLLOW,
      parsed,
      outcome: t1.interpretation.outcome,
      submitted: t1.interpretation.submitted,
      loc0,
      loc1,
      loc2,
      locationChanged,
      durableWrite,
      committed: t1.envelope.committed,
      narrator: t1.text.replace(/\s+/g, " ").slice(0, 500),
      npcReply: t2.dialogue?.npcReply ?? null,
      npcSeesLocation,
      narratorMatchesCommit,
      narratorFabricatedMove,
      wallMs: Date.now() - started,
      tokenIn: model.records.reduce((sum, record) => sum + (record.inputTokens ?? 0), 0),
      tokenOut: model.records.reduce((sum, record) => sum + (record.outputTokens ?? 0), 0),
      passed,
      checks: {
        parsed,
        locationAtoB: locationChanged,
        itemOrDurableState: durableWrite,
        narratorConsumedCommit: narratorMatchesCommit,
        npcPerceivesNewPlace: Boolean(t2.dialogue && npcSeesLocation && locationChanged),
      },
    };
    assertNoSecret(JSON.stringify(receipt), config.apiKey, "smoke receipt");
    const out = resolve("data/local/experiment-smoke-receipt.json");
    writeFileSync(out, `${JSON.stringify(receipt, null, 2)}\n`);
    process.stderr.write(
      `smoke parsed=${parsed} loc ${loc0}→${loc1} durable=${durableWrite} submitted=${t1.interpretation.submitted} fabricatedMove=${narratorFabricatedMove} passed=${passed}\n`,
    );
    if (interp) {
      process.stderr.write(`  ${formatCallLine(interp)}\n`);
    }
    process.stderr.write(`receipt ${out}\n`);
    if (!passed) {
      process.exitCode = 1;
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
    process.stderr.write(`${error}\n`);
    process.exitCode = 1;
  } finally {
    session.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
