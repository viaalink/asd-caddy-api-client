/**
 * UI tests for the 0.3.0 features: status bar, Caddy lint + quick fixes,
 * "Did you mean" on schema errors, and the New Config File command.
 */
import {
  test,
  expect,
  openFile,
  waitForEditor,
  handleTrustDialog,
  closeNotifications,
  closeAllEditors,
  openCommandPalette,
} from "./fixtures";
import type { Page } from "@playwright/test";

async function setup(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForSelector(".monaco-workbench", { timeout: 30000 });
  await handleTrustDialog(page);
  await closeNotifications(page);
  await closeAllEditors(page);
}

/** Put the cursor inside the first occurrence of `text` in the active editor. */
async function placeCursorOn(page: Page, text: string): Promise<void> {
  const span = page.locator(".monaco-editor .view-lines span", { hasText: text }).first();
  await span.waitFor({ state: "visible", timeout: 10000 });
  await span.click();
}

async function openQuickFix(page: Page): Promise<void> {
  await page.keyboard.press("Control+.");
  await page.locator(".action-widget").waitFor({ state: "visible", timeout: 10000 });
}

test.describe("0.3.0 features", () => {
  test.beforeEach(async ({ page, codeServerUrl }) => {
    await setup(page, codeServerUrl);
  });

  test.afterEach(async ({ page }) => {
    await page.keyboard.press("Escape");
    await closeAllEditors(page);
  });

  test("status bar shows the config kind for a Caddy file", async ({ page }) => {
    await openFile(page, "valid.caddy.json");
    await waitForEditor(page);
    // VS Code prefixes the item id with the extension id, so match by text.
    const item = page.locator(".statusbar-item", { hasText: "Caddy Route" });
    await expect(item).toBeVisible({ timeout: 15000 });
    await expect(item).not.toContainText(":"); // no findings count on a valid file
  });

  test("dial written as a URL: caddy error + quick fix rewrites it to host:port", async ({
    page,
  }) => {
    await openFile(page, "quickfix.caddy.json");
    await waitForEditor(page);
    await expect(page.locator(".squiggly-error").first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator(".statusbar-item", { hasText: "Caddy Route: 1" })).toBeVisible();

    await placeCursorOn(page, "http://localhost:3000");
    await openQuickFix(page);
    const fix = page.locator('.action-widget [role="option"]', {
      hasText: 'Change to "localhost:3000"',
    });
    await expect(fix).toBeVisible();
    // It's the preferred (first, focused) action; the widget swallows pointer clicks in code-server.
    await page.keyboard.press("Enter");

    await expect(page.locator(".view-lines")).toContainText('"dial": "localhost:3000"');
    // Revert so the fixture stays broken for the next run.
    await page.keyboard.press("Control+z");
  });

  test('schema typo gets a "Did you mean" quick fix', async ({ page }) => {
    await openFile(page, "invalid-unknown-field.caddy.json");
    await waitForEditor(page);
    await expect(page.locator(".squiggly-warning, .squiggly-error").first()).toBeVisible({
      timeout: 15000,
    });

    await placeCursorOn(page, "termnal");
    await openQuickFix(page);
    await expect(
      page.locator('.action-widget [role="option"]', { hasText: 'Did you mean "terminal"?' })
    ).toBeVisible();
  });

  test("New Config File offers the three config kinds", async ({ page }) => {
    await openCommandPalette(page);
    await page.keyboard.type("Caddy: New Config File");
    await page
      .locator('.quick-input-list [role="option"]', { hasText: "New Config File" })
      .first()
      .click();
    const options = page.locator('.quick-input-list [role="option"]');
    await expect(options.filter({ hasText: "Full Caddy config" })).toBeVisible({ timeout: 10000 });
    await expect(options.filter({ hasText: "<name>.caddy.json" })).toBeVisible();
    await expect(options.filter({ hasText: "caddy-security config" })).toBeVisible();
  });
});
