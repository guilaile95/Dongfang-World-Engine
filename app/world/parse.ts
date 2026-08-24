import { createHash } from "node:crypto";
import type { KnowledgeState } from "../authority/types.js";
import type { Visibility, WorldSource } from "./source.js";

const KNOWN_IDS: Record<string, string> = {
  龙族: "longzu",
  神秘复苏: "shenmi-fusu",
  修仙世界: "xiuxian",
};

export function parseWorldSource(text: string): WorldSource {
  if (isProtocolDocument(text)) {
    return parseProtocol(text);
  }
  return parseStructured(text);
}

export function isProtocolDocument(text: string): boolean {
  return /第[一二三四五六七八九十百零〇]+章/.test(text) && text.includes("【") && !/^## Locations/m.test(text);
}

function parseStructured(text: string): WorldSource {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let packageTitle = "world";
  let id = "";
  let publicName = "";
  let time = "t0";
  let i = 0;
  while (i < lines.length && !lines[i]?.startsWith("## ")) {
    const line = lines[i]?.trim() ?? "";
    if (line.startsWith("# ")) {
      packageTitle = line.slice(2).trim();
    } else if (line.startsWith("id:")) {
      id = line.slice(3).trim();
    } else if (line.startsWith("public_name:")) {
      publicName = line.slice(12).trim();
    } else if (line.startsWith("time:")) {
      time = line.slice(5).trim();
    }
    i += 1;
  }
  const sections = splitSections(lines.slice(i).join("\n"));
  const rules = parseRules(sections.get("Rules") ?? sections.get("Canon") ?? "");
  const locations = parseLocations(sections.get("Locations") ?? "");
  const characters = parseCharacters(sections.get("Characters") ?? "");
  const facts = parseFacts(sections.get("Facts") ?? "");
  const claims = parseClaims(sections.get("Claims") ?? "");
  const theme = parseTheme(sections.get("Theme") ?? "", characters);
  if (!id) {
    id = worldIdFromTitle(packageTitle);
  }
  if (!publicName) {
    publicName = packageTitle;
  }
  if (locations.length === 0 || characters.length === 0) {
    throw new Error("WORLD_SOURCE_EMPTY: structured source needs Locations and Characters");
  }
  return {
    id,
    packageTitle,
    publicName,
    time,
    sourceKind: "structured",
    rules,
    locations,
    characters,
    facts,
    claims,
    theme,
  };
}

function parseProtocol(text: string): WorldSource {
  const titleLine = text.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0) ?? "world";
  const packageTitle = titleLine.replace(/《|》/g, "").split(/[·—\-]/)[0]?.trim() || titleLine;
  const id = worldIdFromTitle(packageTitle);
  const ch1 = chapter(text, "一");
  const rules = [...ch1.matchAll(/^[一二三四五六七八九十]+、(.+)$/gm)].map((match) => ({
    text: match[1]?.trim() ?? "",
    visibility: "public" as const,
  })).filter((row) => row.text.length > 0);

  const locations: WorldSource["locations"] = [
    { id: "loc-city", name: "普通城市", visibility: "public" },
    { id: "loc-campus", name: "普通大学校园", visibility: "public" },
  ];
  if (text.includes("卡塞尔")) {
    locations.push({ id: "loc-cassel", name: "卡塞尔学院", visibility: "hidden" });
  }

  const named = namedCharacters(chapter(text, "十六"));
  const hybridId = "char-hybrid";
  const characters: WorldSource["characters"] = [
    { id: "char-player", name: "普通人", kind: "player", locationId: "loc-city" },
    { id: "char-roommate", name: "同学", kind: "npc", locationId: "loc-city" },
    {
      id: hybridId,
      name: "隐秘行动者",
      kind: "npc",
      locationId: locations.some((row) => row.id === "loc-cassel") ? "loc-cassel" : "loc-city",
      theme: true,
    },
    ...named.map((person) => ({
      id: person.id,
      name: person.name,
      kind: "npc" as const,
      locationId: locations.some((row) => row.id === "loc-cassel") ? "loc-cassel" : "loc-city",
    })),
  ];

  const facts: WorldSource["facts"] = [];
  const claims: WorldSource["claims"] = [];
  const knowers = [hybridId, ...named.map((person) => person.id)];
  if (/龙族|混血种|屠龙/.test(text)) {
    facts.push({
      id: "fact-dragons-exist",
      subject: "dragons",
      predicate: "exist",
      object: "true",
      visibility: "hidden",
    });
    claims.push({
      id: "claim-dragons-exist",
      subject: "dragons",
      predicate: "exist",
      object: "true",
      knownBy: knowers.map((characterId) => ({ characterId, state: "confirmed" as const })),
    });
  }
  if (text.includes("卡塞尔")) {
    facts.push({
      id: "fact-cassel-academy",
      subject: "cassel",
      predicate: "is",
      object: "mixed-blood-academy",
      visibility: "hidden",
    });
    claims.push({
      id: "claim-cassel-academy",
      subject: "cassel",
      predicate: "is",
      object: "mixed-blood-academy",
      knownBy: knowers.map((characterId) => ({ characterId, state: "confirmed" as const })),
    });
  }
  claims.push({
    id: "claim-city-missing",
    subject: "city-news",
    predicate: "reports",
    object: "unsolved-missing-person",
    knownBy: [{ characterId: "char-roommate", state: "rumor" }],
  });

  return {
    id,
    packageTitle,
    publicName: "当代世界",
    time: "当代",
    sourceKind: "protocol",
    rules: rules.length > 0
      ? rules
      : [{ text: "世界不围绕玩家存在", visibility: "public" }],
    locations,
    characters,
    facts,
    claims,
    theme: {
      characterId: hybridId,
      memory: "隐秘一侧的调查还没结束，不能因为市井日常就把已经开始的事放下。",
      publicBeat: "街头新闻仍在报一桩没有结案的失踪。",
      publicBeatScope: "public_world",
    },
  };
}

