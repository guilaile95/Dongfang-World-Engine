# Greenfield Scene Lifecycle Contract

Status: **frozen contract for Issue #75**

Baseline: stacked on PR #74 after Owner real-play rejection.

North Star:

> The engine must automatically resolve the mundane process already implied by a player decision, then stop only when a new meaningful decision belongs to the player.

This document defines product and authority boundaries. It does not prescribe class names beyond the contracts below.

---

## 1. Problem being solved

Current runtime shape:

```text
player line
→ one playTurn()
→ one narration
→ optional suggestions
→ always return control
```

This causes the product to stop at meaningless transitions. Example: the player chooses to avoid the old pier and take the long route; the engine narrates leaving school and walking, then stops before any new decision exists.

The correct unit is not one message. It is:

```text
one player decision
→ all safe, already-decided mundane progress
→ the next meaningful player decision
```

---

## 2. Authority classes

### Authoritative

Only these may change durable world state:

- system- or LLM-produced Candidates accepted by the Authority Gate;
- committed Events;
- deterministic projections of committed Events;
- trusted seed/bootstrap compilation.

### Non-authoritative orchestration

These are never Truth and never write world state:

- `SceneInterpretation`;
- `SceneStopDecision`;
- stop reason;
- `decisionSummary` / current presentation situation;
- A–F suggestions;
- transition prose;
- recent scenes and summaries;
- model ranking/relevance scores.

A stop decision may be logged in a diagnostic receipt. It must not increment world revision or become a world Event.

---

## 3. Core records

### 3.1 SceneInterpretation

Produced by structured output from the raw player line plus the player-visible context.

```text
SceneInterpretation
  playerContribution: string
  channel: in_world | ooc_meta
  contributions: ContributionKind[]
  persistentProposals: Proposal[]
  ephemeralBeats: EphemeralBeat[]
  targetedStimuli: TargetedStimulus[]
  timePolicy: TimePolicy
  strategyIntent: StrategyIntent | null
  unsupportedMaterial: UnsupportedMaterial[]
```

Rules:

- it is non-authoritative;
- it never generates free scene prose;
- it never rewrites the player's line as Truth;
- uncertain material defaults to no persistent proposal;
- it must not substitute a different legal action for the player's failed intent;
- all structured interpretation uses the existing `ModelClient.generateStructured + Zod + bounded fallback` path.

### 3.2 StrategyIntent

Represents only an already-made player strategy that the engine may safely continue.

```text
StrategyIntent
  kind: follow_route | wait | leave_area | continue_current_task
  targetLocationId: string | null
  routeId: string | null
  untilTime: string | null
  completionCondition: string
```

This is not a new player action enum. It is a bounded orchestration hint derived from the player's explicit decision.

Examples:

- “避开老码头，走远路去车站” → follow a specific selected route;
- “我等二十分钟” → wait until an explicit time;
- “我收拾好东西下楼” → continue_current_task until downstairs.

The engine may not invent a new strategy after the current one completes.

### 3.3 ResolvedSceneEnvelope

Built only after all Authority commits for the current internal step.

```text
ResolvedSceneEnvelope
  playerContribution: string
  approvedEphemeralBeats: EphemeralBeat[]
  committedEffects: PlayerVisibleOutcome[]
  rejectedEffects: RejectedOutcome[]
  deliveredStimuli: TargetedStimulus[]
  npcReplies: PlayerVisibleNpcReply[]
  worldThreadExposures: PlayerVisibleExposure[]
  elapsedMinutes: integer
  currentLocationId: string
  currentTime: string
  transitionKind: player_action | auto_transition | background_exposure
  negativeBoundaries: string[]
```

Narrator may describe only this envelope and legal lore/context. Narrator output is never parsed back into Authority.

### 3.4 SceneStopDecision

```text
SceneStopDecision
  shouldStop: boolean
  stopReason:
    - new_risk
    - direction_choice
    - material_information
    - meaningful_npc_request
    - obstacle
    - destination_reached
    - none
  decisionSummary: string | null
  options: ActionSuggestion[] | null
```

Constraints:

- `shouldStop=false` requires `stopReason=none` and no options;
- `shouldStop=true` requires a concrete reason and player-visible evidence;
- `npc_interaction` is not a stop reason; ordinary conversation is not automatically meaningful;
- system-only terminal reasons are not model-selectable:
  - `cancelled`
  - `budget_cap`
  - `structured_failure`
  - `no_safe_progress`.

### 3.5 ActionSuggestion

```text
ActionSuggestion
  key: A | B | C | D | E | F
  text: string
  type: constructive | extreme | absurd
```

A–D must differ materially in goal, risk, attitude, or information path.

E is extreme/high-risk.

F is executable but absurd/non-standard.

Suggestions are ordinary natural-language intentions. Clicking one only fills/submits the same free-text path.

---

## 4. Option grounding gate

Before suggestions reach the browser, deterministic checks must prove that they:

- reference only player-visible people, places, items, and information;
- do not expose hidden canon or another character's private knowledge;
- do not require speaking to a dead, absent, or unreachable character;
- do not promise arrival, success, acquisition, injury, or other uncommitted outcomes;
- do not include Engine primitives or IDs;
- do not create a route that does not exist in the current route graph.

Invalid suggestions are rejected. The system may request one presentation-only repair. If repair still fails, return free input without suggestions.

The grounding gate never writes world state.

---

## 5. Time and route semantics

A player message is not a fixed tick.

### 5.1 TimePolicy

```text
TimePolicy
  kind: none | bounded_action | route_travel | explicit_wait
  minutes: integer | null
  routeId: string | null
  untilTime: string | null
```

Rules:

