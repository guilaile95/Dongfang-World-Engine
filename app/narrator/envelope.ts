import type { BoundInterpretation } from "../scene/interpretation.js";
import { ephemeralInterpretation, type SceneInterpretation } from "../scene/interpretation.js";

/** The only payload the Narrator may see. Not a WorldSnapshot. */
export interface NarratorEnvelope {
  playerContribution: string;
  observerContext: string;
  committed: string[];
  npcReply: { name: string; line: string } | null;
  ephemeral: {
    recentScenes: string[];
    ambient: string[];
  };
}

export function committedProjection(bound: BoundInterpretation, observerId: string): string[] {
  if (!bound.submitted || !bound.result.accepted) {
    return [];
  }
  const lines: string[] = [];
  for (const event of bound.result.events) {
    const payload = event.payload;
    if (event.type === "memory_note" && payload["characterId"] === observerId && typeof payload["text"] === "string") {
      lines.push(`已记下你的印象：${payload["text"]}`);
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
  }
  return lines;
}

/** Narrator prose is never a Candidate. Causal needs a later Candidate → Authorization → Commit. */
export function ignoreNarratorForAuthority(_text: string): SceneInterpretation {
  return ephemeralInterpretation();
}
