import type { ModelClient } from "../model/client.js";
import { assertNoSecret } from "../secrets.js";

export interface NpcReplyRequest {
  name: string;
  pack: string;
  stimulus: string;
}

export interface NpcVoice {
  reply(request: NpcReplyRequest): Promise<string>;
}

const SYSTEM = [
  "你就是这个角色，用第一人称开口。",
  "只能根据当前观察者包里你有权知道的内容回答。",
  "不要使用观察者包以外的世界真相。",
  "不要复述或索取你听不见的私密对话。",
  "普通寒暄和回答不是世界事实，不要编造成必须登记的后果。",
  "不要提及引擎、数据库、候选或内部字段。用自然语言。",
].join("");

export function createNpcVoice(client: ModelClient, apiKey: string): NpcVoice {
  return {
    async reply(request) {
      assertNoSecret(request.pack, apiKey, "npc pack");
      assertNoSecret(request.stimulus, apiKey, "npc stimulus");
      const result = await client.stream({
        role: "npc",
        purpose: "npc-reply",
        system: `${SYSTEM}你的名字是${request.name}。`,
        prompt: `${request.pack}\n\n你听见对方对你说：${request.stimulus}\n请只说你现在会说出口的话。`,
      });
      return result.text;
    },
  };
}

export function stubNpcVoice(): NpcVoice {
  return {
    async reply(request) {
      return `${request.name}：「我听见了。」`;
    },
  };
}