- observations and brief replies may consume 0–2 minutes;
- conversation duration is bounded and may be 1–10 minutes;
- route travel uses authoritative route metadata;
- explicit waiting uses the player's requested duration, clamped by code;
- only Authority time consequences change world time;
- technical suffixes such as `·1/·2/·3` are forbidden in player-facing time.

### 5.2 Route graph

```text
LocationRoute
  id
  fromLocationId
  toLocationId
  travelMinutes
  visibility: public | hidden
  bidirectional: boolean
  conditions[]
```

`character_move` must ultimately respect route reachability for this slice.

A player-selected route can be automatically traversed. A new route choice always belongs to the player.

---

## 6. Background thread

The opening hook and later world changes must come from an independently existing process.

```text
BackgroundThread
  id
  actorIds[]
  objective
  currentStage
  locationScope[]
  startsAt
  beats[]

BackgroundBeat
  beatId
  dueAt | afterMinutes
  preconditions[]
  consequences[]
  exposureRules[]
```

Requirements:

- the thread exists even if the player does not;
- each beat has a stable ID and executes at most once;
- persistent consequences use a trusted system producer through Authority;
- the Event Log explains executed beats;
- Visibility decides whether the player notices an exposure;
- no exposure is manufactured merely because a scene needs excitement;
- no general scheduler, job queue, or always-on NPC LLM is introduced.

---

## 7. Bounded lifecycle

Initial hard limits:

```text
MAX_AUTO_STEPS = 3
MAX_AUTO_DURATION_MINUTES = 60
```

The code enforces the caps.

### Complete flow

```text
handlePlayerTurn(playerLine, turnId, abortSignal)

1. OOC gate
   if /ooc:
     no time
     no background thread
     no world writes
     return OOC response

2. structured interpretation
   output SceneInterpretation
   if parsing fails:
     fail-closed
     no time
     no background step
     no narrator world prose

3. bind and commit player consequences
   through the single Authority path
   never substitute a different legal action

4. resolve duration
   from explicit wait, route metadata, or bounded action semantics

5. commit authoritative time change when duration > 0

6. internal loop
   for stepIndex < MAX_AUTO_STEPS and totalMinutes <= MAX_AUTO_DURATION_MINUTES:

     a. evaluate and commit due BackgroundThread beats
     b. rebuild post-commit player-visible context
     c. check deterministic hard-stop conditions
     d. when semantic judgment is needed, call structured SceneStopDecision
     e. ground A–F options
     f. build ResolvedSceneEnvelope
     g. validate narrator output before emission
     h. stream safe presentation
     i. if abort requested, return after this safe boundary
     j. if shouldStop, return A–F + free input
     k. if the current StrategyIntent still determines one safe mundane step,
        execute that step and continue the loop
     l. otherwise return free input without inventing a meaningful decision

7. if cap reached
   return control
   terminalReason=budget_cap
   do not fabricate A–F
```

---

## 8. What may be automated

Allowed:

- walking along the route already chosen by the player;
- packing, going downstairs, crossing a corridor;
- ordinary waiting;
- transition prose after already committed movement/time;
- world-thread progression whose preconditions are satisfied.

Forbidden:

- choosing a new route;
- deciding whether to accept danger;
- deciding whether to trust an NPC;
- entering a dangerous location without the player's choice;
- accepting an invitation;
- choosing to fight, flee, betray, investigate, or reveal information when alternatives matter.

---

## 9. Cancellation and idempotency

### IDs

- external player request: `turnId`;
- internal step: `turnId + stepIndex`;
- background beat: stable `threadId + beatId`.

### Cancellation

- UI may request cancel while a lifecycle is busy;
- the server associates an `AbortController` with the turn;
- cancellation prevents later automatic steps;
- already committed state remains committed;
- no rollback is attempted;
- the response returns the latest authoritative state and terminal reason `cancelled`.

### Retry

- repeating the same `turnId` returns cached/reconstructed results;
- a committed internal step cannot execute twice;
- a background beat cannot execute twice after restart;
- narrator retry cannot cause a second Authority commit.

---

## 10. Failure semantics

- interpretation failure: no time, no background event, no world narration;
- stop-decision failure: stop auto-advance and return free input with `structured_failure`;
- narrator failure after commit: preserve Authority, emit a bounded safe notice, do not fabricate prose;
- grounding failure: remove/repair suggestions, never widen visibility;
- no safe progress: return control without pretending a meaningful node exists;
- cap reached: return control with a receipt reason, not a fake choice.

---

## 11. Superseded paths

After focused lifecycle tests pass, delete:

- `withObviousMove`
- `withSpokenMemory`
- `ensureObviousMove`
- `ensureObviousCarry`
- `ensureSpokenMemory`
- old `evaluateDecisionGate`
- old `isMeaningfulDecisionNode`
- `DISMISS_SITUATION` regex lifecycle
- fixed `planOpeningHook`
- unconditional per-line `worldTick`
- technical `nextBeat` suffix progression from the product path.

Do not delete Authority, Visibility, SQLite, player-safe API, narrator boundary, or safe new-save backup.

---

## 12. Minimum verification

1. stop decisions do not change Event/revision;
2. hidden or invalid options are rejected;
3. mundane route progress does not stop;
4. destination, risk, obstacle, material information, or meaningful request may stop;
5. ordinary NPC small talk does not stop;
6. cancellation preserves committed state and stops later steps;
7. caps are deterministic;
8. retry does not duplicate steps or beats;
9. OOC does not advance time or threads;
10. restart preserves time, route progress, thread stage, and player state;
11. the target Owner path reaches a second meaningful decision without a meaningless intermediate stop.
