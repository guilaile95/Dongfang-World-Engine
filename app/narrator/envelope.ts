import type { WorldSnapshot } from "../authority/types.js";
import type { BoundInterpretation } from "../scene/interpretation.js";
import { ephemeralInterpretation, type SceneInterpretation } from "../scene/interpretation.js";

export interface PromptComposition {
  longTermSetting: string;
  scenario: string;
  characterization: string;
  playerPersona: string;
  styleAnchors: string[];
  sceneReinforcement: string;
  visibleWorld: string;
  recentHistory: string[];
  currentInput: string;
}

/** The only payload the Narrator may see. Not a WorldSnapshot. */
export interface NarratorEnvelope {
  playerContribution: string;
  observerContext: string;
  committed: string[];
  uncommitted: string[];
  npcReply: { name: string; line: string } | null;
  ephemeral: {
    recentScenes: string[];
    ambient: string[];
  };
  promptComposition?: PromptComposition;
}

export function committedProjection(
  bound: BoundInterpretation,
  observerId: string,
  snapshot?: WorldSnapshot,
): string[] {
  if (!bound.submitted || !bound.result.accepted) {
    return [];
  }
  const lines: string[] = [];
  for (const event of bound.result.events) {
    const payload = event.payload;
    if (event.type === "memory_note" && typeof payload["text"] === "string") {
      if (payload["characterId"] === observerId) {
        lines.push(`已记下你的印象：${payload["text"]}`);
      } else if (typeof payload["characterId"] === "string") {
        lines.push(`对方记下了你说的话（印象，不是客观事实）：${payload["text"]}`);
      }
    }
    if (
      event.type === "claim_record" &&
      typeof payload["subject"] === "string" &&
      typeof payload["predicate"] === "string" &&
      typeof payload["object"] === "string"
    ) {
      lines.push(
        `一种说法被记录：${payload["subject"]} ${payload["predicate"]} ${payload["object"]}（不是自动成为谁的知识，也不是客观事实）`,
      );
    }
    if (event.type === "character_move" && typeof payload["locationId"] === "string") {
      const name = snapshot?.locations.find((row) => row.id === payload["locationId"])?.name;
      lines.push(`你已到达地点：${name ?? payload["locationId"]}`);
    }
    if (event.type === "item_place" && typeof payload["itemId"] === "string") {
      const item = snapshot?.items.find((row) => row.id === payload["itemId"])?.name;
      const loc = snapshot?.locations.find((row) => row.id === payload["locationId"])?.name;
      lines.push(`你放下了物品：${item ?? payload["itemId"]}（在 ${loc ?? String(payload["locationId"] ?? "")}）`);
    }
    if (event.type === "item_carry" && typeof payload["itemId"] === "string") {
      const item = snapshot?.items.find((row) => row.id === payload["itemId"])?.name;
      lines.push(`你带着物品：${item ?? payload["itemId"]}`);
    }
  }
  return lines;
}

/** Rejected durable attempts are not “still happening” in the world. */
export function uncommittedProjection(
  raw: SceneInterpretation,
  bound: BoundInterpretation,
): string[] {
  if (bound.submitted && bound.result.accepted) {
    return [];
  }
  const lines: string[] = [];
  for (const proposal of raw.proposals) {
    if (proposal.type === "character_move") {
      lines.push(`未发生：到达「${proposal.location}」`);
    }
    if (proposal.type === "item_place") {
      lines.push(`未发生：放下「${proposal.item}」`);
    }
    if (proposal.type === "item_carry") {
      lines.push(`未发生：拿起或背上「${proposal.item}」`);
    }
  }
  if (lines.length > 0 && bound.result.reasons.length > 0) {
    lines.push(`原因：${bound.result.reasons.join("，")}`);
  }
  return lines;
}

/** Narrator prose is never a Candidate. Causal needs a later Candidate → Authorization → Commit. */
export function ignoreNarratorForAuthority(_text: string): SceneInterpretation {
  return ephemeralInterpretation();
}
