import { z } from "zod";
import type { ModelClient } from "../model/client.js";
import type { WorldSnapshot } from "../authority/types.js";
import type { CompiledWorld } from "../world/compile.js";

export const stopReasonSchema = z.enum(["new_risk", "direction_choice", "material_information", "meaningful_npc_request", "obstacle", "destination_reached", "none"]);
export type StopReason = z.infer<typeof stopReasonSchema>;
const optionSchema = z.object({ key: z.enum(["A", "B", "C", "D", "E", "F"]), text: z.string().min(1), type: z.enum(["constructive", "extreme", "absurd"]) });
export const sceneStopDecisionSchema = z.object({
  shouldStop: z.boolean(), stopReason: stopReasonSchema, decisionSummary: z.string().nullable(), options: z.array(optionSchema).length(6).nullable(),
}).superRefine((row, ctx) => {
  if (!row.shouldStop && (row.stopReason !== "none" || row.options !== null)) ctx.addIssue({ code: "custom", message: "continue requires none/null" });
  if (row.shouldStop && (row.stopReason === "none" || !row.decisionSummary)) ctx.addIssue({ code: "custom", message: "stop requires reason and summary" });
});
export type SceneStopDecision = z.infer<typeof sceneStopDecisionSchema>;

export interface StopRequest {
  visibleContext: string;
  hardStopReason: Exclude<StopReason, "none"> | null;
  evidence: string[];
  strategyComplete: boolean;
}

export interface SceneStopDecider { decide(request: StopRequest): Promise<SceneStopDecision | null>; }

export function createModelStopDecider(client: ModelClient): SceneStopDecider {
  return {
    async decide(request) {
      const result = await client.generateStructured({
        role: "proposal", purpose: "scene-stop-decision", schema: sceneStopDecisionSchema,
        system: [
          "判断当前场景是否出现了新的、真正属于玩家的决定。只输出 JSON。",
          "普通走路、下楼、收拾、等待、已选路线的继续执行不是新决定。",
          "只有新风险、方向选择、重要信息、重要请求、障碍或抵达目的地才能停止。",
          "停止时给 A-F 六个普通自然语言意图；A-D 有实质差异，E 高风险，F 可执行但荒诞。不得承诺尚未发生的结果。",
          request.hardStopReason ? `代码已确定必须停止，stopReason 必须为 ${request.hardStopReason}。` : "没有代码硬停；若无新决定则 shouldStop=false。",
        ].join("\n"),
        prompt: [request.visibleContext, `证据：${request.evidence.join("；") || "无"}`, `既有策略完成：${request.strategyComplete}`].join("\n"),
      });
      return result.object;
    },
  };
}

export function fixedStopDecider(): SceneStopDecider {
  return {
    async decide(request) {
      if (!request.hardStopReason) return { shouldStop: false, stopReason: "none", decisionSummary: null, options: null };
      const options: SceneStopDecision["options"] = [
        { key: "A", text: "先停下来观察眼前的变化", type: "constructive" },
        { key: "B", text: "向附近的人询问发生了什么", type: "constructive" },
        { key: "C", text: "保持距离，继续原本的日常安排", type: "constructive" },
        { key: "D", text: "换一个安全方向离开现场", type: "constructive" },
        { key: "E", text: "直接靠近异常动静追查到底", type: "extreme" },
        { key: "F", text: "假装自己是记者并现场采访路人", type: "absurd" },
      ];
      return { shouldStop: true, stopReason: request.hardStopReason, decisionSummary: request.evidence[0] ?? "眼前出现了新的变化。", options };
    },
  };
}

export function groundStopDecision(decision: SceneStopDecision, snapshot: WorldSnapshot, compiled: CompiledWorld, playerId: string): SceneStopDecision {
  if (!decision.shouldStop || !decision.options) return decision;
  const player = snapshot.characters.find((row) => row.id === playerId);
  const visible = new Set(snapshot.characters.filter((row) => row.locationId === player?.locationId).map((row) => row.name));
  const invalidNames = snapshot.characters.filter((row) => !visible.has(row.name) || !compiled.characterMetadata[row.id]?.alive || compiled.characterMetadata[row.id]?.visibility === "hidden").map((row) => row.name);
  const safe = decision.options.filter((option) => {
    if (/\b(?:char|loc|route|fact|claim|thread)-[\w-]+\b|expectedRevision|Authority|Candidate/i.test(option.text)) return false;
    if (/保证|必然|一定会|确保.*成功|已经(?:到达|得到|说服|击败)/.test(option.text)) return false;
    return !invalidNames.some((name) => name.length > 1 && option.text.includes(name));
  });
  return safe.length === 6 ? decision : { ...decision, options: null };
}
