import { readFileSync } from "node:fs";
import { ingestMaterials } from "../context/ingest.js";
import type { WorldStore } from "../persist/store.js";
import { compileWorld, type CompiledWorld } from "./compile.js";
import { parseWorldSource } from "./parse.js";

export function loadWorldFile(path: string): CompiledWorld {
  const text = readFileSync(path, "utf8");
  const source = parseWorldSource(text);
  const compiled = compileWorld(source);
  compiled.materials = ingestMaterials(source, text);
  return compiled;
}

export function seedCompiled(store: WorldStore, compiled: CompiledWorld): void {
  if (!store.hasWorld(compiled.seed.world.id)) {
    store.insertSeedWorld(compiled.seed);
    for (const item of compiled.materials) {
      store.insertContextItem(item);
    }
  }
}
