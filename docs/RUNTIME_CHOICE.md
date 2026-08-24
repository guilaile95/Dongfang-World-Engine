# Runtime and language choice

Chosen **after** Step 3 ([`MINIMAL_COMPOSITION.md`](MINIMAL_COMPOSITION.md)).

## Decision

**TypeScript on Node.js (single process). Structured checks: Zod only.**

Not chosen because the archived engine was TypeScript.  
Not rejected-Python because Pydantic/LiteLLM feel handy.

## Compared against the actual composition

| Need from Step 2–3 | TypeScript + Node | Python |
|---|---|---|
| ADAPT Vercel AI SDK (`generateText` / `streamText`, Apache-2.0, in-process) | Native | Would drop the ADAPT and hand-roll HTTP or take **deferred** LiteLLM |
| One OpenAI-compatible cloud endpoint (`DWE_LLM_*`) | `@ai-sdk/openai-compatible` | `openai` / httpx / LiteLLM SDK |
| Local one-file world | better-sqlite3 (already a dep) | stdlib sqlite3 |
| Schema for *internal* durable payloads | Zod (one stack) | Pydantic (one stack) |
| Extra process | No | LiteLLM proxy or OpenViking server — both deferred/rejected for v1 |
| CLI slice | readline | argparse |

Python wins only if we *adopt* LiteLLM or OpenViking in-process. Survey: LiteLLM **DEFER**, OpenViking **REJECT** (AGPL). The one non-deferred mature chat component is the AI SDK. Putting the slice in Python would re-implement that adapter and split the repo across two schema stacks.

Maintenance: one language, one validator, one process, one file.

## Explicitly not done

- No Pydantic, no second schema framework.
- No LiteLLM proxy as a required runtime.
- No `openviking_adapter/` / `worldx_style/` packages.
