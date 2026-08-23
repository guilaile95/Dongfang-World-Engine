import { describe, expect, it } from "vitest";
import type { CommittedEvent, EventType } from "../../src/domain/types.js";
import {
  CLOSED_INN_DIRECTED_PLAYER_BASE_SHA,
  CLOSED_INN_DIRECTED_PLAYER_NPC_INTENT,
  CLOSED_INN_DIRECTED_PLAYER_STEPS,
  projectSafeExperimentRun,
} from "../../src/smoke/closed-inn-directed-player.js";
import type { TurnExecutionTrace } from "../../src/smoke/closed-inn-harness.js";

const PLAYER = "character-player";
const NPC_A = "character-npc-a";
const NPC_B = "character-npc-b";
const NPC_C = "character-npc-c";
const HALL = "location-inn-hall";
const GUEST_ROOM = "location-guest-room";
const EVENT_TIME = "2019-03-12T18:00:00.000Z";

function rawTrace(
  turnIndex: number,
  actorId: string,
  options: {
    visibleClaims?: TurnExecutionTrace["visibleClaims"];
    locationId?: string | null;
    committedEvents?: TurnExecutionTrace["committedEvents"];
  } = {},
): TurnExecutionTrace {
  return {
    turnIndex,
    actorId,
    locationId: options.locationId ?? null,
    visibleClaims: options.visibleClaims ?? [],
    turnStatus: "success",
    committedEvents: options.committedEvents ?? [],
    rejection: null,
    narrative: null,
  };
}

function summary(type: EventType, worldRevision: number): TurnExecutionTrace["committedEvents"][number] {
  return { type, worldRevision, eventTime: EVENT_TIME };
}

function event(
  id: string,
  worldRevision: number,
  type: EventType,
  actorIds: string[],
  targetIds: string[],
  payload: Record<string, unknown>,
): CommittedEvent {
  return {
    id,
    sequence: worldRevision,
    worldId: "world-closed-inn",
    worldRevision,
    eventTime: EVENT_TIME,
    type,
    locationId: null,
    actorIds,
    targetIds,
    causeEventIds: ["private-cause-event"],
    payload,
    createdAt: EVENT_TIME,
  };
}

function buildProjectionInput(): {
  traces: TurnExecutionTrace[];
  events: CommittedEvent[];
} {
  const traces = CLOSED_INN_DIRECTED_PLAYER_STEPS.map((step, index) => rawTrace(index + 1, step.actorId));
  traces[0] = rawTrace(1, PLAYER, {
    locationId: HALL,
    visibleClaims: [{ claimId: "claim-player-known", knowledgeState: "confirmed" }],
  });
  traces[1] = rawTrace(2, NPC_A, {
    visibleClaims: [{ claimId: "npc-private-claim", knowledgeState: "rumor" }],
    committedEvents: [summary("claim.transmit", 1)],
  });
  traces[2] = rawTrace(3, PLAYER, {
    locationId: HALL,
    visibleClaims: [
      { claimId: "claim-player-known", knowledgeState: "confirmed" },
      { claimId: "claim-npc-message", knowledgeState: "confirmed" },
    ],
  });
  traces[3] = rawTrace(4, NPC_B, {
    visibleClaims: [{ claimId: "npc-private-claim", knowledgeState: "rumor" }],
    committedEvents: [summary("claim.transmit", 2)],
  });
  traces[4] = rawTrace(5, PLAYER, {
    locationId: HALL,
    visibleClaims: [{ claimId: "claim-player-known", knowledgeState: "confirmed" }],
    committedEvents: [summary("character.move", 3)],
  });
  traces[10] = rawTrace(11, PLAYER, {
    locationId: HALL,
    visibleClaims: [{ claimId: "claim-player-known", knowledgeState: "confirmed" }],
    committedEvents: [summary("claim.transmit", 4), summary("character.move", 5)],
  });
  traces[11] = rawTrace(12, NPC_B, {
    visibleClaims: [{ claimId: "npc-private-claim", knowledgeState: "rumor" }],
    committedEvents: [summary("claim.transmit", 6)],
  });

  const privatePayload = {
    hiddenTruth: "fact-hidden-dagger-cellar",
    sourceSeedId: "seed-closed-inn-v1",
    identity: "private identity",
    currentGoal: "private goal",
    rawPayload: "must not be serialized",
  };
  const events = [
    event("event-npc-to-player", 1, "claim.transmit", [NPC_A], [PLAYER], {
      ...privatePayload,
      sourceCharacterId: NPC_A,
      targetCharacterId: PLAYER,
      claimId: "claim-npc-message",
    }),
    event("event-npc-to-npc", 2, "claim.transmit", [NPC_B], [NPC_A], {
      ...privatePayload,
      sourceCharacterId: NPC_B,
      targetCharacterId: NPC_A,
      claimId: "npc-private-claim",
    }),
    event("event-player-move", 3, "character.move", [PLAYER], [], {
      ...privatePayload,
      actorId: PLAYER,
      toLocationId: GUEST_ROOM,
    }),
    event("event-player-transmit", 4, "claim.transmit", [PLAYER], [NPC_B], {
      ...privatePayload,
      sourceCharacterId: PLAYER,
      targetCharacterId: NPC_B,
      claimId: "claim-player-known",
    }),
    event("event-player-move-again", 5, "character.move", [PLAYER], [], {
      ...privatePayload,
      actorId: PLAYER,
      toLocationId: HALL,
    }),
    event("event-npc-b-to-player", 6, "claim.transmit", [NPC_B], [PLAYER], {
      ...privatePayload,
      sourceCharacterId: NPC_B,
      targetCharacterId: PLAYER,
      claimId: "claim-npc-message",
    }),
  ];
  return { traces, events };
}

