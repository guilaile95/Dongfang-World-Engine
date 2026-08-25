import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { defineConfig } from "@playwright/test";

// Each Playwright run gets its own isolated temp dir so it never touches data/local.
const E2E_PLAY_DIR = join(tmpdir(), `dwe-e2e-${randomBytes(6).toString("hex")}`);

export default defineConfig({
  testDir: "web/e2e",
  timeout: 240_000,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:8787",
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === "win32" && !process.env.CI ? "msedge" : undefined),
  },
  webServer: {
    command: "node dist/http/server.js",
    url: "http://127.0.0.1:8787/api/health",
    reuseExistingServer: false,
    env: {
      DWE_PLAY_STUB: "1",
      DWE_HTTP_PORT: "8787",
      DWE_PLAY_DIR: E2E_PLAY_DIR,
    },
  },
});
