import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

interface CallRow {
  purpose?: string;
  role?: string;
  structuredMode?: string;
  errorCategory?: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  latencyMs?: number;
}

function load(name: string): Record<string, unknown> | null {
  const path = resolve("data/local", name);
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function callsOf(receipt: Record<string, unknown> | null): CallRow[] {
  if (!receipt) {
    return [];
  }
  if (Array.isArray(receipt.calls)) {
    return receipt.calls as CallRow[];
  }
  const turns = receipt.turns;
  if (!Array.isArray(turns)) {
    return [];
  }
  return turns.flatMap((turn) => {
    const row = turn as { calls?: CallRow[] };
    return row.calls ?? [];
  });
}

function quantile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) {
    return null;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index] ?? null;
}

async function main(): Promise<void> {
  mkdirSync("data/local", { recursive: true });
  const r3 = load("experiment-3-receipt.json");
  const r4c = load("experiment-4c-e2e-receipt.json");
  const r5 = load("experiment-5-failclosed-receipt.json");
  const r6 = load("experiment-6c-narrator-receipt.json")
    ?? load("experiment-6b-narrator-receipt.json")
    ?? load("experiment-6-narrator-receipt.json");
  const calls = [...callsOf(r3), ...callsOf(r4c), ...callsOf(r6)];
  const byPurpose = new Map<string, CallRow[]>();
  for (const call of calls) {
    const key = call.purpose ?? call.role ?? "unknown";
    const list = byPurpose.get(key) ?? [];
    list.push(call);
    byPurpose.set(key, list);
  }
  const latencies = calls.map((call) => call.latencyMs ?? 0).filter((n) => n > 0).sort((a, b) => a - b);
  const tokenIn = calls.reduce((sum, call) => sum + (call.inputTokens ?? 0), 0);
  const tokenOut = calls.reduce((sum, call) => sum + (call.outputTokens ?? 0), 0);
  const walls = [r3?.wallMs, r4c?.wallMs, r6?.wallMs].filter((n): n is number => typeof n === "number");
  const turnCounts = [
    typeof r3?.total === "number" ? r3.total : 10,
    2,
    4,
  ];
  const measuredTurns = turnCounts.reduce((a, b) => a + b, 0);
  const avgWallPerTurn = walls.reduce((a, b) => a + b, 0) / Math.max(1, measuredTurns);
  const callsPerTurn = calls.length / Math.max(1, measuredTurns);
  const projected30WallMs = avgWallPerTurn * 30;
  const projected30Calls = callsPerTurn * 30;
  const projected30In = (tokenIn / Math.max(1, measuredTurns)) * 30;
  const projected30Out = (tokenOut / Math.max(1, measuredTurns)) * 30;
  const overTwoHours = projected30WallMs > 2 * 60 * 60 * 1000;
  const passed = !overTwoHours;
  const receipt = {
    protocol: "experiment-7-cost-gate",
    follows: "experiment-6-narrator-baseline",
    sources: ["experiment-3-receipt.json", "experiment-4c-e2e-receipt.json", "experiment-5-failclosed-receipt.json", "experiment-6-narrator-receipt.json"],
    measuredTurns,
    callCount: calls.length,
    byPurpose: Object.fromEntries(
      [...byPurpose.entries()].map(([key, rows]) => [
        key,
        {
          count: rows.length,
          tokenIn: rows.reduce((sum, row) => sum + (row.inputTokens ?? 0), 0),
          tokenOut: rows.reduce((sum, row) => sum + (row.outputTokens ?? 0), 0),
          modes: rows.map((row) => row.structuredMode ?? "none"),
        },
      ]),
    ),
    tokenIn,
    tokenOut,
    avgLatencyMs: latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null,
    p50LatencyMs: quantile(latencies, 0.5),
    p95LatencyMs: quantile(latencies, 0.95),
    maxLatencyMs: latencies.at(-1) ?? null,
    avgWallPerTurnMs: avgWallPerTurn,
    callsPerTurn,
    projected30: {
      wallMs: projected30WallMs,
      wallHours: projected30WallMs / 3_600_000,
      calls: projected30Calls,
      tokenIn: projected30In,
      tokenOut: projected30Out,
      costUsd: null,
    },
    failclosedWallMs: r5 && typeof r5.wallMs === "number" ? r5.wallMs : null,
    overTwoHours,
    passed,
    ownerCostDecision: "no configured USD threshold; projected costUsd is null",
  };
  const out = resolve("data/local/experiment-7-cost-receipt.json");
  writeFileSync(out, `${JSON.stringify(receipt, null, 2)}\n`);
  process.stderr.write(
    `7 cost turns=${measuredTurns} avgTurn=${Math.round(avgWallPerTurn)}ms proj30h=${(projected30WallMs / 3_600_000).toFixed(2)} over2h=${overTwoHours} passed=${passed}\n`,
  );
  process.stderr.write(`receipt ${out}\n`);
  if (!passed) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
