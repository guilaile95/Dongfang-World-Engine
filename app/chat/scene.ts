import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";
import type { AppConfig } from "../config.js";
import { assertNoSecret } from "../secrets.js";

export interface SceneRequest {
  prompt: string;
  playerLine: string;
}

export interface SceneClient {
  writeScene(request: SceneRequest, onChunk?: (text: string) => void): Promise<string>;
}

const SYSTEM = [
  "你是这个文字世界的场景叙述者。玩家只打自然语言。",
  "只根据给定观察者当前有权知道的内容来写场景，不要泄漏他们不知道的秘密。",
  "不要提及引擎、数据库、事件、候选或内部字段。",
  "场景可以即兴细节，但不能把即兴细节当成已经发生的客观事实去改写世界。",
  "世界不围着玩家转：即使玩家吃饭、闲逛或拒绝，已经开始的事仍在继续。",
].join("");

export function createSceneClient(config: AppConfig): SceneClient {
  const provider = createOpenAICompatible({
    name: "dwe",
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
  });
  const model = provider.chatModel(config.model);

  return {
    async writeScene(request, onChunk) {
      assertNoSecret(request.prompt, config.apiKey, "observer prompt");
      assertNoSecret(request.playerLine, config.apiKey, "player line");

      const result = streamText({
        model,
        system: SYSTEM,
        prompt: `${request.prompt}\n\n玩家说：${request.playerLine || "（沉默）"}`,
        telemetry: { isEnabled: false, recordInputs: false, recordOutputs: false },
      });

      let text = "";
      for await (const chunk of result.textStream) {
        text += chunk;
        onChunk?.(chunk);
      }
      assertNoSecret(text, config.apiKey, "scene text");
      return text;
    },
  };
}

export function stubSceneClient(): SceneClient {
  return {
    async writeScene(request, onChunk) {
      const text = `${request.prompt}\n\n> ${request.playerLine || "……"}`;
      onChunk?.(text);
      return text;
    },
  };
}
