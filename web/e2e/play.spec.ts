import { expect, test, type Page } from "@playwright/test";

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

  // Chat screen ready
  await expect(page.locator("textarea")).toBeEnabled({ timeout: 60_000 });
}

test.describe("chat-first shell", () => {
  test("data isolation: E2E run does not use data/local", () => {
    // Playwright server uses DWE_PLAY_DIR from playwright.config.ts which is an OS tmp dir.
    // This test is a documentation stub — the actual guard is in playwright.config.ts.
    expect(process.env.DWE_PLAY_DIR ?? "").not.toContain("data/local");
  });

  test("desktop: onboarding → chat → streaming → fail-closed stays human", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await startFreshSession(page);

    // Verify no Engine internals leaked in initial output
    await expect(page.locator("body")).not.toContainText("expectedRevision");
    await expect(page.locator("body")).not.toContainText("当前状态（权威）");
    await expect(page.locator("body")).not.toContainText("最近场景（非权威");
    await expect(page.locator("body")).not.toContainText("Candidate");

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
    await expect(page.locator(".drawer")).toContainText("家");
    await page.getByRole("button", { name: "关闭" }).click();

    // Reload / resume — messages should persist
    await page.reload();
    await expect(page.locator(".top")).toBeVisible({ timeout: 10_000 });
    // After reload from a save, we should be back in chat with history
    const msgCount = await page.locator(".msg").count();
    expect(msgCount).toBeGreaterThan(0);

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
