import { readFileSync } from "node:fs";
import type { WorldStore } from "../persist/store.js";
import { ingestMaterials } from "../context/ingest.js";
import { compileWorld, type CompiledWorld } from "./compile.js";
import { parseWorldSource } from "./parse.js";

const FIXTURE = new URL("./fixtures/riverside-inn.md", import.meta.url);
const FIXTURE_TEXT = readFileSync(FIXTURE, "utf8");
const FIXTURE_SOURCE = parseWorldSource(FIXTURE_TEXT);

export const SYNTHETIC: CompiledWorld = compileWorld(FIXTURE_SOURCE);
SYNTHETIC.materials = ingestMaterials(FIXTURE_SOURCE, FIXTURE_TEXT);

export const WORLD_ID = SYNTHETIC.seed.world.id;
export const SEED_ID = `seed-${WORLD_ID}`;
export const TIME0 = SYNTHETIC.seed.world.time;

export const LOC_HALL = "loc-hall";
export const LOC_KITCHEN = "loc-kitchen";
export const LOC_CELLAR = "loc-cellar";

export const CHAR_PLAYER = "char-player";
export const CHAR_KEEPER = "char-keeper";
export const CHAR_COOK = "char-cook";

export const ITEM_BAG = "item-bag";
export const ITEM_KEY = "item-key";

export const FACT_BAG = "fact-bag-in-cellar";
export const FACT_INN_OPEN = "fact-inn-open";
export const FACT_GUEST_MISSING = "fact-guest-missing";

export const CLAIM_BAG = "claim-bag-in-cellar";
export const CLAIM_GUEST_FLED = "claim-guest-fled";

export function seedInput(): CompiledWorld["seed"] {
  return SYNTHETIC.seed;
}

export function seedWorld(store: WorldStore): void {
  if (!store.hasWorld(WORLD_ID)) {
    store.insertSeedWorld(seedInput());
  }
}
