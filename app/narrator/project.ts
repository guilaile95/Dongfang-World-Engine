import type { NarratorEnvelope } from "./envelope.js";

/** Internal Engine markers that must never appear in player-facing prose. */
export const NARRATOR_LEAK_PATTERNS: RegExp[] = [
  /当前状态（权威）/,
  /最近场景（非权威/,
  /\bAuthority\b/,
  /\bCandidate\b/,
  /\bRevision\b/,
  /expectedRevision/,
  /\bValidator\b/,
  /Context packing/,
  /B层|C层|S层/,
  /A→B→C/,
  /\bsourceSeedId\b/,
  /\bsourceEventId\b/,
  /\bITEM_NOT_IN_REACH\b/,
  /\bLOCATION_NOT_REACHABLE\b/,
  /\bWORLD_NOT_FOUND\b/,
  /\bWORLD_SOURCE_\w+\b/,
  /"type"\s*:\s*"(character_move|item_carry|item_place|memory_note|claim_record)"/,
  /"(candidate|proposals|contributions|outcome)"\s*:/,
];

/** Returns true if text contains an internal Engine leak pattern. */
export function hasNarrationLeak(text: string): boolean {
  return NARRATOR_LEAK_PATTERNS.some((re) => re.test(text));
}

export const NARRATOR_SYSTEM = [
  "你是世界叙述者。你唯一的任务是：把已经允许你看见的信息写成玩家能读的故事场景。",
  "只写玩家在故事世界中实际看到、听到、感受到的事。",
  "你可以增加语气、动作质感、环境氛围，以及不参与未来因果的临时细节。",
  "你不得单方面制造：位置变化、死亡、永久伤势、重要物品获得或消失、知识获得、重大能力、世界规则变化，或其他将来会参与因果的重要事实。",
  "已提交的后果只能当作已经发生的事来描写，不能加戏成新的事实。",
  "没有新的已提交后果时：禁止写「你已经到了」「你走进了」「你拿到了」「你放下了」这类完成态。",
  "被拒绝的持久企图不是降级后的『正在做』。不能描写已经摸到、抓住、整理肩带、背上、放下、走进或到达这些被拒绝的对象或地点。只能写意图、无法完成，以及已给出的可见失败原因。",
  "NPC 回复：保持他们说出口的意思，不要补充他们不知道的秘密。",
  "直接写场景故事。禁止出现：Authority、Candidate、Revision、权威层、非权威、Context、proposal、commit、数据库、B层、C层、S层、A→B→C、SQLite、sourceSeedId、sourceEventId、expectedRevision，或任何 JSON 字段名。",
  "不要用「当前状态」「最近场景」等内部结构标题开头。直接写叙事正文。",
  "使用 Markdown 格式提高可读性：段落分明、关键动作或对话可用 **粗体**，场景转换可用 ---，引用 NPC 对话用「」。",
  "你写的是文学化叙事，不是报告。不要每轮汇报世界数据库状态。",
].join("\n");

export function renderNarratorPrompt(envelope: NarratorEnvelope): string {
  const committed = envelope.committed.length > 0 ? envelope.committed.join("；") : "（本轮没有新的已提交后果）";
  const uncommitted = envelope.uncommitted.length > 0
    ? envelope.uncommitted.join("；")
    : "（本轮没有被拒绝的持久企图）";
  const npc = envelope.npcReply
    ? `${envelope.npcReply.name}已经说出口：「${envelope.npcReply.line}」`
    : "（没有合法 NPC 开口）";
  const ambient = envelope.ephemeral.ambient.join(" ") || "（无）";
  return [
    envelope.observerContext,
    `【玩家行动】${envelope.playerContribution || "（沉默）"}`,
    `【已发生】${committed}`,
    `【未发生】${uncommitted}`,
    `【NPC】${npc}`,
    `【氛围】${ambient}`,
  ].join("\n");
}
