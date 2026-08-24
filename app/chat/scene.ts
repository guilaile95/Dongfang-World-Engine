import type { ModelClient } from "../model/client.js";
import { assertNoSecret } from "../secrets.js";

export interface SceneRequest {
  prompt: string;
  playerLine: string;
  heardNpc?: { name: string; line: string };
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
  "最近场景只是刚发生的来往，不是客观事实，不能用它改写已经发生的事。",
  "用自然语言写场景，不要输出 JSON。",
].join("");

export function createSceneClient(client: ModelClient, apiKey: string): SceneClient {
  return {
    async writeScene(request, onChunk) {
      assertNoSecret(request.prompt, apiKey, "observer prompt");
      assertNoSecret(request.playerLine, apiKey, "player line");
      const heard = request.heardNpc
        ? `\n\n你听见${request.heardNpc.name}说：${request.heardNpc.line}\n写场景时把这句话当作他们已经出口的话，不要替他们补充他们没说的秘密。`
        : "";
      const result = await client.stream({
        role: "narrator",
        purpose: "foreground-scene",
        system: SYSTEM,
        prompt: `${request.prompt}\n\n玩家说：${request.playerLine || "（沉默）"}${heard}`,
        ...(onChunk ? { onChunk } : {}),
      });
      return result.text;
    },
  };
}

export function stubSceneClient(): SceneClient {
  return {
    async writeScene(request, onChunk) {
      const heard = request.heardNpc ? `\n${request.heardNpc.name}：「${request.heardNpc.line}」` : "";
      const text = `${request.prompt}\n\n> ${request.playerLine || "……"}${heard}`;
      onChunk?.(text);
      return text;
    },
  };
}
