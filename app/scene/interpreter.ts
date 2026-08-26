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
  "channel 只能是 in_world 或 ooc_meta；只有显式 /ooc 才用 ooc_meta。",
  "contributions 可多选：low_causal, observe, refuse, speak, ask, mixed, world_attempt, durable_attempt, uncertain_attempt。",
  "只有当前具体场景里会对未来有因果价值的结果才把 outcome 设为 candidate，并填写 proposals。",
  "吃饭、闲逛、拒绝、提问、观察、闲聊在没有特殊因果（有毒食物、留下证据、消耗被追踪资源等）时必须 ephemeral，proposals 为空。不要为此发明饥饿或物品系统。",
  "找不到匹配的持久结果时：outcome 用 ephemeral、clarify 或 fail，proposals 必须为空。禁止改成另一个看起来合法的动作。",
  "proposals 只能是 claim_record、memory_note、character_move、item_place、item_carry。不要 fact_assert，不要拨时间，不要授予 knowledge。",
  "timePolicy 必须描述本句的时间：观察/短答 none；普通动作 bounded_action；明确等待 explicit_wait；选择已有路线 route_travel。",
  "玩家已经明确选定路线、等待或继续当前任务时填写 strategyIntent；不得替玩家发明新路线或新策略。路线 ID 必须来自上下文的【可用路线】。",
  "如果上下文已有未完成路线且玩家明确说继续当前路线，strategyIntent.kind 用 continue_current_task；若模型仍返回 follow_route，必须复用同一 routeId 表示继续该 pending route，不得从起点重开。",
  "memory_note 合法字段只能是 type, text, 以及可选 characterId。禁止 content、message、value。写日记/自己记下：用 memory_note，不要填别人的 characterId。这是玩家自己的印象，不是 Fact，也不是别人的 Knowledge。",
  "对在场的人明确说「记住」「别忘」「这是我们说定的」且内容之后还用得上：必须 memory_note，characterId 为对方。不要升成 Fact 或 Knowledge。天气、吃饭、闲聊不要因此写 Memory。",
  "claim_record 合法字段只能是 type, subject, predicate, object。禁止 content。",
  "character_move 合法字段只能是 type, location（已有地点的中文名）。禁止编造不存在的地点。回家用「家」，走进食堂用「食堂」。",
  "item_place 合法字段只能是 type, item, 可选 location。item_carry 合法字段只能是 type, item。桌上/这里表示当前所在地点，不要编造家具地点。",
  "一句可以有多个 proposals，例如走进宿舍并放下书包，必须同时给出 character_move 和 item_place，不能只写其中一个。",
  '合法 shape 示例：{"contributions":["speak"],"futureCausal":true,"outcome":"candidate","proposals":[{"type":"memory_note","text":"..."}]}',
  '合法 shape 示例：{"contributions":["world_attempt"],"futureCausal":true,"outcome":"candidate","proposals":[{"type":"character_move","location":"食堂"}]}',
  '合法 shape 示例：{"contributions":["mixed"],"futureCausal":true,"outcome":"candidate","proposals":[{"type":"character_move","location":"宿舍"},{"type":"item_place","item":"书包","location":"宿舍"}]}',
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
