import type { CharacterRecord, WorldSnapshot } from "../authority/types.js";

/** Same-place NPCs whose name the player actually used. Not an action menu. */
export function resolveAddressee(
  snapshot: WorldSnapshot,
  speakerId: string,
  playerLine: string,
): CharacterRecord | null {
  const speaker = snapshot.characters.find((row) => row.id === speakerId);
  if (!speaker) {
    return null;
  }
  const present = snapshot.characters.filter(
    (row) => row.kind === "npc" && row.id !== speakerId && row.locationId === speaker.locationId,
  );
  let best: CharacterRecord | null = null;
  let bestLen = 0;
  for (const npc of present) {
    for (const alias of nameAliases(npc.name)) {
      if (playerLine.includes(alias) && alias.length > bestLen) {
        best = npc;
        bestLen = alias.length;
      }
    }
  }
  return best;
}

export function continueAddressee(
  snapshot: WorldSnapshot,
  speakerId: string,
  playerLine: string,
  lastId: string | null,
): CharacterRecord | null {
  const named = resolveAddressee(snapshot, speakerId, playerLine);
  if (named) {
    return named;
  }
  if (!lastId) {
    return null;
  }
  const last = snapshot.characters.find((row) => row.id === lastId);
  if (!last || last.kind !== "npc") {
    return null;
  }
  return canHear(snapshot, speakerId, last.id) ? last : null;
}

export function canHear(
  snapshot: WorldSnapshot,
  speakerId: string,
  listenerId: string,
): boolean {
  const speaker = snapshot.characters.find((row) => row.id === speakerId);
  const listener = snapshot.characters.find((row) => row.id === listenerId);
  return Boolean(speaker && listener && speaker.locationId === listener.locationId);
}

function nameAliases(name: string): string[] {
  const aliases = [name];
  if (/^[\u4e00-\u9fff]+$/.test(name) && name.length >= 2) {
    aliases.push(name.slice(0, 2));
    if (name.length >= 3) {
      aliases.push(name.slice(-2));
    }
  }
  return [...new Set(aliases.filter((item) => item.length >= 2))];
}
