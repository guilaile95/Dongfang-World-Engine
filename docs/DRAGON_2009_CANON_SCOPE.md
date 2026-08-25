# Dragon 2009 Canon Scope and Provenance Rules

Status: **source boundary for Issue #75**

This document separates the world-running protocol from canon evidence.

---

## 1. Current source classification

### Owner-provided `龙族V1.0(1).txt`

Classification:

```text
sourceType = owner_protocol
```

It defines:

- one continuous Dragon world;
- world does not orbit the player;
- ordinary life remains real;
- canon history is the default baseline until causally changed;
- hidden-state initialization;
- player information boundaries;
- no source-less dramatic escalation;
- opening initialization requirements.

It does **not** by itself establish the concrete 2009 status of named characters, organizations, locations, or original-history events.

The protocol explicitly says concrete facts must use reliable original sources and must not be replaced by its summary wording.

Therefore:

- it may define simulation rules;
- it may not be used as the sole source of named-character or historical Truth;
- it may not be treated as the original novel corpus;
- it may not justify a fixed warning-letter hook by itself.

---

## 2. Canon Source Set required from Owner

Before authoritative Dragon 2009 facts are populated, the Owner must define the accepted local Canon Source Set.

Required decisions:

1. Which published novel edition/version is primary?
2. Are later official revisions included?
3. Which official supplements or author-confirmed materials are included?
4. Are adaptation-only facts excluded by default?
5. When sources conflict, which source wins?
6. What exact date/range is the Dragon 2009 snapshot?

Recommended default policy, pending Owner approval:

```text
Primary:
  official published novel text selected by Owner

Secondary:
  official revision/supplement explicitly approved by Owner

Excluded unless separately approved:
  fan wiki
  forum summary
  adaptation-only material
  model memory
  unsourced web summary
```

This policy is a recommendation, not a claimed Owner decision.

---

## 3. Local/private vs public repository

The full copyrighted Canon Corpus should remain in the Owner's local source directory.

The public repository may store:

- source manifest metadata;
- concise factual paraphrases;
- edition/version identifiers;
- chapter/page/section locators;
- source hashes if useful;
- provenance links between snapshot records and local source entries.

The public repository must not store large copyrighted excerpts merely to make tests convenient.

Deterministic unit tests should use short synthetic/provenance fixtures.

Real integration may read the Owner-approved local Canon Source Set.

---

## 4. Provenance record

Each canon-derived snapshot record must reference:

```text
sourceRef
sourceType
workOrFile
editionOrVersion
locator
paraphrase
status: confirmed | provisional | unresolved
notes
```

### Status meaning

`confirmed`
- directly checked against an approved source;
- may compile into authoritative snapshot state.

`provisional`
- plausible but not yet checked against the approved source;
- may appear only in research notes, never in Authority.

`unresolved`
- required by the slice but source evidence is missing/conflicting;
- blocks authoritative compilation for that record.

Model memory cannot move a record from unresolved to confirmed.

---

## 5. Dragon 2009 entry inventory

This inventory is the maximum canon scope for the First-Hour slice. It is not yet populated with facts.

### A. Chronology

- exact/bounded 2009 date;
- which original events have already occurred;
- which relevant events have not yet occurred;
- public ordinary-world context at that date.

### B. Named character status

Only named canon characters actually required by the first-hour world/thread:

- current location or operational scope;
- alive/active status;
- immediate objective relevant to the thread;
- what they know at this date;
- what ordinary people do not know.

Do not include famous characters merely to prove this is Dragon Raja.

### C. Organization status

At most one organization state required by the thread:

- current objective;
- relevant operational footprint;
- public vs hidden aspects;
- source-backed knowledge boundary.

### D. Ordinary-world baseline

- school/city public context;
- mundane routes and travel times;
- ordinary NPC environment;
- any public event that can be source-backed for the date.

### E. Independent background thread

The thread must have:

- a source-backed or explicitly slice-authored origin;
- actors with their own objective;
- a stage that exists before player contact;
- 2–3 deterministic beats;
- a player exposure that occurs only through location/time/visibility intersection.

If the thread is slice-authored rather than canon-derived, it must be marked `slice_authored` and must not contradict canon or force named canon actors toward the player.

---

## 6. What may be slice-authored

Allowed, with explicit `slice_authored` provenance:

- the ordinary player's family and mundane background;
- unnamed local NPCs;
- an ordinary classroom/shop/home detail;
- route geometry and practical travel minutes when not contradicted by canon;
- a local incident caused by an independent ordinary actor;
- a background thread using original minor actors, provided it fits the world and does not grant the player hidden destiny.

Not allowed without canon evidence:

- named canon character location/objective;
- canon organization operation;
- hidden world facts;
- special bloodline/ability;
- fate-linked invitation;
- famous character encounter;
- source-less Dragon/Artifact/Nibelungen event.

---

## 7. Canon conflict rules

The compiler does not resolve source conflicts.

Conflicting source entries must be surfaced before compilation with:

```text
recordId
sourceA
sourceB
conflictDescription
ownerDecisionRequired
```

Until resolved, the record remains `unresolved` and cannot enter the authoritative snapshot.

---

## 8. Implementation sequence while Canon Source Set is pending

Work that may proceed immediately:

- Scene Lifecycle contract;
- Time/Route contract;
- Background Thread schema;
- JSON/Zod snapshot schema;
- deterministic compiler skeleton;
- provenance validation;
- synthetic fixture tests;
- cancellation/cap/idempotency infrastructure.

Work that must wait for approved source evidence:

- authoritative named-character 2009 status;
- authoritative organization status;
- original-history event state;
- canon-specific Background Thread facts;
- final Dragon real-play snapshot acceptance.

This boundary prevents Canon uncertainty from blocking all engineering progress while also preventing model memory from silently becoming Truth.

---

## 9. Owner decision required

The remaining Owner-only input is:

> Provide or identify the exact local Dragon novel/revision files that constitute the accepted Canon Source Set, and choose the specific 2009 snapshot date/range.

Until then, Issue #75 should continue through contract/compiler/lifecycle work but must label canon records unresolved rather than inventing them.
