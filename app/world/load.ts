import { readFileSync } from "node:fs";
import { compileWorld, type CompiledWorld } from "./compile.js";
import { parseWorldSource } from "./parse.js";
import type { WorldStore } from "../persist/store.js";

export function loadWorldFile(path: string): CompiledWorld {
  const text = readFileSync(path, "utf8");
  return compileWorld(parseWorldSource(text));
}

export function seedCompiled(store: WorldStore, compiled: CompiledWorld): void {
  if (!store.hasWorld(compiled.seed.world.id)) {
    store.insertSeedWorld(compiled.seed);
  }
}
