import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfig } from "../config.js";
import { loadWorldFile } from "../world/load.js";
import type { WorldOption } from "./view.js";

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "../world/fixtures/riverside-inn.md");

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
    // Description from world theme – a brief public-facing flavour
    const description = worldId === "longzu"
      ? "当代都市。普通人的日常生活，以及藏在日常背后的某种隐秘。"
      : `${compiled.packageTitle} · ${compiled.seed.world.name}`;
    worlds.push({
      id: worldId,
      title: compiled.packageTitle,
      description,
      sourcePath: config.worldSource,
      savePath: resolve(playDir, `play-${worldId}.sqlite`),
    });
  }
  if (existsSync(FIXTURE) && !worlds.some((row) => row.id === "riverside-inn")) {
    worlds.push({
      id: "riverside-inn",
      title: "临河客栈",
      description: "平静的小镇旅馆，来往旅人的相遇之地。",
      sourcePath: FIXTURE,
      savePath: resolve(playDir, "play-riverside-inn.sqlite"),
    });
  }
  cached = worlds;
  return worlds;
}

export function resetWorldCatalog(): void {
  cached = null;
}
