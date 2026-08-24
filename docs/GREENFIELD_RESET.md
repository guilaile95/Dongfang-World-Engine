# Owner Greenfield Reset

Owner Issue: **[#68](https://github.com/guilaile95/Dongfang-World-Engine/issues/68)**.

This is the **current Owner product decision**. It outranks previous Issues, PRs, ADRs, `CURRENT_STAGE.md` snapshots, and Notion “current route” pages.

Do not restore the old Production Runtime, Roadmap, or Chat-first incremental path because tests, CI, PRs, or sunk cost exist.

## Decision

1. All previous Production Runtime code may be discarded.
2. Do not keep old APIs, directories, database schemas, class names, or compatibility layers.
3. Do not keep an old implementation because of tests, PRs, CI, or effort already spent.
4. Old code, Issues, PRs, ADRs, and Notion pages are **historical experiments, failure modes, and requirement evidence**.
5. Product problems and long-term invariants proven in real play **survive** the rewrite.

## Archive anchors (git history kept, not rewritten)

| Anchor | SHA / ref | What it is |
|---|---|---|
| `archive/pre-greenfield-reset` | `092f0442ccba92956c045e025ef5beb38ab0cb66` | Live `main` at reset (freeze docs #64 + old runtime) |
| `archive/pre-greenfield-main` | same | Recoverable branch |
| `archive/chat-first-pr-67` | `755a79badcfb78c305df4af8f347c7243b12f9f7` | #67 chat-first experiment |
| `archive/chat-first-owner-reset` | same | Recoverable branch |
| `archive/composition-audit-pr-65` | `de362a2425179dc8ea45e01e4de1c87836b6f172` | #65 composition audit docs |

New work starts on `greenfield/owner-reset`. Old runtime may be deleted **on that branch**.

## Previous route — do not continue or merge

These were live at reset and belong to the superseded path:

- Issue **#66** — Chat-first unfreeze / incremental reset
- PR **#67** — chat-first play implementation
- PR **#65** — #63 composition audit docs as unfreeze proposal

Do not merge them as the current product path.

## Inherited product problems (keep)

Verified in real play and owner intent:

- Players want **web-AI-chat freedom** for long-form text roleplay, not a command menu.
- SillyTavern-class tools are too heavy for this product.
- Prompt-only chat forgets, OOC-drifts, drops plot, loses rules, leaks knowledge, and **makes the world orbit the player**.
- Off-plot daily life (eat, wander, chat) must not collapse an authored in-progress plot into player-centric slice-of-life.

## Inherited invariants (keep as *product*, not as current classes/tables)

- **Engine constrains consequences, not imagination.**
- **The world must not orbit the player.**
- Persistent local-first world: plot, facts, and rules survive process restart.
- LLM output, chat prose, summaries, and Memory are **not** the fact database and have **no direct persistent write authority**.
- Objective world, uncertain propositions, and per-character knowledge are different things (names of tables are not sacred).
- Durable changes should be explainable later (what happened, why), not only a final blob of prose.
- Visibility before recall: a character must not receive secrets they have no right to know.
- **Compose-first. Own only the irreducible product core.** Prefer mature libraries over a from-scratch engine.
- This repository stays **MIT**. Do not vendor SillyTavern (AGPL) or RisuAI (GPL) source.

## Inherited failure modes (do not repeat)

- Mapping free chat onto a closed actor-Proposal / engine-verb menu.
- Substituting an unrelated legal verb (e.g. movement) when the player refuses or goes off-plot.
- Turning questions into knowledge transmission; advancing time on empty input; narrator stuck on one plot hook.
- Treating Memory, summaries, or the LLM as Truth.
- Preserving local modules because they were already merged.
- Relicensing this repo by copying AGPL/GPL frontends.

## Source roles

- **GitHub** = Engineering Reality (`main`, Issues, PRs, CI, tags).
- **Notion** = long-term Product Intent, invariants, architecture reasons, cross-stage lessons. Do not copy the GitHub timeline into Notion.
