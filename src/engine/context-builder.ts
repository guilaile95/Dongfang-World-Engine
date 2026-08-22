import type {
  CharacterRecord,
  ClaimRecord,
  CommittedEvent,
  KnowledgeRecord,
  LocationRecord,
  RelationshipRecord,
  WorldRecord,
} from "../domain/types.js";
import { findCharacter, SqliteWorldStore } from "../persistence/sqlite-store.js";
import { KernelError } from "./errors.js";

export const DEFAULT_CONTEXT_BUDGET = 32;

export interface BuildCharacterContextInput {
  worldId: string;
  observerCharacterId: string;
  budget?: number;
}

export interface ContextWorldEnvelope {
  id: string;
  currentTime: string;
  revision: number;
  status: WorldRecord["status"];
}

export interface PublicCharacterProjection {
  id: string;
  name: string;
  type: string;
  alive: boolean;
}

export interface ContextKnowledgeProvenance {
  sourceType: KnowledgeRecord["sourceType"];
  sourceCharacterId: string | null;
  sourceEventId: string | null;
  sourceSeedId: string | null;
  sourceEventType: CommittedEvent["type"] | null;
  sourceEventTime: string | null;
}

export interface ContextKnowledgeBundle {
  claim: ClaimRecord;
  knowledge: KnowledgeRecord;
  provenance: ContextKnowledgeProvenance;
}

export interface CharacterContext {
  world: ContextWorldEnvelope;
  observer: CharacterRecord;
  location: LocationRecord | null;
  coLocatedCharacters: PublicCharacterProjection[];
  knowledge: ContextKnowledgeBundle[];
  relationships: RelationshipRecord[];
  packing: {
    budget: number;
    visibleUnits: number;
    usedUnits: number;
    truncated: boolean;
  };
}

type ContextUnit =
  | { kind: "knowledge"; value: ContextKnowledgeBundle }
  | { kind: "coLocatedCharacter"; value: PublicCharacterProjection }
  | { kind: "relationship"; value: RelationshipRecord };

export class ContextBuilder {
  public constructor(private readonly store: SqliteWorldStore) {}

