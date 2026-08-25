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

## 2. Inventoried local Canon Source Set

The Owner-provided local directory was recursively inventoried on 2026-08-26. Raw relative-path mapping and hashes remain under gitignored `data/local/dragon-canon-manifest.json`; the public repository does not contain the absolute local path or novel text.

Files found:

- `dragon-bundle-5books`: 《龙族Ⅰ·火之晨曦》《龙族Ⅱ·悼亡者之瞳》《龙族Ⅲ·黑月之潮》上/中/下. This is the primary source for the 2009 slice.
- `dragon-prequel-mourning-wing`: a supplemental prequel text framed in 2010; not needed for the selected 2009 window.
- `dragon-v5-return-of-the-mourner-serial`: a later, unfinished serial package; not needed for the selected 2009 window.
- `dragon-owner-protocol-v1`: simulation protocol only, never a Canon fact source.

Applied policy:

```text
Primary:
  dragon-bundle-5books / 《龙族Ⅰ·火之晨曦》

Secondary:
  none required for this first-hour window

Excluded unless separately approved:
  fan wiki
  forum summary
  adaptation-only material
  model memory
  unsourced web summary
```

Snapshot window:

```text
2009-05-15 evening/night
runtime start: 18:30 +08:00 (explicit slice-authored minute anchor)
```

The source directly confirms Friday 2009-05-15, the southern city, the pharmacy-side wait, the dispatched pickup, and the black helicopter crossing the city that night. It does not give an exact minute; `18:30` is therefore recorded as `slice_authored`, not Canon.

No supplied-source conflict affects this window. Later serial/prequel material is not used to overwrite Book I's 2009 event ordering.

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

## 8. Implementation sequence after inventory

Work implemented from the confirmed narrow source set:

- Scene Lifecycle contract;
- Time/Route contract;
- Background Thread schema;
- JSON/Zod snapshot schema;
- deterministic compiler skeleton;
- provenance validation;
- synthetic fixture tests;
- cancellation/cap/idempotency infrastructure.

Still excluded from this slice:

- named-character or organization facts beyond the two actors and one pickup process required by the selected passage;
- facts from later revisions/supplements that were not required by the selected passage;
- adaptation-only material;
- final Owner product acceptance.

This boundary prevents Canon uncertainty from blocking all engineering progress while also preventing model memory from silently becoming Truth.

---

## 9. Remaining Owner decision

No edition/date conflict currently blocks implementation. Owner input is needed again only if a later requested record requires a supplied source that materially conflicts with the primary Book I passage.

The final Dragon real-play result remains Owner acceptance, not an engineering inference.
