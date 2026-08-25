import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { stubNpcVoice } from "./chat/npc.js";
import { configForLog, loadConfig } from "./config.js";
import { fixedInterpreter } from "./scene/interpreter.js";
import { openWorld, UNPARSED_HINT } from "./session.js";
import { loadWorldFile } from "./world/load.js";
import { assertNoSecret } from "./secrets.js";

const LINE = "同学，你记住：从今天起我不住这间宿舍了。这是我们说定的事。";

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.worldSource) {
    throw new Error("DWE_WORLD_SOURCE required");
  }
  mkdirSync("data/local", { recursive: true });
  const compiled = loadWorldFile(config.worldSource);
  let narrated = 0;
  const session = openWorld(
    config.worldFile,
    {
      async project() {
        narrated += 1;
        return "should-not-narrate";
      },
    },
    compiled,
    fixedInterpreter(
      {
        contributions: ["uncertain_attempt"],
        futureCausal: false,
        outcome: "fail",
        proposals: [],
      },
      false,
    ),
    stubNpcVoice(),
  );
  const worldId = compiled.seed.world.id;
  const before = session.store.snapshot(worldId);
  const eventsBefore = session.store.listEvents(worldId);
  const started = Date.now();
  const turn = await session.playTurn(LINE);
  const after = session.store.snapshot(worldId);
  const eventsAfter = session.store.listEvents(worldId);
  const passed = Boolean(
    turn.parsed === false
      && turn.text === UNPARSED_HINT
      && turn.dialogue === null
      && narrated === 0
      && after.world.time === before.world.time
      && after.world.revision === before.world.revision
      && after.memories.length === before.memories.length
      && after.claims.length === before.claims.length
      && eventsAfter.length === eventsBefore.length,
  );
  const receipt = {
    protocol: "experiment-5-failclosed",
    follows: "experiment-4c-e2e-addressee-memory",
    uniqueVariable: "session fail-closed on parsed=false: no tick, narrator, scene, or authority writes",
    model: configForLog(config).model,
    worldFile: config.worldFile,
    line: LINE,
    parsed: turn.parsed,
    text: turn.text,
    narrated,
    timeBefore: before.world.time,
    timeAfter: after.world.time,
    revisionBefore: before.world.revision,
    revisionAfter: after.world.revision,
    eventsBefore: eventsBefore.length,
    eventsAfter: eventsAfter.length,
    memoryDelta: after.memories.length - before.memories.length,
    claimDelta: after.claims.length - before.claims.length,
    passed,
    wallMs: Date.now() - started,
  };
  assertNoSecret(JSON.stringify(receipt), config.apiKey, "experiment-5 receipt");
  const out = resolve("data/local/experiment-5-failclosed-receipt.json");
  writeFileSync(out, `${JSON.stringify(receipt, null, 2)}\n`);
  process.stderr.write(
    `5 failclosed parsed=${turn.parsed} narrated=${narrated} rev ${before.world.revision}→${after.world.revision} passed=${passed}\n`,
  );
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
