import { defineConfig } from "@playwright/test";

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
    reuseExistingServer: !process.env.CI,
    env: {
      DWE_PLAY_STUB: "1",
      DWE_HTTP_PORT: "8787",
    },
  },
});