function splitSections(body: string): Map<string, string> {
  const map = new Map<string, string>();
  const parts = body.split(/^## /m).filter((part) => part.trim().length > 0);
  for (const part of parts) {
    const newline = part.indexOf("\n");
    const name = (newline < 0 ? part : part.slice(0, newline)).trim();
    const content = newline < 0 ? "" : part.slice(newline + 1);
    map.set(name, content);
  }
  return map;
}

function parseRules(body: string): WorldSource["rules"] {
  return body.split("\n").flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return [];
    }
    const tagged = trimmed.match(/^\[(public|hidden)\]\s*(.+)$/);
    if (tagged) {
      return [{ visibility: tagged[1] as Visibility, text: tagged[2] ?? "" }];
    }
    return [{ visibility: "public" as const, text: trimmed }];
  });
}

function parseLocations(body: string): WorldSource["locations"] {
  return splitSub(body).map((block) => ({
    id: block.id,
    name: field(block.fields, "name") || block.id,
    visibility: vis(field(block.fields, "visibility")),
  }));
}

function parseCharacters(body: string): WorldSource["characters"] {
  return splitSub(body).map((block) => ({
    id: block.id,
    name: field(block.fields, "name") || block.id,
    kind: field(block.fields, "kind") === "player" ? "player" : "npc",
    locationId: field(block.fields, "location"),
    theme: field(block.fields, "theme") === "true",
  }));
}

function parseFacts(body: string): WorldSource["facts"] {
  return splitSub(body).map((block) => ({
    id: block.id,
    subject: field(block.fields, "subject"),
    predicate: field(block.fields, "predicate"),
    object: field(block.fields, "object"),
    visibility: vis(field(block.fields, "visibility")),
  }));
}

function parseClaims(body: string): WorldSource["claims"] {
  return splitSub(body).map((block) => ({
    id: block.id,
    subject: field(block.fields, "subject"),
    predicate: field(block.fields, "predicate"),
    object: field(block.fields, "object"),
    knownBy: parseKnown(field(block.fields, "known")),
  }));
}

function parseTheme(body: string, characters: WorldSource["characters"]): WorldSource["theme"] {
  const fields = Object.fromEntries(
    body.split("\n").flatMap((line) => {
      const idx = line.indexOf(":");
      if (idx <= 0) {
        return [];
      }
      return [[line.slice(0, idx).trim(), line.slice(idx + 1).trim()] as const];
    }),
  );
  const themed = characters.find((row) => row.theme);
  const characterId = fields.character || themed?.id || characters.find((row) => row.kind === "npc")?.id || "";
  const scope = fields.public_scope === "public_world" ? "public_world" : "same_location";
  return {
    characterId,
    memory: fields.memory ?? "",
    publicBeat: fields.public ?? "",
    publicBeatScope: scope,
  };
}

function splitSub(body: string): Array<{ id: string; fields: Record<string, string> }> {
  return body.split(/^### /m).filter((part) => part.trim().length > 0).map((part) => {
    const newline = part.indexOf("\n");
    const id = (newline < 0 ? part : part.slice(0, newline)).trim();
    const rest = newline < 0 ? "" : part.slice(newline + 1);
    const fields: Record<string, string> = {};
    for (const line of rest.split("\n")) {
      const idx = line.indexOf(":");
      if (idx <= 0) {
        continue;
      }
      fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    return { id, fields };
  });
}

function field(fields: Record<string, string>, name: string): string {
  return fields[name] ?? "";
}

function vis(value: string): Visibility {
  return value === "hidden" ? "hidden" : "public";
}

function parseKnown(value: string): Array<{ characterId: string; state: KnowledgeState }> {
  if (!value.trim()) {
    return [];
  }
  return value.split(",").flatMap((part) => {
    const [characterId, state] = part.split("=").map((item) => item.trim());
    if (!characterId || !state) {
      return [];
    }
    if (state !== "rumor" && state !== "believed" && state !== "confirmed") {
      return [];
    }
    return [{ characterId, state }];
  });
}

function chapter(text: string, numeral: string): string {
  const marker = `第${numeral}章`;
  const start = text.indexOf(marker);
  if (start < 0) {
    return "";
  }
  const rest = text.slice(start);
  const next = rest.slice(marker.length).search(/\n第[一二三四五六七八九十百零〇]+章/);
  return next < 0 ? rest : rest.slice(0, marker.length + next);
}

function namedCharacters(section: string): Array<{ id: string; name: string }> {
  const match = section.match(/((?:[\u4e00-\u9fff·]{1,6}、){1,}[\u4e00-\u9fff·]{1,6})/);
  if (!match?.[1]) {
    return [];
  }
  return match[1]
    .split("、")
    .map((name) => name.trim())
    .filter((name) => name.length > 0 && name.length <= 4 && !/及|其他|原著|人物/.test(name))
    .map((name) => ({
      id: `char-${createHash("sha1").update(name).digest("hex").slice(0, 8)}`,
      name,
    }));
}

function worldIdFromTitle(title: string): string {
  const head = title.trim().split(/\s+/)[0] ?? "world";
  if (KNOWN_IDS[head]) {
    return KNOWN_IDS[head];
  }
  const ascii = head.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  if (ascii.length >= 2) {
    return ascii;
  }
  return `world-${createHash("sha1").update(head).digest("hex").slice(0, 8)}`;
}
