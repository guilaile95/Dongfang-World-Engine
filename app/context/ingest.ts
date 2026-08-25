import { createHash } from "node:crypto";
import type { ContextItemRecord } from "../persist/store.js";
import { observerNamespace } from "../visibility/pool.js";
import type { WorldSource } from "../world/source.js";

const PUBLIC_NS = "public";

const SECRET_MARKERS =
  /黑王|白王|尼伯龙根|言灵|混血种|卡塞尔|秘党|死侍|龙王|屠龙|血统|炼金|龙族遗迹|guest-li-bag|loc-cellar/;

/**
 * OpenViking is REJECT in-process (AGPLv3; Memory ≠ world authority).
 * Materials are partitioned at ingest: hidden passages never enter `public`.
 */
export function ingestMaterials(source: WorldSource, text: string): ContextItemRecord[] {
  const knowers = hiddenKnowers(source);
  const passages = source.sourceKind === "protocol" ? protocolPassages(text) : structuredPassages(source);
  const items: ContextItemRecord[] = [];
  for (const passage of passages) {
    const hidden = SECRET_MARKERS.test(`${passage.title}\n${passage.body}`);
    if (hidden) {
      for (const knower of knowers) {
        items.push(item(source.id, observerNamespace(knower), passage.title, passage.body));
      }
    } else {
      items.push(item(source.id, PUBLIC_NS, passage.title, passage.body));
    }
  }
  return items;
}

export { PUBLIC_NS };

function hiddenKnowers(source: WorldSource): string[] {
  const hiddenKeys = new Set(
    source.facts.filter((row) => row.visibility === "hidden").map((row) => `${row.subject}|${row.predicate}|${row.object}`),
  );
  const ids = new Set<string>();
  for (const claim of source.claims) {
    const key = `${claim.subject}|${claim.predicate}|${claim.object}`;
    if (hiddenKeys.has(key) || claim.id.includes("dragon") || claim.id.includes("cassel") || claim.id.includes("bag")) {
      for (const row of claim.knownBy) {
        ids.add(row.characterId);
      }
    }
  }
  return [...ids];
}

function protocolPassages(text: string): Array<{ title: string; body: string }> {
  const blocks = text.split(/\n(?=第[一二三四五六七八九十百零〇]+章|【|^[一二三四五六七八九十]+、)/m);
  return blocks.flatMap((block) => {
    const paragraphs = block.split(/\n\s*\n/);
    return paragraphs.flatMap((paragraph) => {
      const trimmed = paragraph.trim();
      if (trimmed.length < 4) {
        return [];
      }
      const first = trimmed.split("\n")[0]?.trim() ?? "passage";
      return [{ title: first.slice(0, 40), body: trimmed.slice(0, 800) }];
    });
  });
}

function structuredPassages(source: WorldSource): Array<{ title: string; body: string }> {
  const out: Array<{ title: string; body: string }> = [];
  for (const rule of source.rules) {
    out.push({ title: `rule:${rule.visibility}`, body: rule.text });
  }
  for (const location of source.locations) {
    out.push({
      title: location.name,
      body: location.visibility === "hidden" ? `${location.name} loc-cellar hidden` : location.name,
    });
  }
  for (const fact of source.facts) {
    out.push({
      title: fact.id,
      body: `${fact.subject} ${fact.predicate} ${fact.object}${fact.visibility === "hidden" ? " guest-li-bag" : ""}`,
    });
  }
  return out;
}

function item(worldId: string, namespace: string, title: string, body: string): ContextItemRecord {
  const id = `ctx-${createHash("sha1").update(`${worldId}|${namespace}|${title}|${body}`).digest("hex").slice(0, 16)}`;
  return { id, worldId, namespace, kind: "lore", title, body, seq: 0 };
}