  public buildCharacterContext(input: BuildCharacterContextInput): CharacterContext {
    const budget = normalizeBudget(input.budget);
    const snapshot = this.store.getSnapshot(input.worldId);
    const observerRow = findCharacter(this.store.db, input.observerCharacterId);
    if (!observerRow) {
      throw new KernelError("CHARACTER_NOT_FOUND", "Context observer Character does not exist", {
        characterId: input.observerCharacterId,
      });
    }
    if (observerRow.worldId !== input.worldId) {
      throw new KernelError("CROSS_WORLD_REFERENCE", "Context observer Character belongs to another World", {
        characterId: input.observerCharacterId,
        worldId: input.worldId,
        characterWorldId: observerRow.worldId,
      });
    }

    const observer = snapshot.characters.find((character) => character.id === input.observerCharacterId);
    if (!observer) {
      throw new KernelError("CHARACTER_NOT_FOUND", "Context observer Character is not in the requested World", {
        characterId: input.observerCharacterId,
        worldId: input.worldId,
      });
    }

    const location = observer.locationId === null
      ? null
      : snapshot.locations.find((candidate) => candidate.id === observer.locationId) ?? null;
    if (observer.locationId !== null && location === null) {
      throw new KernelError("LOCATION_NOT_FOUND", "Context observer Location does not exist in the requested World", {
        characterId: observer.id,
        locationId: observer.locationId,
        worldId: input.worldId,
      });
    }

    const eventById = new Map(this.store.listEvents(input.worldId).map((event) => [event.id, event]));
    const claimById = new Map(snapshot.claims.map((claim) => [claim.id, claim]));
    const knowledgeBundles = snapshot.knowledge
      .filter((knowledge) => knowledge.characterId === observer.id)
      .sort((first, second) => compareIds(first.claimId, second.claimId))
      .map((knowledge) => {
        const claim = claimById.get(knowledge.claimId);
        if (!claim) {
          throw new KernelError("CLAIM_NOT_FOUND", "Context Knowledge references a missing Claim", {
            characterId: observer.id,
            claimId: knowledge.claimId,
            worldId: input.worldId,
          });
        }
        const sourceEvent = knowledge.sourceEventId === null
          ? null
          : eventById.get(knowledge.sourceEventId) ?? null;
        return {
          claim: { ...claim },
          knowledge: { ...knowledge },
          provenance: {
            sourceType: knowledge.sourceType,
            sourceCharacterId: knowledge.sourceCharacterId,
            sourceEventId: knowledge.sourceEventId,
            sourceSeedId: knowledge.sourceSeedId,
            sourceEventType: sourceEvent?.type ?? null,
            sourceEventTime: sourceEvent?.eventTime ?? null,
          },
        } satisfies ContextKnowledgeBundle;
      });

    const coLocatedCharacters = snapshot.characters
      .filter((character) => character.id !== observer.id && location !== null && character.locationId === location.id)
      .sort((first, second) => compareIds(first.id, second.id))
      .map(toPublicCharacterProjection);
    const observerRelationships = snapshot.relationships
      .filter((relationship) => relationship.sourceCharacterId === observer.id)
      .sort((first, second) => compareIds(first.targetCharacterId, second.targetCharacterId))
      .map((relationship) => ({ ...relationship }));

    const visibleUnits: ContextUnit[] = [
      ...knowledgeBundles.map((value) => ({ kind: "knowledge" as const, value })),
      ...coLocatedCharacters.map((value) => ({ kind: "coLocatedCharacter" as const, value })),
      ...observerRelationships.map((value) => ({ kind: "relationship" as const, value })),
    ];
    const packedUnits = visibleUnits.slice(0, budget);
    const packedKnowledge: ContextKnowledgeBundle[] = [];
    const packedCoLocatedCharacters: PublicCharacterProjection[] = [];
    const packedRelationships: RelationshipRecord[] = [];
    for (const unit of packedUnits) {
      switch (unit.kind) {
        case "knowledge":
          packedKnowledge.push(unit.value);
          break;
        case "coLocatedCharacter":
          packedCoLocatedCharacters.push(unit.value);
          break;
        case "relationship":
          packedRelationships.push(unit.value);
          break;
      }
    }

    return {
      world: {
        id: snapshot.world.id,
        currentTime: snapshot.world.currentTime,
        revision: snapshot.world.revision,
        status: snapshot.world.status,
      },
      observer: { ...observer },
      location: location ? { ...location } : null,
      coLocatedCharacters: packedCoLocatedCharacters,
      knowledge: packedKnowledge,
      relationships: packedRelationships,
      packing: {
        budget,
        visibleUnits: visibleUnits.length,
        usedUnits: packedUnits.length,
        truncated: packedUnits.length < visibleUnits.length,
      },
    };
  }
}

export function buildCharacterContext(
  store: SqliteWorldStore,
  input: BuildCharacterContextInput,
): CharacterContext {
  return new ContextBuilder(store).buildCharacterContext(input);
}

function normalizeBudget(value: number | undefined): number {
  const budget = value ?? DEFAULT_CONTEXT_BUDGET;
  if (!Number.isSafeInteger(budget) || budget < 0) {
    throw new KernelError("VALIDATION_FAILED", "Context budget must be a non-negative safe integer", { budget });
  }
  return budget;
}

function compareIds(first: string, second: string): number {
  if (first < second) {
    return -1;
  }
  if (first > second) {
    return 1;
  }
  return 0;
}

function toPublicCharacterProjection(character: CharacterRecord): PublicCharacterProjection {
  return {
    id: character.id,
    name: character.name,
    type: character.type,
    alive: character.alive,
  };
}
