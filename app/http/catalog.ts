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
    worlds.push({
      id: compiled.seed.world.id,
      title: compiled.packageTitle,
      sourcePath: config.worldSource,
      savePath: resolve(playDir, `play-${compiled.seed.world.id}.sqlite`),
    });
  }
  if (existsSync(FIXTURE) && !worlds.some((row) => row.id === "riverside-inn")) {
    worlds.push({
      id: "riverside-inn",
      title: "临河客栈",
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
