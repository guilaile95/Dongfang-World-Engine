import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileDragonSnapshot, dragon2009SnapshotSchema } from "../app/world/snapshot.js";

const raw = JSON.parse(readFileSync(join(process.cwd(), "app", "world", "fixtures", "dragon-2009-first-hour.json"), "utf8"));

describe("Dragon 2009 deterministic snapshot compiler", () => {
  it("compiles the same JSON to the same seed without an LLM", () => {
    const source = dragon2009SnapshotSchema.parse(raw);
    expect(compileDragonSnapshot(source)).toEqual(compileDragonSnapshot(source));
  });

  it("rejects missing references and unresolved authoritative provenance before seeding", () => {
    const missing = structuredClone(raw);
    missing.routes[0].toLocationId = "loc-missing";
    expect(() => dragon2009SnapshotSchema.parse(missing)).toThrow(/missing location/);
    const unresolved = structuredClone(raw);
    unresolved.sourceRefs.find((row: { id: string }) => row.id === "ref-date-helicopter").status = "unresolved";
    expect(() => dragon2009SnapshotSchema.parse(unresolved)).toThrow(/unresolved source ref/);
  });
});
