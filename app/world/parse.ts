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
  let era = "";
  let timeLabel = "";
  let publicPremise = "";
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
    } else if (line.startsWith("era:")) {
      era = line.slice(4).trim();
    } else if (line.startsWith("time_label:")) {
      timeLabel = line.slice(11).trim();
    } else if (line.startsWith("public_premise:")) {
      publicPremise = line.slice(15).trim();
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
  const chronology: import("./source.js").WorldChronology | undefined = era || timeLabel || publicPremise
    ? {
        era: era || "当代",
        timeLabel: timeLabel || time,
        publicPremise: publicPremise || "平静的世界在日常运转。",
      }
    : undefined;
  return {
    id,
    packageTitle,
    publicName,
    time,
    sourceKind: "structured",
    ...(chronology ? { chronology } : {}),
    rules,
    locations,
    characters,
    facts,
    claims,
    theme,
    items: parseItems(sections.get("Items") ?? ""),
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

  const isLongzu = id === "longzu" || packageTitle.includes("龙族") || /仕兰|卡塞尔|路明非|楚子航/.test(text);
  const isMystery = packageTitle.includes("神秘复苏") || /神秘复苏|大昌市|杨间/.test(text);
  const isCultivation = packageTitle.includes("修仙") || /修仙|宗门|炼气|筑基|韩立/.test(text);

  const named = namedCharacters(chapter(text, "十六"));
  let locations: WorldSource["locations"];
  let characters: WorldSource["characters"];
  const facts: WorldSource["facts"] = [];
  const claims: WorldSource["claims"] = [];
  let items: WorldSource["items"] = [];
  let theme: WorldSource["theme"];
  let chronology: import("./source.js").WorldChronology;
  let publicName: string;
  let time: string;

  if (isLongzu) {
    publicName = "当代世界";
    time = "2009年秋 · 傍晚";
    chronology = {
      era: "仕兰中学时期",
      timeLabel: "2009年秋 · 傍晚",
      publicPremise: "最近这座滨海城市接连发生几起尚未解释的雨夜失踪事件，老城区的街头巷尾议论纷纷。",
    };
    locations = [
      { id: "loc-teaching", name: "教学楼", visibility: "public" },
      { id: "loc-gate", name: "学校大门", visibility: "public" },
      { id: "loc-street", name: "老街", visibility: "public" },
      { id: "loc-home", name: "家", visibility: "public" },
      { id: "loc-dorm", name: "宿舍", visibility: "public" },
      { id: "loc-cafeteria", name: "食堂", visibility: "public" },
      { id: "loc-store", name: "便利店", visibility: "public" },
      { id: "loc-campus", name: "普通大学校园", visibility: "public" },
      { id: "loc-city", name: "普通城市", visibility: "public" },
    ];
    if (text.includes("卡塞尔")) {
      locations.push({ id: "loc-cassel", name: "卡塞尔学院", visibility: "hidden" });
    }
    const hybridId = "char-hybrid";
    const knowers = [hybridId, ...named.map((person) => person.id)];
    characters = [
      { id: "char-player", name: "普通人", kind: "player", locationId: "loc-city" },
      { id: "char-roommate", name: "同学", kind: "npc", locationId: "loc-city" },
      { id: "char-guard", name: "门卫大爷", kind: "npc", locationId: "loc-gate" },
      { id: "char-cafeteria", name: "食堂师傅", kind: "npc", locationId: "loc-cafeteria" },
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
    claims.push({
      id: "claim-city-missing",
      subject: "city-news",
      predicate: "reports",
      object: "unsolved-missing-person",
      knownBy: [{ characterId: "char-roommate", state: "rumor" }],
    });
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
    items = [
      { id: "item-bag", name: "书包", locationId: null, carrierId: "char-player" },
      { id: "item-key", name: "钥匙", locationId: "loc-dorm", carrierId: null },
    ];
    theme = {
      characterId: hybridId,
      memory: "隐秘一侧的调查还没结束，不能因为市井日常就把已经开始的事放下。",
      publicBeat: "街头新闻仍在报一桩没有结案的失踪。",
      publicBeatScope: "public_world",
    };
  } else if (isMystery) {
    publicName = "神秘复苏世界";
    time = "当代 · 傍晚";
    chronology = {
      era: "大昌市时期",
      timeLabel: "当代 · 傍晚",
      publicPremise: "城市里暗流涌动，各类神秘灵异传闻在小圈子里悄然传播。",
    };
    locations = [
      { id: "loc-living", name: "居民楼", visibility: "public" },
      { id: "loc-street", name: "街道", visibility: "public" },
      { id: "loc-hall", name: "走廊", visibility: "public" },
    ];
    characters = [
      { id: "char-player", name: "普通人", kind: "player", locationId: "loc-living" },
      { id: "char-neighbor", name: "邻居", kind: "npc", locationId: "loc-living" },
      ...named.map((person) => ({
        id: person.id,
        name: person.name,
        kind: "npc" as const,
        locationId: "loc-street",
      })),
    ];
    claims.push({
      id: "claim-city-anomaly",
      subject: "city-rumors",
      predicate: "mentions",
      object: "strange-anomalies",
      knownBy: [{ characterId: "char-neighbor", state: "rumor" }],
    });
    items = [
      { id: "item-phone", name: "手机", locationId: null, carrierId: "char-player" },
    ];
    theme = {
      characterId: "char-neighbor",
      memory: "最近夜里总有些奇怪的声音，最好别乱走。",
      publicBeat: "城市广播偶尔插播着某些路段突发管制的通知。",
      publicBeatScope: "public_world",
    };
  } else if (isCultivation) {
    publicName = "修仙世界";
    time = "清晨";
    chronology = {
      era: "仙元历",
      timeLabel: "清晨",
      publicPremise: "修真界风云未定，各宗门弟子在世间历练寻道。",
    };
    locations = [
      { id: "loc-gate", name: "山门", visibility: "public" },
      { id: "loc-hall", name: "宗门大殿", visibility: "public" },
      { id: "loc-room", name: "弟子居", visibility: "public" },
    ];
    characters = [
      { id: "char-player", name: "外门弟子", kind: "player", locationId: "loc-gate" },
      { id: "char-brother", name: "同门师兄", kind: "npc", locationId: "loc-gate" },
      ...named.map((person) => ({
        id: person.id,
        name: person.name,
        kind: "npc" as const,
        locationId: "loc-hall",
      })),
    ];
    claims.push({
      id: "claim-sect-trial",
      subject: "sect-news",
      predicate: "announces",
      object: "annual-trial-upcoming",
      knownBy: [{ characterId: "char-brother", state: "confirmed" }],
    });
    items = [
      { id: "item-sword", name: "木剑", locationId: null, carrierId: "char-player" },
      { id: "item-pouch", name: "粗布储物袋", locationId: null, carrierId: "char-player" },
    ];
    theme = {
      characterId: "char-brother",
      memory: "宗门大比临近，不可荒废修行。",
      publicBeat: "山门外的灵鹤掠过云海，远处钟声回荡。",
      publicBeatScope: "public_world",
    };
  } else {
    publicName = "当代世界";
    time = "当代";
    chronology = {
      era: "当前时期未标定",
      timeLabel: "当代",
      publicPremise: "平静的世界在日常运转。",
    };
    locations = [
      { id: "loc-start", name: "此地", visibility: "public" },
    ];
    characters = [
      { id: "char-player", name: "旅人", kind: "player", locationId: "loc-start" },
      ...named.map((person) => ({
        id: person.id,
        name: person.name,
        kind: "npc" as const,
        locationId: "loc-start",
      })),
    ];
    items = [];
    theme = {
      characterId: "char-player",
      memory: "",
      publicBeat: "",
      publicBeatScope: "public_world",
    };
  }

  return {
    id,
    packageTitle,
    publicName,
    time,
    sourceKind: "protocol",
    chronology,
    rules: rules.length > 0
      ? rules
      : [{ text: "世界不围绕玩家存在", visibility: "public" }],
    locations,
    characters,
    facts,
    claims,
    theme,
    items,
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

function parseItems(body: string): WorldSource["items"] {
  if (!body.trim()) {
    return [];
  }
  return splitSub(body).map((block) => ({
    id: block.id,
    name: field(block.fields, "name") || block.id,
    locationId: field(block.fields, "location") || null,
    carrierId: field(block.fields, "carrier") || null,
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
