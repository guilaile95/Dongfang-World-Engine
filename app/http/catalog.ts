import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfig } from "../config.js";
import { loadWorldFile } from "../world/load.js";
import type { WorldOption } from "./view.js";

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "../world/fixtures/riverside-inn.md");
const DRAGON_2009 = resolve(dirname(fileURLToPath(import.meta.url)), "../world/fixtures/dragon-2009-first-hour.json");

let cached: WorldOption[] | null = null;

export function worldCatalog(config: AppConfig): WorldOption[] {
  if (cached) {
    return cached;
  }
  const playDir = resolve(process.env.DWE_PLAY_DIR?.trim() || "data/local");
  const worlds: WorldOption[] = [];
  if (config.worldSource && existsSync(config.worldSource)) {
    const compiled = loadWorldFile(config.worldSource);
    const worldId = compiled.seed.world.id;
    const description = worldId === "longzu"
      ? "当代都市。普通人的日常生活，以及藏在日常背后的某种隐秘。"
      : `${compiled.packageTitle} · ${compiled.seed.world.name}`;
    worlds.push({
      id: worldId,
      title: compiled.packageTitle,
      description,
      sourcePath: config.worldSource,
      savePath: resolve(playDir, `play-${worldId}.sqlite`),
      era: compiled.chronology?.era,
      timeLabel: compiled.chronology?.timeLabel,
      publicPremise: compiled.chronology?.publicPremise,
    });
  }
  if (existsSync(DRAGON_2009) && !worlds.some((row) => row.id === "longzu")) {
    const compiled = loadWorldFile(DRAGON_2009);
    worlds.push({
      id: "longzu",
      title: compiled.packageTitle,
      description: "2009 年 5 月 15 日。普通校园生活与隐秘世界的一次真实交叉。",
      sourcePath: DRAGON_2009,
      savePath: resolve(playDir, "play-longzu.sqlite"),
      era: compiled.chronology.era,
      timeLabel: compiled.chronology.timeLabel,
      publicPremise: compiled.chronology.publicPremise,
    });
  }
  if (existsSync(FIXTURE) && !worlds.some((row) => row.id === "riverside-inn")) {
    const fixtureCompiled = loadWorldFile(FIXTURE);
    worlds.push({
      id: "riverside-inn",
      title: "临河客栈",
      description: "平静的小镇旅馆，来往旅人的相遇之地。",
      sourcePath: FIXTURE,
      savePath: resolve(playDir, "play-riverside-inn.sqlite"),
      era: fixtureCompiled.chronology?.era,
      timeLabel: fixtureCompiled.chronology?.timeLabel,
      publicPremise: fixtureCompiled.chronology?.publicPremise,
    });
  }
  cached = worlds;
  return worlds;
}

export function resetWorldCatalog(): void {
  cached = null;
}
