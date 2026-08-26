# Dragon 2009 Starting Snapshot — Source Schema

Status: **frozen source/compiler contract for Issue #75**

Purpose:

> Represent one narrow, source-backed 2009 Dragon world snapshot in a deterministic JSON/Zod format that can compile into SQLite without an LLM deciding Truth.

This is not a complete World Pack platform and not a full Dragon chronology.

---

## 1. Source format decision

Authoritative source format for this slice:

```text
JSON
→ Zod validation
→ deterministic compiler
→ SQLite seed
```

Do not use SillyTavern WorldInfo as the authoritative intermediate format. WorldInfo's entry-oriented authoring pattern may be borrowed for human readability, but trigger-key text blocks are insufficient for Fact / Claim / CharacterKnowledge / route / background-thread semantics.

The compiler must not call an LLM.

---

## 2. Top-level document

```text
Dragon2009SnapshotSource
  schemaVersion
  world
  chronology
  locations[]
  routes[]
  characters[]
  facts[]
  claims[]
  knowledge[]
  items[]
  backgroundThreads[]
  sourceRefs[]
```

All IDs are stable and explicit.

---

## 3. World and chronology

```text
world
  id: "longzu"
  title
  publicName
  protocolRef

chronology
  snapshotId
  canonicalDateOrRange
  playerFacingEra
  playerFacingTimeLabel
  publicPremise
  sourceRefs[]
```

Requirements:

- a player-facing label is not enough; the snapshot has a stable internal date/range;
- chronology must distinguish confirmed canon from slice-local starting assumptions;
- no `·1/·2/·3` technical suffixes;
- public premise contains only information an ordinary player may know at start.

---

## 4. Provenance

Every canon-derived record references one or more source entries.

```text
SourceRef
  id
  sourceType:
    - official_novel
    - official_revision
    - official_supplement
    - owner_protocol
    - slice_authored
  workOrFile
  editionOrVersion
  locator
  paraphrase
  status:
    - confirmed
    - provisional
    - unresolved
  notes
```

Rules:

- `owner_protocol` may define simulation rules but cannot substitute for missing canon facts;
- `slice_authored` is allowed only for explicitly invented ordinary slice details that do not contradict canon;
- model memory is never a source type;
- public GitHub stores concise paraphrase + locator, not long copyrighted excerpts;
- records with `unresolved` canon references cannot compile into authoritative canon state.

---

## 5. Locations and route graph

```text
LocationSource
  id
  name
  kind
  visibility: public | hidden
  parentLocationId | null
  sourceRefs[]

RouteSource
  id
  fromLocationId
  toLocationId
  travelMinutes
  bidirectional
  visibility: public | hidden
  conditions[]
  sourceRefs[]
```

Minimum first-hour scope:

- 4–6 locations;
- 5–8 route edges;
- one ordinary starting location;
- at least one alternate route so “short route vs long route” is authoritative rather than prose.

Compiler checks:

- all location references exist;
- route times are positive integers;
- hidden routes never enter ordinary player context without legal discovery;
- bidirectional routes compile predictably;
- there is no unreachable starting location.

---

## 6. Characters

```text
CharacterSource
  id
  name
  kind: player_template | npc
  locationId
  alive
  publicDescription
  privateAnchor
  organizationIds[]
  sourceRefs[]
```

`privateAnchor` may contain only source-backed character behavior needed to keep the NPC stable. It is not automatically visible to the player or other NPCs.

The first-hour slice includes only characters needed for:

- the credible 2009 world state;
- the independent background thread;
- the player's immediate ordinary environment.

Do not add characters merely because they are famous.

---

## 7. Facts, claims, and knowledge

### FactSource

```text
FactSource
  id
  subject
  predicate
  object
  visibility: public | hidden
  validFrom
  validTo | null
  sourceRefs[]
```

A Fact is objective in the starting snapshot.

### ClaimSource

```text
ClaimSource
  id
  subject
  predicate
  object
  sourceRefs[]
```

A Claim is a statement/rumor/proposition and is not automatically true.

### KnowledgeSource

```text
KnowledgeSource
  characterId
  claimId
  state: rumor | believed | confirmed
  sourceKind: seed | character | event
  sourceRefId
```

Rules:

