import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { defineConfig } from "@playwright/test";

// Each Playwright run gets its own isolated temp dir so it never touches data/local.
const E2E_PLAY_DIR = join(tmpdir(), `dwe-e2e-${randomBytes(6).toString("hex")}`);
const E2E_PORT = Number.parseInt(process.env.DWE_E2E_PORT ?? "8787", 10);

export default defineConfig({
  testDir: "web/e2e",
  timeout: 240_000,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === "win32" && !process.env.CI ? "msedge" : undefined),
  },
  webServer: {
    command: "node dist/http/server.js",
    url: `http://127.0.0.1:${E2E_PORT}/api/health`,
    reuseExistingServer: false,
    env: {
      DWE_PLAY_STUB: "1",
      DWE_LLM_BASE_URL: "http://127.0.0.1:9",
      DWE_LLM_API_KEY: "playwright-stub",
      DWE_LLM_MODEL: "stub",
      DWE_HTTP_PORT: String(E2E_PORT),
      DWE_PLAY_DIR: E2E_PLAY_DIR,
    },
  },
});
