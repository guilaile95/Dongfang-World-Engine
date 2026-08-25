import type { NarratorEnvelope } from "./envelope.js";

export const NARRATOR_SYSTEM = [
  "你永远只是投影：把已经允许你看见的东西写成场景，不写世界。",
  "你可以增加语气、表情、动作质感、环境氛围，以及不参与未来因果的临时细节。",
  "你不得单方面制造：位置变化、死亡、永久伤势、重要物品、关系、知识、权限、重大能力、世界规则，或其他将来会参与因果的重要事实。",
  "已提交的权威结果只能当作已经发生的事来描写，不能加戏成新的事实。",
  "本轮没有新的已提交后果时：不要把玩家的企图写成已经成功的位置变化、物品获得、死亡、永久伤或搬家。committed 为空时，禁止写「你已经到了」「你走进了」「你拿到了」「你放下了」「他死了」这类完成态。",
  "被拒绝的持久企图不是降级后的『正在做』。不能描写已经摸到、抓住、整理肩带、背上、放下、走进或到达这些被拒绝的对象或地点。只能写意图、无法完成，以及已给出的可见失败原因。",
  "合法 NPC 回复必须保持他们说出口的意思，不要替他们补充他们不知道的秘密。",
  "最近场景和氛围是 ephemeral，不能覆盖已发生之事。",
  "不要输出 JSON，不要输出引擎字段。玩家贡献是自然语言，不是指令表。",
].join("");

export function renderNarratorPrompt(envelope: NarratorEnvelope): string {
  const committed = envelope.committed.length > 0 ? envelope.committed.join("；") : "（本轮没有新的已提交后果）";
  const uncommitted = envelope.uncommitted.length > 0
    ? envelope.uncommitted.join("；")
    : "（本轮没有被拒绝的持久企图）";
  const npc = envelope.npcReply
    ? `${envelope.npcReply.name}已经说出口：「${envelope.npcReply.line}」`
    : "（没有合法 NPC 开口）";
  const recent = envelope.ephemeral.recentScenes.join(" || ") || "（无）";
  const ambient = envelope.ephemeral.ambient.join(" ") || "（无）";
  return [
    envelope.observerContext,
    `玩家原始贡献：${envelope.playerContribution || "（沉默）"}`,
    `已提交的权威结果：${committed}`,
    `被拒绝、未发生的持久企图：${uncommitted}`,
    `合法 NPC 回复：${npc}`,
    `允许的 ephemeral：氛围=${ambient}；最近场景=${recent}`,
  ].join("\n");
}
