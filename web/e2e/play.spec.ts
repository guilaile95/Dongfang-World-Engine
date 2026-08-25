import { expect, test, type Page } from "@playwright/test";

async function send(page: Page, text: string): Promise<void> {
  await page.locator("textarea").fill(text);
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.locator(".status-line")).toHaveText("正在书写…");
  await expect(page.locator(".status-line")).not.toHaveText("正在书写…", { timeout: 120_000 });
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

    await send(page, "我走进宿舍。");
    await send(page, "我把书包放在桌上。");
    await send(page, "我回到街上。");
    await send(page, "我把书包背起来。");
    await expect(page.locator(".msg").last()).not.toContainText("肩带");
    await page.getByRole("button", { name: "状态" }).click();
    await expect(page.locator(".drawer")).not.toContainText("书包");
    await page.getByRole("button", { name: "关闭" }).click();

    await send(page, "我走进宿舍。");
    await send(page, "我重新背上书包。");
    await page.getByRole("button", { name: "状态" }).click();
    await expect(page.locator(".drawer")).toContainText("书包");
    await page.getByRole("button", { name: "关闭" }).click();

    await page.reload();
    await page.getByRole("button", { name: "状态" }).click();
    await expect(page.locator(".drawer")).toContainText("书包");
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
      await expect(page.locator(".who")).toContainText("临河客栈", { timeout: 60_000 });
    }
  });
});
