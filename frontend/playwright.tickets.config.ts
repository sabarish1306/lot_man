import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests", testMatch: "tickets.spec.ts", workers: 1,
  timeout: 60_000, expect: { timeout: 10_000 }, reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5174", browserName: "chromium",
    channel: process.env.PLAYWRIGHT_CHANNEL || "msedge",
    timezoneId: "America/Los_Angeles", viewport: {width: 1440, height: 1000},
    screenshot: "only-on-failure", trace: "retain-on-failure",
  },
  webServer: [
    {command: `${process.env.PYTHON || (process.platform === "win32" ? ".\\paddle-env\\Scripts\\python.exe" : "python3")} -m tests.ticket_ui_server`, cwd: "..", url: "http://127.0.0.1:8011/openapi.json", reuseExistingServer: false},
    {command: "npm run dev -- --port 5174", env: {MANI_API_TARGET: "http://127.0.0.1:8011"}, url: "http://127.0.0.1:5174", reuseExistingServer: false},
  ],
});
