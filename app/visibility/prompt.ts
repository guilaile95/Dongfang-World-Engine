import type { RankedSlice } from "./retrieve.js";

export function packPrompt(slice: RankedSlice): string {
  const present = slice.present.map((row) => row.name).join("、");
  const claims = slice.claims
    .map((row) => `${row.claim.subject} ${row.claim.predicate} ${row.claim.object} (${row.state})`)
    .join("；") || "（无）";
  const memories = slice.memories.map((row) => row.text).join("；") || "（无）";
  const ambient = slice.ambient.join(" ") || "（无）";
  return [
    `世界：${slice.worldName}`,
    `时间：${slice.time}`,
    `地点：${slice.location.name}`,
    `在场：${present}`,
    `公开规则：${slice.publicRules.join("；")}`,
    `你所知的说法：${claims}`,
    `你的印象：${memories}`,
    `当下可见：${ambient}`,
  ].join("\n");
}
