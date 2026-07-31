import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/observe",
  testMatch: "browser.spec.ts",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  use: {
    browserName: "chromium",
    headless: true,
    trace: "retain-on-failure",
  },
  reporter: "line",
});
