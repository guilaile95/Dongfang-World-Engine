import { createNpcVoice } from "./chat/npc.js";
import { createSceneClient } from "./chat/scene.js";
import { configForLog, loadConfig } from "./config.js";
import { createModelClient, formatCallLine } from "./model/client.js";
import { createModelInterpreter } from "./scene/interpreter.js";
import { openWorld } from "./session.js";
import { SYNTHETIC } from "./world/seed.js";
import { assertNoSecret } from "./secrets.js";

const LINES = [
  "掌柜，汤好了吗？",
  "那还要多久？",
  "刚才你怎么说来着？",
  "那我再等一会儿。",
  "你还记得我问的是汤吗？",
  "好，那给我一碗清汤。",
];

async function main(): Promise<void> {
  const config = loadConfig();
  const publicConfig = configForLog(config);
  process.stderr.write(`continuity sample model=${publicConfig.model} @ ${publicConfig.baseUrl}\n`);
  const model = createModelClient(config);
  const session = openWorld(
    ":memory:",
    createSceneClient(model, config.apiKey),
    SYNTHETIC,
    createModelInterpreter(model),
    createNpcVoice(model, config.apiKey),
  );
  const markers: string[] = [];
  try {
    for (const line of LINES) {
      const turn = await session.playTurn(line);
      assertNoSecret(turn.prompt, config.apiKey, "continuity prompt");
      const remembered = LINES.filter((prior) => prior !== line && turn.prompt.includes(prior.slice(0, 6)));
      markers.push(`${line} | rememberedPriors=${remembered.length} | npc=${turn.dialogue?.addresseeName ?? "-"}`);
      const record = model.lastRecord();
      if (record) {
        process.stderr.write(`${formatCallLine(record)}\n`);
      }
    }
  } finally {
    session.close();
  }
  for (const row of markers) {
    process.stdout.write(`${row}\n`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