- absence of a Knowledge row means the character has not encountered the Claim;
- ordinary player and ordinary NPCs do not receive hidden canon because the model knows it;
- public premise and hidden facts are compiled separately;
- the compiler never infers `knownBy` from a prose paragraph.

---

## 8. Items

```text
ItemSource
  id
  name
  locationId | null
  carrierId | null
  durableProperties[]
  sourceRefs[]
```

Only items required for the first-hour causal path are included.

If an item contains durable objective content, model it explicitly:

```text
DurableProperty
  key
  value
  visibility
  sourceRefs[]
```

Example categories:

- written text;
- owner/source;
- serial/marking;
- state relevant to future causality.

Do not build a general inventory/equipment system.

---

## 9. Background threads

```text
BackgroundThreadSource
  id
  title
  actorIds[]
  objective
  initialStage
  locationScope[]
  startsAt
  beats[]
  sourceRefs[]

BackgroundBeatSource
  beatId
  stageFrom
  stageTo
  dueAt | afterMinutes
  preconditions[]
  consequences[]
  exposureRules[]
```

### Preconditions

Use a small deterministic set for this slice:

```text
- time_at_or_after
- thread_stage_is
- character_at_location
- fact_is_open
- player_route_intersects_scope
```

### Consequences

Each persistent consequence must map to a trusted system-owned Authority candidate/event.

The slice may add one system-only thread-stage event/candidate if required for idempotent progression. It must not create a generic scheduler framework.

### Exposure rules

```text
ExposureRule
  kind:
    - same_location
    - route_intersection
    - public_broadcast
    - visible_result
  observerRequirements[]
  presentationDirective
```

An exposure is player-visible presentation, not a new Truth write.

The opening hook is valid only when an existing beat/exposure intersects the player's legal context.

---

## 10. Slice-authored vs canon-derived data

### Canon-derived

Must have confirmed source references:

- named canon character status;
- original-history event status;
- organization status;
- canon knowledge boundaries;
- confirmed location/time anchors.

### Slice-authored ordinary detail

May be created explicitly and marked `slice_authored`:

- an ordinary classroom, shop, route, or family detail;
- an unnamed ordinary NPC;
- the player's mundane starting circumstances;
- a local incidental object.

Slice-authored detail must:

- not contradict canon;
- not secretly grant special bloodline/ability/destiny;
- not force famous characters toward the player;
- not be mistaken for canon in later documentation.

---

## 11. Minimum Dragon 2009 entry inventory

The compiler may be implemented before canon values are filled. The entry inventory for this slice is:

### Required chronology

- one exact date or bounded date range;
- one player-facing era label;
- one ordinary public premise.

### Required locations/routes

- one school/interior starting location;
- school exit;
- ordinary street/old district route;
- destination relevant to the player's mundane life;
- one short route and one long route with authoritative travel time;
- any thread exposure location required by the slice.

### Required world actors

- ordinary player template;
- 1–2 ordinary local NPCs;
- only the canon actor(s) actually required by the independent thread;
- one organization state only if directly required.

### Required knowledge

- what the ordinary player knows at start;
- what local NPCs know;
- what thread actors know;
- which hidden canon facts remain absent from ordinary prompts.

### Required background thread

- one independent objective;
- 2–3 beats;
- one exposure that may intersect the player;
- one branch where the player ignores it and the thread continues.

No complete chronology, no 200-character database, no multi-era support.

---

## 12. Compiler rules

The deterministic compiler must reject:

- missing references;
- duplicate IDs;
- unresolved authoritative canon records;
- hidden knowledge assigned to ordinary characters without source;
- routes referencing missing locations;
- non-positive travel time;
- background beats without stable IDs;
- consequences that cannot map to an Authority operation;
- an opening exposure with no independent thread source;
- source records that use model memory as provenance.

Compilation is all-or-nothing. A failed source does not partially seed SQLite.

---

## 13. Verification

1. same JSON compiles to the same seed/state;
2. invalid references fail before SQLite writes;
3. unresolved canon facts cannot become Authority;
4. ordinary player context excludes hidden canon;
5. route reachability and duration are deterministic;
6. background beat executes once and survives restart;
7. player ignorance does not stop the thread;
8. opening exposure appears only when intersection rules are satisfied;
9. no LLM call occurs during compilation.
