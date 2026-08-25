import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

function scanLocalDigests(): Map<string, string> {
  const localDir = join(process.cwd(), "data", "local");
  const map = new Map<string, string>();
  if (existsSync(localDir)) {
    for (const name of readdirSync(localDir)) {
      if (name.endsWith(".sqlite") || name.endsWith(".json")) {
        const buf = readFileSync(join(localDir, name));
        map.set(name, createHash("sha256").update(buf).digest("hex"));
      }
    }
  }
  return map;
}

const initialDigests = scanLocalDigests();

/** Wait for stub narrator to deliver a world message. */
async function send(page: Page, text: string): Promise<void> {
  await page.locator("textarea").fill(text);
  const prevCount = await page.locator(".msg").count();
  await page.keyboard.press("Enter");
  await expect(page.locator(".msg")).toHaveCount(prevCount + 2, { timeout: 120_000 });
  await expect(page.locator(".msg .body").last()).not.toHaveText("", { timeout: 120_000 });
  await expect(page.locator("textarea")).toBeEnabled({ timeout: 120_000 });
}

/** Navigate from world-select through onboarding into chat. */
async function startFreshSession(page: Page): Promise<void> {
  await page.goto("/");
  // If we land on Chat screen (e.g. from previous test), open world sheet and start new
  if (await page.locator(".top").isVisible({ timeout: 2000 }).catch(() => false)) {
    await page.getByTitle("世界").click();
    await expect(page.locator(".sheet")).toBeVisible();
    const activeRow = page.locator(".world-row").filter({ hasText: "当前" });
    await activeRow.getByRole("button", { name: "新人生" }).click();
    const confirmBtn = page.getByRole("button", { name: "保留旧档并新开" });
    if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirmBtn.click();
    }
  } else {
    // Landed on world-select screen
    await expect(page.locator(".brand")).toBeVisible({ timeout: 10_000 });
    const firstCard = page.locator(".world-card").first();
    await firstCard.getByRole("button", { name: "开始新人生" }).click();
    const confirmBtn = page.getByRole("button", { name: "保留旧档并新开" });
    if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirmBtn.click();
    }
  }

  // Onboard screen — pick random
  await expect(page.locator(".onboard-title")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "随机开局" }).click();

  // Character card screen — enter world
  await expect(page.locator(".charcard")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: /进入第一幕/ }).click();

  // Chat screen ready: first message is opening world message
  await expect(page.locator("textarea")).toBeEnabled({ timeout: 60_000 });
  await expect(page.locator(".msg.world")).toHaveCount(1, { timeout: 10_000 });
}

test.describe("chat-first shell", () => {
  test.afterAll(() => {
    const after = scanLocalDigests();
    expect(after.size).toBe(initialDigests.size);
    for (const [name, hash] of initialDigests.entries()) {
      expect(after.get(name)).toBe(hash);
    }
  });

  test("data isolation: E2E run does not modify data/local files or SHA-256 digests", () => {
    expect(process.env.DWE_PLAY_DIR ?? "").not.toContain("data/local");
    const current = scanLocalDigests();
    expect(current).toEqual(initialDigests);
  });

  test("desktop: onboarding → chat → opening → conversation → fail-closed stays human", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await startFreshSession(page);

    // Verify no Engine internals leaked in initial output
    await expect(page.locator("body")).not.toContainText("expectedRevision");
    await expect(page.locator("body")).not.toContainText("当前状态（权威）");
    await expect(page.locator("body")).not.toContainText("最近场景（非权威");
    await expect(page.locator("body")).not.toContainText("Candidate");

    // First message in chat is opening world message
    const firstMsg = page.locator(".msg").first();
    await expect(firstMsg).toHaveClass(/world/);

    // Step 18B: Top bar Scene Anchor & Time Badge
    await expect(page.locator(".top .who")).toBeVisible();
    await expect(page.locator(".top .who .world-name")).toBeVisible();

    // Step 18B: Situation hint & Suggestions grid
    const situation = page.locator(".situation-hint");
    if (await situation.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(situation).toContainText("眼下");
    }

    const suggestionBtn = page.locator(".suggestion-btn").first();
    if (await suggestionBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await suggestionBtn.click();
      const draftVal = await page.locator("textarea").inputValue();
      expect(draftVal.length).toBeGreaterThan(0);
    }

    // Step 18B: Era / Premise drawer
    await page.getByTitle("时期前情").click();
    await expect(page.locator(".era-drawer")).toBeVisible();
    await expect(page.locator(".save-status-pill")).toContainText("已自动保存");
    await page.locator(".era-drawer").getByRole("button", { name: "关闭" }).click();
    await expect(page.locator(".era-drawer")).not.toBeVisible();

    // Mobile viewport
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".send")).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 900 });

    // Send a normal message
    await send(page, "同学，今天天气还行。");
    await expect(page.locator(".msg.world .body, .msg.notice .body").last()).not.toHaveText("");

    // Second message
    await send(page, "我回家了。");

    // State drawer shows location
    await page.getByTitle("当前状态").click();
    await expect(page.locator(".drawer")).toBeVisible();
    await page.getByRole("button", { name: "关闭" }).click();

    // Reload / resume — messages should persist
    await page.reload();
    await expect(page.locator(".top")).toBeVisible({ timeout: 10_000 });
    const msgCount = await page.locator(".msg").count();
    expect(msgCount).toBeGreaterThanOrEqual(3); // opening + 2 turns (player+world each)

    // Fail-closed: garbled input
    await send(page, "%%%NOT_A_SCENE%%% [[[");
    await expect(page.locator("body")).not.toContainText("expectedRevision");
    const notice = page.locator(".msg.notice .body");
    if (await notice.count()) {
      await expect(notice.last()).toContainText("没有被可靠理解");
    }
  });

  test("P1 safe new save: confirmation on existing save, cancel retains state, confirm resets to onboarding", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await startFreshSession(page);

    // Send one message to create a save
    await send(page, "我先在这里休息一下。");
    const initialMsgCount = await page.locator(".msg").count();
    expect(initialMsgCount).toBeGreaterThan(0);

    // Open world panel
    await page.getByTitle("世界").click();
    await expect(page.locator(".sheet")).toBeVisible();

    // Click "新人生" on the current world (it now has a save → should prompt)
    const worldRow = page.locator(".world-row").filter({ hasText: "当前" });
    await worldRow.getByRole("button", { name: "新人生" }).click();

    // Confirmation dialog
    const dialog = page.locator(".dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("这个世界已经有存档");

    // Cancel → state preserved
    await dialog.getByRole("button", { name: "取消" }).click();
    await expect(dialog).not.toBeVisible();
    const msgCountAfterCancel = await page.locator(".msg").count();
    expect(msgCountAfterCancel).toBe(initialMsgCount);

    // Open again and confirm
    await page.getByTitle("世界").click();
    await expect(page.locator(".sheet")).toBeVisible();
    await worldRow.getByRole("button", { name: "新人生" }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "保留旧档并新开" }).click();

    // Should land on onboarding screen
    await expect(page.locator(".onboard-title")).toBeVisible({ timeout: 10_000 });
  });
});
