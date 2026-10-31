import { defineConfig } from "@playwright/test";

/**
 * The demo recorder. Deliberately its own config, so `just vscode-test`
 * (playwright.config.ts → ./tests) never picks it up and this never picks up
 * the tests. Run through `just vscode-demo-video`, not directly.
 */
export default defineConfig({
  testDir: ".",
  testMatch: /record\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 15 * 60 * 1000,
  outputDir: "../local/video/test-results",
  use: {
    headless: true,
    trace: "off",
    screenshot: "only-on-failure",
  },
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
});
