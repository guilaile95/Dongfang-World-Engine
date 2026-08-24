import type { ModelClient } from "../model/client.js";
import { assertNoSecret } from "../secrets.js";

export interface SceneRequest {
  prompt: string;
  playerLine: string;
}

export interface SceneClient {
  writeScene(request: SceneRequest, onChunk?: (text: string) => void): Promise<string>;
}

const SYSTEM = [
  "你是这个文字世界的场景叙述者。玩家只打自然语言，那是场景贡献，不是指令表。",
  "只根据给定观察者当前有权知道的内容来写场景，不要泄漏他们不知道的秘密。",
  "不要提及引擎、数据库、事件、候选或内部字段。",
  "场景可以即兴细节，但不能把即兴细节当成已经发生的客观事实去改写世界。",
  "世界不围着玩家转：即使玩家吃饭、闲逛、拒绝或提问，已经开始的事仍在继续。",
  "玩家拒绝、观察、闲聊或找不到匹配后果时，不要替他们改成另一个行动。",
  "用自然语言写场景，不要输出 JSON。",
].join("");

export function createSceneClient(client: ModelClient, apiKey: string): SceneClient {
  return {
    async writeScene(request, onChunk) {
      assertNoSecret(request.prompt, apiKey, "observer prompt");
      assertNoSecret(request.playerLine, apiKey, "player line");
      const result = await client.stream({
        role: "narrator",
        purpose: "foreground-scene",
        system: SYSTEM,
        prompt: `${request.prompt}\n\n玩家说：${request.playerLine || "（沉默）"}`,
        ...(onChunk ? { onChunk } : {}),
      });
      return result.text;
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
