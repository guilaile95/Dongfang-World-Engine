import { readFileSync } from "node:fs";
import type { WorldStore } from "../persist/store.js";
import { compileWorld, type CompiledWorld } from "./compile.js";
import { parseWorldSource } from "./parse.js";

const FIXTURE = new URL("./fixtures/riverside-inn.md", import.meta.url);

export const SYNTHETIC: CompiledWorld = compileWorld(
  parseWorldSource(readFileSync(FIXTURE, "utf8")),
);

export const WORLD_ID = SYNTHETIC.seed.world.id;
export const SEED_ID = `seed-${WORLD_ID}`;
export const TIME0 = SYNTHETIC.seed.world.time;

export const LOC_HALL = "loc-hall";
export const LOC_KITCHEN = "loc-kitchen";
export const LOC_CELLAR = "loc-cellar";

export const CHAR_PLAYER = "char-player";
export const CHAR_KEEPER = "char-keeper";
export const CHAR_COOK = "char-cook";

export const FACT_BAG = "fact-bag-in-cellar";
export const FACT_INN_OPEN = "fact-inn-open";
export const FACT_GUEST_MISSING = "fact-guest-missing";

export const CLAIM_BAG = "claim-bag-in-cellar";
export const CLAIM_GUEST_FLED = "claim-guest-fled";

export const BEATS = [
  "day-1-morning",
  "day-1-noon",
  "day-1-evening",
  "day-2-morning",
  "day-2-noon",
  "day-2-evening",
  "day-3-morning",
] as const;

export function nextBeat(time: string): string {
  const index = BEATS.indexOf(time as (typeof BEATS)[number]);
  if (index >= 0 && index < BEATS.length - 1) {
    const next = BEATS[index + 1];
    if (next) {
      return next;
    }
  }
  const stamped = /^(.*?)(?:·(\d+))?$/.exec(time);
  const base = stamped?.[1] || time;
  const n = Number(stamped?.[2] || "0") + 1;
  return `${base}·${n}`;
}

export function seedInput(): CompiledWorld["seed"] {
  return SYNTHETIC.seed;
}

export function seedWorld(store: WorldStore): void {
  if (!store.hasWorld(WORLD_ID)) {
    store.insertSeedWorld(seedInput());
  }
}
