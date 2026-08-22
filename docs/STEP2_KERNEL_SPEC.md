# Step 2 — World Engine Commit Kernel

This slice implements the deterministic world-state authority chain without any LLM dependency.

## Scope

Implement:

- Candidate Event schema;
- Hard Validator;
- transactional Commit;
- append-only Event Log;
- Projector;
- Materialized State;
- Fact / Claim / CharacterKnowledge separation;
- directional Relationship state;
- deterministic tests and state rebuild checks.

Do not implement:

- LLM calls;
- Memory providers;
- RAG / embeddings;
- UI;
- multi-agent NPCs;
- branching timelines;
- copyrighted world packs.

## Architectural corrections required before coding

1. Hard Validator must be deterministic code + data constraints. A future Soft Validator may advise or veto, but cannot authorize a state transition rejected by Hard Validator.
2. Remove `Fact.confidence`; uncertainty belongs to Claim, CharacterKnowledge, Lore, or Candidate inputs, not committed Truth.
3. Do not implement timeline branching in the MVP. `branch_id` is deferred until a complete branch model exists.
4. Define a Persistent State Boundary: only details that future simulation must reliably remember enter durable state.
5. Relationships are directional (`source_character_id` → `target_character_id`).
6. Character internal fields such as `current_goal` are not automatically visible to other characters or the player.

## Minimal event types

- `character.move`
- `character.die`
- `character.learn_claim`
- `relationship.change`
- `fact.assert`
- `claim.record`
- `world.time_advance`

`character.learn_fact` is not a supported compatibility path. `CharacterKnowledge` references `Claim`; `claim.record` only records a non-authoritative proposition and never creates or modifies `Fact`.

Add `item.transfer` only if Item is included in the first physical schema.

## Exit criteria

The slice is complete only when:

- Candidate Event has one validated schema boundary;
- Hard Validator has zero LLM dependency;
- Event + projection commit atomically;
- failed commit leaves no partial state;
- committed Events cannot be updated/deleted through normal domain paths;
- dead characters cannot perform ordinary movement;
- knowledge cannot appear without an auditable source;
- contradictory current Facts are rejected or correctly superseded;
- directional relationships remain independent;
- key Materialized State can be rebuilt from Event Log;
- 50–100 mixed valid/invalid candidates pass automated tests;
- typecheck, tests and build all pass.
