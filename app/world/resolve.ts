import type { ItemRecord, WorldSnapshot } from "../authority/types.js";

const LOCATION_ALIASES: Array<{ key: string; id: string }> = [
  { key: "刚才那家便利店", id: "loc-store" },
  { key: "大学校园", id: "loc-campus" },
  { key: "校园食堂", id: "loc-cafeteria" },
  { key: "教学楼", id: "loc-teaching" },
  { key: "便利店", id: "loc-store" },
  { key: "卡塞尔", id: "loc-cassel" },
  { key: "食堂", id: "loc-cafeteria" },
  { key: "宿舍", id: "loc-dorm" },
  { key: "回家", id: "loc-home" },
  { key: "家里", id: "loc-home" },
  { key: "厨房", id: "loc-kitchen" },
  { key: "地窖", id: "loc-cellar" },
  { key: "堂屋", id: "loc-hall" },
  { key: "柜台", id: "loc-hall" },
  { key: "街上", id: "loc-city" },
  { key: "路边", id: "loc-city" },
  { key: "校园", id: "loc-campus" },
  { key: "城市", id: "loc-city" },
  { key: "我家", id: "loc-home" },
  { key: "家", id: "loc-home" },
];

const DEST_RE = /(?:离开.{0,12}(?:，|,|然后|再)?)?(?:走进|进入|回到|前往|来到|抵达|去到|去|到|回)([^，。！？]*)/;

export function resolveLocationId(snapshot: WorldSnapshot, phrase: string): string | null {
  const text = phrase.trim();
  if (!text) {
    return null;
  }
  if (snapshot.locations.some((row) => row.id === text)) {
    return text;
  }
  const dest = text.match(DEST_RE)?.[1]?.trim();
  if (dest) {
    const resolved = matchLocation(snapshot, dest);
    if (resolved) {
      return resolved;
    }
  }
  return matchLocation(snapshot, text);
}

function matchLocation(snapshot: WorldSnapshot, text: string): string | null {
  const exactName = snapshot.locations.filter((row) => row.name === text);
  if (exactName.length === 1 && exactName[0]) {
    return exactName[0].id;
  }

  const hits: Array<{ id: string; length: number; index: number }> = [];
  for (const alias of LOCATION_ALIASES) {
    if (!snapshot.locations.some((row) => row.id === alias.id)) {
      continue;
    }
    if (alias.key === "家" && /(那家|这家|哪家|某家|店家|人家|大家|厂家)/.test(text) && !/(回家|家里|我家|自家)/.test(text)) {
      continue;
    }
    const index = text.lastIndexOf(alias.key);
    if (index >= 0) {
      hits.push({ id: alias.id, length: alias.key.length, index });
    }
  }
  for (const location of snapshot.locations) {
    if (location.name.length < 1) {
      continue;
    }
    if (location.name === "家" && /(那家|这家|哪家|某家)/.test(text) && !/(回家|家里|我家|自家)/.test(text)) {
      continue;
    }
    const index = text.lastIndexOf(location.name);
    if (index >= 0) {
      hits.push({ id: location.id, length: location.name.length, index });
    }
  }
  if (hits.length === 0) {
    return null;
  }
  hits.sort((a, b) => b.length - a.length || b.index - a.index);
  const best = hits[0];
  if (!best) {
    return null;
  }
  const tied = hits.filter((row) => row.length === best.length && row.index === best.index);
  const ids = new Set(tied.map((row) => row.id));
  if (ids.size !== 1) {
    return null;
  }
  return best.id;
}

export function resolveItemId(snapshot: WorldSnapshot, phrase: string): string | null {
  const text = phrase.trim();
  if (!text) {
    return null;
  }
  const byId = snapshot.items.find((row) => row.id === text);
  if (byId) {
    return byId.id;
  }
  const named = snapshot.items.filter((row) => text.includes(row.name) || row.name.includes(text));
  if (named.length === 1 && named[0]) {
    return named[0].id;
  }
  if (named.length > 1) {
    const longest = [...named].sort((a, b) => b.name.length - a.name.length);
    if (longest[0] && longest.filter((row) => row.name.length === longest[0]?.name.length).length === 1) {
      return longest[0].id;
    }
    return null;
  }
  if (text.includes("书包")) {
    return snapshot.items.find((row) => row.id === "item-bag" || row.name.includes("书包"))?.id ?? null;
  }
  if (text.includes("钥匙")) {
    return snapshot.items.find((row) => row.id === "item-key" || row.name.includes("钥匙"))?.id ?? null;
  }
  return null;
}

export function itemAt(snapshot: WorldSnapshot, itemId: string): ItemRecord | null {
  return snapshot.items.find((row) => row.id === itemId) ?? null;
}
