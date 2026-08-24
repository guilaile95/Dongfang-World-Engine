import type { KnowledgeState } from "../authority/types.js";

export type Visibility = "public" | "hidden";

export interface WorldSource {
  id: string;
  packageTitle: string;
  publicName: string;
  time: string;
  sourceKind: "structured" | "protocol";
  rules: Array<{ text: string; visibility: Visibility }>;
  locations: Array<{ id: string; name: string; visibility: Visibility }>;
  characters: Array<{
    id: string;
    name: string;
    kind: "player" | "npc";
    locationId: string;
    theme?: boolean;
  }>;
  facts: Array<{
    id: string;
    subject: string;
    predicate: string;
    object: string;
    visibility: Visibility;
  }>;
  claims: Array<{
    id: string;
    subject: string;
    predicate: string;
    object: string;
    knownBy: Array<{ characterId: string; state: KnowledgeState }>;
  }>;
  theme: {
    characterId: string;
    memory: string;
    publicBeat: string;
    publicBeatScope: "same_location" | "public_world";
  };
}