describe("Closed Inn directed-player experiment runner", () => {
  it("freezes the exact 14-turn actor sequence and intents", () => {
    expect(CLOSED_INN_DIRECTED_PLAYER_STEPS).toHaveLength(14);
    expect(CLOSED_INN_DIRECTED_PLAYER_STEPS.map((step) => step.actorId)).toEqual([
      PLAYER,
      NPC_A,
      PLAYER,
      NPC_B,
      PLAYER,
      NPC_C,
      PLAYER,
      NPC_C,
      PLAYER,
      NPC_B,
      PLAYER,
      NPC_B,
      NPC_A,
      PLAYER,
    ]);
    expect(CLOSED_INN_DIRECTED_PLAYER_STEPS.filter((step) => step.actorId !== PLAYER)
      .map((step) => step.intent)).toEqual(Array(7).fill(CLOSED_INN_DIRECTED_PLAYER_NPC_INTENT));
    expect(CLOSED_INN_DIRECTED_PLAYER_STEPS.map((step) => step.intent)).toEqual([
      "在客栈大堂观察周围环境，接近店小二阿宝并留在同一区域，观察并准备获知其可能主动透露的信息。",
      CLOSED_INN_DIRECTED_PLAYER_NPC_INTENT,
      "在客栈大堂接近账房赵先生，观察并准备获知其可能主动透露的信息；本回合不要主动传播自己的 Claim。",
      CLOSED_INN_DIRECTED_PLAYER_NPC_INTENT,
      "通过连接通道离开客栈大堂，明确移动至二楼客房。",
      CLOSED_INN_DIRECTED_PLAYER_NPC_INTENT,
      "在二楼客房接近行商孙掌柜，观察并准备获知其可能主动透露的信息；本回合不要主动向其传播自己的 Claim。",
      CLOSED_INN_DIRECTED_PLAYER_NPC_INTENT,
      "离开二楼客房，通过连接通道返回客栈大堂。",
      CLOSED_INN_DIRECTED_PLAYER_NPC_INTENT,
      "在客栈大堂中，根据自己实际已经掌握且持有的 Claim，主动向账房赵先生说明一条确切信息。",
      CLOSED_INN_DIRECTED_PLAYER_NPC_INTENT,
      CLOSED_INN_DIRECTED_PLAYER_NPC_INTENT,
      "在客栈大堂整理自己合法掌握的全部线索与各方反应，评估匕首下落并做出最终判断。",
    ]);
  });

  it("projects only safe player context, outcomes, and received outcomes", () => {
    const { traces, events } = buildProjectionInput();
    const result = projectSafeExperimentRun({
      finalWorldRevision: 6,
      replayConsistent: true,
      traces,
    }, events);

    expect(result.frozenBaseSha).toBe(CLOSED_INN_DIRECTED_PLAYER_BASE_SHA);
    expect(result.traces).toHaveLength(14);
    expect(result.traces[0]?.playerContext).toEqual({
      locationId: HALL,
      visibleClaims: [{ claimId: "claim-player-known", knowledgeState: "confirmed" }],
    });
    expect(result.traces[1]?.playerContext).toBeNull();
    expect(result.traces[1]?.playerReceivedOutcomes).toEqual([{
      eventId: "event-npc-to-player",
      type: "claim.transmit",
      sourceCharacterId: NPC_A,
      claimId: "claim-npc-message",
    }]);
    expect(result.traces[3]?.playerReceivedOutcomes).toEqual([]);
    expect(result.traces[4]?.playerOutcomes).toEqual([{
      eventId: "event-player-move",
      type: "character.move",
      toLocationId: GUEST_ROOM,
    }]);
    expect(result.traces[10]?.playerOutcomes).toEqual([
      {
        eventId: "event-player-transmit",
        type: "claim.transmit",
        claimId: "claim-player-known",
        targetCharacterId: NPC_B,
      },
      {
        eventId: "event-player-move-again",
        type: "character.move",
        toLocationId: HALL,
      },
    ]);
    expect(result.traces[11]?.playerReceivedOutcomes).toEqual([{
      eventId: "event-npc-b-to-player",
      type: "claim.transmit",
      sourceCharacterId: NPC_B,
      claimId: "claim-npc-message",
    }]);

    expect(result.traces[0]?.committedEvents).toEqual([]);
    expect(result.traces[1]?.committedEvents).toEqual([{
      eventId: "event-npc-to-player",
      type: "claim.transmit",
      worldRevision: 1,
      eventTime: EVENT_TIME,
    }]);
  });

  it("does not serialize NPC private context, payload, or forbidden provenance fields", () => {
    const { traces, events } = buildProjectionInput();
    const result = projectSafeExperimentRun({ finalWorldRevision: 6, replayConsistent: true, traces }, events);
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("npc-private-claim");
    expect(serialized).not.toContain("hiddenTruth");
    expect(serialized).not.toContain("sourceSeedId");
    expect(serialized).not.toContain("identity");
    expect(serialized).not.toContain("currentGoal");
    expect(serialized).not.toContain("private identity");
    expect(serialized).not.toContain("private goal");
    expect(serialized).not.toContain("rawPayload");
    expect(serialized).not.toContain("causeEventIds");
    expect(serialized).not.toContain("private-cause-event");
  });

  it.each([
    ["missing revision", (events: CommittedEvent[]) => events.filter((candidate) => candidate.worldRevision !== 1)],
    ["mismatched type", (events: CommittedEvent[]) => events.map((candidate) =>
      candidate.worldRevision === 1 ? { ...candidate, type: "relationship.change" as const } : candidate)],
    ["mismatched time", (events: CommittedEvent[]) => events.map((candidate) =>
      candidate.worldRevision === 1 ? { ...candidate, eventTime: "2019-03-12T19:00:00.000Z" } : candidate)],
    ["duplicate revision", (events: CommittedEvent[]) => [...events, events[0]!]],
  ])("fails closed for %s authoritative event mapping", (_name, mutateEvents) => {
    const { traces, events } = buildProjectionInput();
    expect(() => projectSafeExperimentRun({ finalWorldRevision: 6, replayConsistent: true, traces }, mutateEvents(events))).toThrow();
  });

  it("rejects a player transmit whose claim is absent from the player context", () => {
    const { traces, events } = buildProjectionInput();
    const playerTurn = traces[10]!;
    traces[10] = {
      ...playerTurn,
      visibleClaims: [],
    };
    expect(() => projectSafeExperimentRun({ finalWorldRevision: 6, replayConsistent: true, traces }, events)).toThrow(
      "absent from the player context",
    );
  });
});
