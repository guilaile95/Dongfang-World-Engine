# Project Handover & Recovery Protocol

Status: stable project-governance protocol

This document defines how any new development model / agent should recover, take over, and hand off Dongfang World Engine without relying on chat history.

The protocol is intentionally **model-agnostic**. Model/vendor names are execution details, not architecture facts.

## 1. Core rule

> **A handover passes recovery coordinates, not a rewritten project history.**

A new owner must recover the project from live sources. Do not paste a long conversation transcript and ask the next model to infer the current engineering state.

The default recovery path is:

```text
GitHub live state
→ current Stage / Issue / PR
→ relevant code + tests + CI
→ long-term Notion context when needed
→ work
```

## 2. Authority order

When sources conflict, use this order:

1. current explicit user instruction;
2. Owner Greenfield Reset (`docs/GREENFIELD_RESET.md` + live owner Issue) and `docs/CURRENT_STAGE.md`;
3. GitHub current code / `main` / CI / **current** open Issue / open PR (not archived #65/#66/#67);
4. Notion long-term **current** intent pages (Greenfield North Star). Pre-reset Notion pages are Historical / Superseded;
5. archived git tags / historical GitHub documents (evidence only);
6. historical chat context;
7. model inference.

Important consequences:

- a stale Notion snapshot never overrides GitHub;
- a handover SHA is a recovery hint until live GitHub confirms it;
- an implementer report never overrides the actual diff / tests / CI;
- a closed Issue does not prove completion if the required code is not on `main`.

## 3. What a handover must contain

Keep the handover short. Include only fields that help the next owner locate live truth.

Required when known:

```text
Repository
Recovery-hint main SHA
Stage Goal / owner Issue
Current Task / Issue
Current PR
Next Task / Issue
Current blocker / review gate
Read-first files / Issues / PR comments
North Star
Core invariants to preserve
Explicit do-not-do list
Immediate mission
Expected recovery output
```

Do **not** include:

- full chat history;
- long commit timelines already available in GitHub;
- copied PR diffs;
- raw model prompts / provider responses;
- hidden reasoning / chain-of-thought;
- API keys, credentials, tokens or secrets;
- vendor/model choices as durable architecture facts.

## 4. Mandatory recovery sequence

Before implementation, the new owner must inspect live GitHub.

### 4.1 Repository state

Recover:

- default branch;
- exact current `main` SHA;
- latest merged PR / commit;
- open Issues;
- open PRs;
- latest relevant CI runs;
- worktree state if local access exists.

### 4.2 Stable project documents

Read only what is relevant to the current stage. Typical order:

1. `README.md`
2. `WORLD_ENGINE.md`
3. `docs/ARCHITECTURE_DECISIONS.md`
4. current stage / reset / contract documents named by the active Issue
5. `docs/ROADMAP.md`
6. `package.json`
7. current Issue / PR comments
8. relevant source and tests

Do not scan every historical document by default.

### 4.3 Current implementation surface

For the current task, inspect the actual modules and tests touched by the problem.

Never design from Issue prose alone when the code can answer the question.

### 4.4 Notion, if available

After GitHub recovery, read Notion only for durable context such as:

- project North Star;
- long-term invariants;
- architecture direction;
- validated product lessons;
- stage-transition rationale.

Do not use Notion as a second engineering task tracker.

## 5. Required recovery output

Before writing code, the new owner should produce a compact **Current Engineering State**:

```text
CURRENT ENGINEERING STATE

EXACT_MAIN:
LATEST_MERGE:
OPEN_PRS:
OPEN_ISSUES:
CI:
CURRENT_STAGE:
CURRENT_TASK:
CURRENT_BLOCKER:
P0_P1:
BEHAVIORAL_BLOCKERS:
DEFERRED_SCOPE:
SOURCE_CONFLICTS:

NEXT_ACTION:
<one smallest evidence-supported action>
```

If live GitHub differs from the handover hint, state the difference and follow GitHub.

## 6. Handling work already in progress

### 6.1 Open PR exists

Do not start the next implementation Slice automatically.

First:

```text
read PR current Head
→ inspect full diff
→ read latest review / issue comments
→ inspect CI
→ verify acceptance criteria
→ resolve P0/P1 or explicit review blockers
→ merge only after Gate passes
```

The handover must state whether the next Issue is blocked on the PR.

### 6.2 Review blocker exists

A review blocker remains active until the current PR Head demonstrably fixes it.

Do not treat:

- “author says fixed”;
- CI green;
- a changed prompt;

as sufficient by themselves.

Re-read the new diff and re-run the relevant semantic Gate.

### 6.3 P0 / P1 discovered

Pause the normal roadmap.

Fix correctness / authority first when the defect involves:

- Truth leakage;
- private Knowledge leakage;
- cross-world reference;
- direct LLM write;
- rejected Candidate partial state;
- replay divergence;
- provenance corruption;
- transaction / revision / causal-legality corruption;
- Narrator gaining persistent authority.

Behavioral problems do not enter Hard Validator merely because they feel bad.

## 7. Development protocol after recovery

Default autonomous workflow:

```text
Recover exact baseline
→ audit current code / existing solution
→ define smallest vertical Slice
→ Issue with Scope / AC / Tests / Stop Rule
→ branch
→ implement
→ targeted tests
→ typecheck / test / build
→ PR
→ inspect actual diff + CI
→ fix blockers
→ merge
→ real play / experiment when product evidence is needed
→ observe next blocker
```

Do not stop after every PR if the next step is already clearly implied by evidence.

Do stop when further work would require a product or architecture decision that evidence cannot resolve.

## 8. Build-vs-Borrow rule

Before adding infrastructure, ask:

> **Without this, why does the current real gameplay Slice fail?**

If there is no concrete answer, default to not building it.

Own the Authority Core. Borrow mature local patterns or libraries where they reduce risk.

Avoid speculative platform work such as generic routers, DSLs, distributed systems, full schedulers, vector stacks, large dialogue frameworks or UI platforms unless a real blocker justifies them.

## 9. Product recovery rule

Engineering recovery must also recover the current product North Star.

For the current Chat-first direction, the durable rule is:

> **Engine constrains consequences, not imagination.**

The engine may constrain which consequences become authoritative persistent state. It must not turn its schemas into a hidden menu of what the Player is allowed to imagine, say, ask or attempt.

The Authority Core remains unchanged unless evidence proves otherwise:

```text
Database is Truth
Events Explain State
Fact != Claim != CharacterKnowledge != Memory
LLM has no direct write authority
Visibility Gate before probabilistic relevance
Candidate → Hard Validator → Transaction → Event → Projection
Narrative is non-authoritative
Replay / provenance remain explainable
```

## 10. Notion synchronization rule

Notion is low-frequency, event-driven memory.

Sync only when something will still matter months later, for example:

- Invariant added or corrected;
- Architecture Direction materially changed;
- a hypothesis was validated / disproved by real play;
- a Vertical Slice produced a durable cross-stage lesson;
- a P0/P1 has long-term architecture value;
- a formal stage transition occurred.

Do not sync every:

- commit;
- branch;
- ordinary PR;
- CI run;
- debug note;
- model/vendor switch.

Prefer updating an existing page over creating another timeline page.

## 11. Real-model experiment discipline

A formal real-model run is an experiment sample, not a demo reroll loop.

Once a formal run starts:

- do not reroll because the result is unattractive;
- do not secretly switch provider / model / prompt to obtain a preferred story;
- evaluate observable output only;
- start a new explicitly frozen experiment if another run is required.

Safe traces must not contain credentials, raw system prompts, raw provider responses, hidden reasoning, full unrestricted snapshots, or private information the actor was not authorized to see.

## 12. Stop / escalation conditions

Escalate instead of autonomously continuing when:

- a core Authority invariant must change;
- the next step requires replacing the Kernel / Truth model;
- two materially different product directions remain and evidence cannot choose;
- an irreversible or externally consequential action is required;
- credentials / permissions block the work;
- the only remaining work is low-value polishing;
- there is no evidence-supported next task.

## 13. Compact handover template

Use this format when handing the project to another model / agent.

Keep it short; the recipient must recover live state itself.

```text
Repository:
guilaile95/Dongfang-World-Engine

First recover from live GitHub. Do not rely on chat history.
GitHub main / Open Issues / Open PRs / CI are Engineering Truth.

RECOVERY_HINT_MAIN:
<sha>

STAGE_GOAL:
#<issue> — <title>

CURRENT_TASK:
#<issue> — <title>

CURRENT_PR:
#<pr> — <title / none>

NEXT:
#<issue> — <title / unknown>

READ_FIRST:
1. <current stage doc>
2. docs/ARCHITECTURE_DECISIONS.md
3. current Issue / PR comments
4. relevant code + tests
5. Notion long-term page only if needed

CURRENT_BLOCKER:
<one concise blocker / none>

NORTH_STAR:
<one or two sentences>

KEEP:
- core invariant 1
- core invariant 2
- ...

DO_NOT:
- known scope trap 1
- known scope trap 2
- ...

MISSION:
Audit current live state first. If the current PR still has a blocker, fix / review / CI / merge it before starting NEXT. Then continue autonomously within the current Stage.

RECOVERY_OUTPUT:
- exact main
- latest merge
- open PRs / Issues
- CI
- current Stage / Task / Blocker
- P0/P1
- deferred scope
- source conflicts
- one Next Action
```

## 14. Anti-patterns

Do not hand over like this:

```text
Here are 20,000 words summarizing every previous discussion...
```

Do not let the receiver assume:

```text
"The previous model said PR X passed, therefore I can start the next task."
```

Do not freeze stale current-state facts into long-term architecture documents.

Do not create a second project authority layer in chat or Notion.

## 15. Definition of a good handover

A good handover lets a capable new owner answer, from live sources, within one recovery pass:

1. What is true on `main` now?
2. What Stage are we in?
3. What is the current task?
4. What blocks it?
5. What must not be broken?
6. What is explicitly deferred?
7. What is the single next high-value action?

If those answers require reading the previous model's entire conversation, the handover protocol has failed.
