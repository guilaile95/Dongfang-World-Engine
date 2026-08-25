import { describe, expect, it } from "vitest";
import {
  CONTINUITY_ORDER,
  EXPERIMENT_1_EVIDENCE,
  expandContinuityFor,
  rollingSummaryEnabled,
} from "../app/context/continuity.js";
import { writeSummary } from "../app/context/artifacts.js";
import { RECENT_WINDOW } from "../app/context/recent.js";
import { assemblePrompt } from "../app/visibility/assemble.js";
import { CHAR_KEEPER, CHAR_PLAYER, FACT_BAG, WORLD_ID } from "../app/world/seed.js";
import { memoryWorld } from "./helpers.js";

describe("context continuity layers", () => {
  it("packs observer context in the gated order and keeps rolling summary off by default", () => {
    const store = memoryWorld();
    const assembled = assemblePrompt({
      snapshot: store.snapshot(WORLD_ID),
      observerId: CHAR_PLAYER,
      recentScenes: ["你：掌柜，汤好了吗？"],
      loreHits: [
        {
          title: "hall",
          body: "堂屋还亮着灯。",
          score: 2,
          namespace: "public",
          kind: "lore",
        },
      ],
      rollingSummary: "整座客栈已经没了。",
      evidence: EXPERIMENT_1_EVIDENCE,
    });
    expect(CONTINUITY_ORDER).toEqual([
      "authoritative_state",
      "recent_scenes",
      "stable_essentials",
      "episodic_recall",
      "rolling_summary",
    ]);
    const text = assembled.prompt;
    const stateAt = text.indexOf("当前状态（权威）");
    const recentAt = text.indexOf("最近场景（非权威");
    const essentialsAt = text.indexOf("稳定设定：");
    const recallAt = text.indexOf("相关回忆（可见性之后");
    expect(stateAt).toBeGreaterThanOrEqual(0);
    expect(stateAt).toBeLessThan(recentAt);
    expect(recentAt).toBeLessThan(essentialsAt);
    expect(essentialsAt).toBeLessThan(recallAt);
    expect(text).toContain("汤好了吗");
    expect(text).toContain("堂屋还亮着灯");
    expect(text).not.toContain("滚动摘要");
    expect(text).not.toContain("整座客栈已经没了");
    expect(assembled.continuity.rollingSummary).toBeNull();
    expect(assembled.continuity.recentScenes.length).toBeLessThanOrEqual(RECENT_WINDOW);
    store.close();
  });

  it("does not treat experiment-1 or hypothetical long play as a reason to expand", () => {
    expect(EXPERIMENT_1_EVIDENCE.recentWindowInsufficient).toBe(false);
    expect(rollingSummaryEnabled(EXPERIMENT_1_EVIDENCE)).toBe(false);
    expect(rollingSummaryEnabled(null)).toBe(false);
    expect(expandContinuityFor({ hypotheticalLongPlay: true })).toBe(false);
    expect(
      expandContinuityFor({
        evidence: {
          protocol: "maybe-later",
          recentWindowInsufficient: true,
          provenBy: "step-14-real-play",
        },
      }),
    ).toBe(true);
  });

  it("drops recall outside the observer legal namespaces and ignores summary hits without evidence", () => {
    const store = memoryWorld();
    const assembled = assemblePrompt({
      snapshot: store.snapshot(WORLD_ID),
      observerId: CHAR_PLAYER,
      loreHits: [
        {
          title: "secret",
          body: "guest-li-bag 在地窖",
          score: 9,
          namespace: `char:${CHAR_KEEPER}`,
          kind: "lore",
        },
        {
          title: "wrong-sum",
          body: "客栈已烧毁",
          score: 9,
          namespace: `char:${CHAR_PLAYER}`,
          kind: "summary",
        },
      ],
    });
    expect(assembled.prompt).not.toContain("guest-li-bag");
    expect(assembled.prompt).not.toContain(FACT_BAG);
    expect(assembled.prompt).not.toContain("客栈已烧毁");
    expect(assembled.continuity.episodic).toEqual([]);
    store.close();
  });

  it("can show a rebuildable rolling summary only after evidence, and still cannot overwrite facts", () => {
    const store = memoryWorld();
    const before = store.snapshot(WORLD_ID).facts;
    writeSummary(store, WORLD_ID, CHAR_PLAYER, "roll", "客栈已烧毁，guest-li-bag 不在地窖。");
    const assembled = assemblePrompt({
      snapshot: store.snapshot(WORLD_ID),
      observerId: CHAR_PLAYER,
      rollingSummary: "客栈已烧毁，guest-li-bag 不在地窖。",
      evidence: {
        protocol: "step-14-proof",
        recentWindowInsufficient: true,
        provenBy: "step-14-real-play",
      },
    });
    expect(assembled.prompt).toContain("滚动摘要（非权威，可重建，不能覆盖事实）");
    expect(assembled.prompt.indexOf("相关回忆")).toBeLessThan(assembled.prompt.indexOf("滚动摘要"));
    expect(store.snapshot(WORLD_ID).facts).toEqual(before);
    expect(store.snapshot(WORLD_ID).facts.some((row) => row.id === FACT_BAG)).toBe(true);
    store.close();
  });
});
