import { expect, test, type Page } from "@playwright/test";

async function send(page: Page, text: string): Promise<void> {
  await page.locator("textarea").fill(text);
  const prevCount = await page.locator(".msg").count();
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.locator(".msg")).toHaveCount(prevCount + 2, { timeout: 120_000 });
  await expect(page.locator(".msg .body").last()).not.toHaveText("", { timeout: 120_000 });
  await expect(page.locator(".status-line")).not.toHaveText("正在书写…", { timeout: 120_000 });
  await expect(page.locator("textarea")).toBeEnabled({ timeout: 120_000 });
}

test.describe("chat-first shell", () => {
  test("desktop chat streams and fail-closed stays human", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await expect(page.locator(".top")).toBeVisible();
    await expect(page.locator("textarea")).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.locator("textarea")).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".send")).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator("body")).not.toContainText("expectedRevision");
    await expect(page.locator("body")).not.toContainText("fact_assert");
    await expect(page.locator("body")).not.toContainText("Candidate");

    await page.getByRole("button", { name: "世界" }).click();
    const longzu = page.locator(".world-row").filter({ hasText: "龙族" });
    if (await longzu.count()) {
      await longzu.getByRole("button", { name: "新开" }).click();
      const confirmBtn = page.getByRole("button", { name: "保留旧档并新开" });
      if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await confirmBtn.click();
      }
    } else {
      await page.locator(".overlay").click({ position: { x: 10, y: 10 } });
    }
    await expect(page.locator(".overlay")).toHaveCount(0, { timeout: 60_000 });
    await expect(page.locator("textarea")).toBeEnabled({ timeout: 60_000 });
    await expect(page.locator(".status-line")).not.toHaveText("正在书写…");

    await send(page, "同学，今天天气还行。");
    await expect(page.locator(".msg.world .body, .msg.notice .body").last()).not.toHaveText("");

    await send(page, "同学，你记住：晚上我可能不回宿舍。");
    await send(page, "我回家了。");
    await page.getByRole("button", { name: "状态" }).click();
    await expect(page.locator(".drawer")).toContainText("家");
    await page.getByRole("button", { name: "关闭" }).click();

    await page.reload();
    await page.getByRole("button", { name: "状态" }).click();
    await expect(page.locator(".drawer")).toContainText("家");
    await page.getByRole("button", { name: "关闭" }).click();

    await send(page, "%%%NOT_A_SCENE%%% [[[");
    await expect(page.locator("body")).not.toContainText("Zod");
    await expect(page.locator("body")).not.toContainText("expectedRevision");
    const notice = page.locator(".msg.notice .body");
    if (await notice.count()) {
      await expect(notice.last()).toContainText("没有被可靠理解");
    }

    await page.getByRole("button", { name: "世界" }).click();
    const inn = page.locator(".world-row").filter({ hasText: "临河客栈" });
    if (await inn.count()) {
      await inn.getByRole("button", { name: "新开" }).click();
      const confirmBtn = page.getByRole("button", { name: "保留旧档并新开" });
      if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await confirmBtn.click();
      }
      await expect(page.locator(".who")).toContainText("临河客栈", { timeout: 60_000 });
    }
  });

  test("P1 safe new save: confirmation prompt on existing save, cancel retains state, confirm resets to clean state", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".top")).toBeVisible();
    await expect(page.locator("textarea")).toBeVisible();

    await send(page, "我先在这里休息一下。");
    await expect(page.locator(".msg").last()).toBeVisible();
    const initialMsgCount = await page.locator(".msg").count();
    expect(initialMsgCount).toBeGreaterThan(0);

    await page.getByRole("button", { name: "世界" }).click();
    await expect(page.locator(".sheet")).toBeVisible();

    const activeWorldRow = page.locator(".world-row").filter({ hasText: "当前" });
    await activeWorldRow.getByRole("button", { name: "新开" }).click();

    const dialog = page.locator(".dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("这个世界已经有存档");
    await expect(dialog).toContainText("新开会从头开始，现有存档将先保留为备份");

    await dialog.getByRole("button", { name: "取消" }).click();
    await expect(dialog).not.toBeVisible();

    const msgCountAfterCancel = await page.locator(".msg").count();
    expect(msgCountAfterCancel).toBe(initialMsgCount);

    if (!(await page.locator(".sheet").isVisible())) {
      await page.getByRole("button", { name: "世界" }).click();
    }
    await expect(page.locator(".sheet")).toBeVisible();
    await activeWorldRow.getByRole("button", { name: "新开" }).click();
    await expect(dialog).toBeVisible();

    await dialog.getByRole("button", { name: "保留旧档并新开" }).click();
    await expect(dialog).not.toBeVisible();

    await expect(page.locator(".msg")).toHaveCount(0);
    await expect(page.locator(".empty")).toBeVisible();
  });
});
