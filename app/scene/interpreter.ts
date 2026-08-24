import type { ModelClient } from "../model/client.js";
import { interpretationSchema, type SceneInterpretation } from "./interpretation.js";

export interface InterpretRequest {
  playerLine: string;
  observerPack: string;
  worldId: string;
  playerId: string;
}

export interface SceneInterpreter {
  interpret(request: InterpretRequest): Promise<SceneInterpretation>;
}

const SYSTEM = [
  "你解释玩家的自然语言场景贡献，不是在选引擎动作。",
  "不要输出动作菜单、动词表或 RPG 效果。",
  "contributions 可多选：low_causal, observe, refuse, speak, ask, mixed, world_attempt, durable_attempt, uncertain_attempt。",
  "只有当前具体场景里会对未来有因果价值的结果才把 outcome 设为 candidate，并填写 proposals。",
  "吃饭、闲逛、拒绝、提问、观察、闲聊在没有特殊因果（有毒食物、留下证据、消耗被追踪资源等）时必须 ephemeral，proposals 为空。不要为此发明饥饿或物品系统。",
  "找不到匹配的持久结果时：outcome 用 ephemeral、clarify 或 fail，proposals 必须为空。禁止改成另一个看起来合法的动作。",
  "proposals 只能是 claim_record 或 memory_note。不要 fact_assert，不要拨时间，不要授予 knowledge。",
].join("");

export function createModelInterpreter(client: ModelClient): SceneInterpreter {
  return {
    async interpret(request) {
      const result = await client.generateStructured({
        role: "proposal",
        purpose: "scene-interpretation",
        schema: interpretationSchema,
        system: SYSTEM,
        prompt: [
          request.observerPack,
          `玩家场景贡献：${request.playerLine}`,
          "只解释这一句。不要替玩家改做别的事。",
        ].join("\n"),
      });
      if (!result.object) {
        return {
          contributions: ["uncertain_attempt"],
          futureCausal: false,
          outcome: "fail",
          proposals: [],
        };
      }
      return result.object;
    },
  };
}

export function fixedInterpreter(interpretation: SceneInterpretation): SceneInterpreter {
  return {
    async interpret() {
      return interpretation;
    },
  };
}
