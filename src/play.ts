import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { PlaySession } from "./engine/play-session.js";
import { CLOSED_INN_WORLD_ID } from "./testkit/world-builder.js";

const DEFAULT_WORLD_FILE = "data/local/closed-inn.sqlite";

interface PlayConfig {
  worldFile: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export async function runPlayableLocalLoop(config: PlayConfig): Promise<void> {
  const session = PlaySession.open({
    worldFile: config.worldFile,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
  });
  let cli: ReturnType<typeof createInterface> | null = null;
  try {
    printWorldStatus(session, session.resumed ? "已恢复世界" : "已创建世界", true);
    console.log("直接输入自然语言。吃饭、闲逛、闲聊都可以；世界不会停在你身上。输入 :quit 退出。\n");
    cli = createInterface({ input: process.stdin, output: process.stdout });
    process.stdout.write("> ");
    for await (const line of cli) {
      const intent = line.trim();
      if (intent === ":quit") {
        break;
      }
      if (!intent) {
        process.stdout.write("> ");
        continue;
      }
      try {
        const turn = await session.playTurn(intent);
        console.log(turn.sceneReply.includes(config.apiKey) ? "[叙事输出因包含凭据而被隐藏]" : turn.sceneReply);
      } catch (error) {
        const message = error instanceof Error ? error.message : "scene chat failed";
        console.log(`[叙事暂不可用：${message.slice(0, 200)}]`);
      }
      printWorldStatus(session, "世界继续", false);
      process.stdout.write("\n> ");
    }
  } finally {
    cli?.close();
    session.close();
  }
}

function printWorldStatus(session: PlaySession, label: string, includeFile: boolean): void {
  const context = session.buildModelFacingContext();
  const location = context.observer.location?.name ?? "未知";
  const file = includeFile ? ` | 文件=${session.worldFile}` : "";
  console.log(
    `${label} | world=${CLOSED_INN_WORLD_ID} | revision=${context.observer.world.revision}` +
    ` | 时间=${context.observer.world.currentTime} | 位置=${location}` +
    ` | 剧情阶段=${context.plotStage ?? "未知"}${file}`,
  );
}

function readConfig(environment: NodeJS.ProcessEnv): PlayConfig {
  return {
    worldFile: resolve(environment.DWE_WORLD_FILE?.trim() || DEFAULT_WORLD_FILE),
    baseUrl: requiredEnvironment(environment, "DWE_LLM_BASE_URL"),
    apiKey: requiredEnvironment(environment, "DWE_LLM_API_KEY"),
    model: requiredEnvironment(environment, "DWE_LLM_MODEL"),
  };
}

function requiredEnvironment(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  await runPlayableLocalLoop(readConfig(process.env));
}

if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? "")) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Playable Local Loop failed";
    console.error(message.slice(0, 500));
    process.exitCode = 1;
  });
}
