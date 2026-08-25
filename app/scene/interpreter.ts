import type { ModelClient } from "../model/client.js";
import { interpretationFailureFrom, persistInterpretationFailure } from "./failure-log.js";
import { interpretationSchema, type SceneInterpretation } from "./interpretation.js";

export interface InterpretRequest {
  playerLine: string;
  observerPack: string;
  worldId: string;
  playerId: string;
}

export interface InterpretResult {
  interpretation: SceneInterpretation;
  parsed: boolean;
}

export interface SceneInterpreter {
  interpret(request: InterpretRequest): Promise<InterpretResult>;
}

export const INTERPRETER_SYSTEM = [
  "你解释玩家的自然语言场景贡献，不是在选引擎动作。",
  "不要输出动作菜单、动词表或 RPG 效果。",
  "只输出 JSON。",
  "contributions 可多选：low_causal, observe, refuse, speak, ask, mixed, world_attempt, durable_attempt, uncertain_attempt。",
  "只有当前具体场景里会对未来有因果价值的结果才把 outcome 设为 candidate，并填写 proposals。",
  "吃饭、闲逛、拒绝、提问、观察、闲聊在没有特殊因果（有毒食物、留下证据、消耗被追踪资源等）时必须 ephemeral，proposals 为空。不要为此发明饥饿或物品系统。",
  "找不到匹配的持久结果时：outcome 用 ephemeral、clarify 或 fail，proposals 必须为空。禁止改成另一个看起来合法的动作。",
  "proposals 只能是 claim_record 或 memory_note。不要 fact_assert，不要拨时间，不要授予 knowledge。",
  "memory_note 合法字段只能是 type, text, 以及可选 characterId。禁止 content、message、value 或其他替代字段。",
  "claim_record 合法字段只能是 type, subject, predicate, object。禁止 content、message、value 或其他替代字段。",
  '合法 shape 示例：{"contributions":["speak"],"futureCausal":true,"outcome":"candidate","proposals":[{"type":"memory_note","text":"..."}]}',
  '合法 shape 示例：{"contributions":["speak"],"futureCausal":true,"outcome":"candidate","proposals":[{"type":"claim_record","subject":"...","predicate":"...","object":"..."}]}',
  '合法 shape 示例：{"contributions":["low_causal"],"futureCausal":false,"outcome":"ephemeral","proposals":[]}',
].join("");

export function createModelInterpreter(client: ModelClient, apiKey: string): SceneInterpreter {
  return {
    async interpret(request) {
      const result = await client.generateStructured({
        role: "proposal",
        purpose: "scene-interpretation",
        schema: interpretationSchema,
        system: INTERPRETER_SYSTEM,
        prompt: [
          request.observerPack,
          `玩家场景贡献：${request.playerLine}`,
          "只解释这一句。不要替玩家改做别的事。",
        ].join("\n"),
      });
      if (!result.object) {
        persistInterpretationFailure(interpretationFailureFrom(request.playerLine, result.record), apiKey);
        return {
          interpretation: {
            contributions: ["uncertain_attempt"],
            futureCausal: false,
            outcome: "fail",
            proposals: [],
          },
          parsed: false,
        };
      }
      return { interpretation: result.object, parsed: true };
    },
  };
}

export function fixedInterpreter(
  interpretation: SceneInterpretation,
  parsed = true,
): SceneInterpreter {
  return {
    async interpret() {
      return { interpretation, parsed };
    },
  };
}
