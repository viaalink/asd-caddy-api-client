/**
 * Locators and moves for the code-server workbench, as the storyboard uses them.
 *
 * Kept separate from tests/fixtures.ts on purpose: those helpers are built for
 * speed (fill(), instant keypresses); these are built for the camera (glide,
 * click, type at a human pace, show the shortcut). They share selectors only.
 */

import { expect, type Locator, type Page } from "@playwright/test";
import { click, key, press, type } from "./actions";

// ---------------------------------------------------------------- locators

export const explorerItem = (page: Page, name: string): Locator =>
  page.locator(`.explorer-folders-view .monaco-list-row[aria-label="${name}"]`);

export const activeEditor = (page: Page): Locator =>
  page.locator(".editor-group-container.active .monaco-editor").first();

/** A rendered editor line containing `text`. */
export const editorLine = (page: Page, text: string | RegExp): Locator =>
  activeEditor(page).locator(".view-line", { hasText: text }).first();

/** Every syntax token whose whole text is exactly `text` (e.g. `"reverse_proxy"`). */
export const tokens = (page: Page, text: string): Locator =>
  activeEditor(page)
    .locator(".view-line span span")
    .filter({ hasText: new RegExp(`^${escape(text)}$`) });

/** The first such token. */
export const token = (page: Page, text: string): Locator => tokens(page, text).first();

export const suggestWidget = (page: Page): Locator => page.locator(".suggest-widget.visible");

/** A row of the suggest list by its exact label, optionally by its detail text too. */
export function suggestRow(page: Page, label: string, detail?: string): Locator {
  let rows = suggestWidget(page)
    .locator(".monaco-list-row")
    .filter({ has: page.locator(".label-name", { hasText: new RegExp(`^${escape(label)}$`) }) });
  if (detail) rows = rows.filter({ hasText: detail });
  return rows.first();
}

export const hoverWidget = (page: Page): Locator =>
  page.locator(".monaco-hover:not(.hidden)").filter({ hasText: /\S/ }).first();

export const codeLens = (page: Page, text: string): Locator =>
  activeEditor(page).locator(".codelens-decoration", { hasText: text }).first();

export const quickInput = (page: Page): Locator => page.locator(".quick-input-widget:visible");

export const quickInputRow = (page: Page, text: string): Locator =>
  quickInput(page).locator(".monaco-list-row", { hasText: text }).first();

export const problemsRow = (page: Page, text: string): Locator =>
  page.locator(".markers-panel .monaco-list-row", { hasText: text }).first();

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------- moves

/** Load the workbench and wait until the explorer has the seeded files. */
export async function openWorkbench(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.locator(".monaco-workbench").waitFor({ timeout: 60000 });
  await explorerItem(page, "app.caddy.json").waitFor({ timeout: 60000 });
}

/** Run a command palette command by (part of) its title. */
export async function runCommand(
  page: Page,
  title: string,
  opts: { show?: boolean } = {}
): Promise<void> {
  const show = opts.show ?? true;
  if (show) await press(page, "Control+Shift+P");
  else await key(page, "Control+Shift+P");
  const input = quickInput(page).locator("input").first();
  await input.waitFor({ timeout: 10000 });
  if (show) await type(page, title);
  else await page.keyboard.type(title);
  await quickInputRow(page, title).waitFor({ timeout: 10000 });
  if (show) await page.waitForTimeout(350);
  await key(page, "Enter");
}

/** Click a file in the explorer and wait for its editor to have focus. */
export async function openFile(page: Page, name: string): Promise<void> {
  // A double click opens the file AND moves keyboard focus into the editor;
  // a single click leaves focus in the explorer.
  await click(page, explorerItem(page, name), { double: true });
  await expect(page.locator(".tabs-container .tab.active", { hasText: name })).toBeVisible({
    timeout: 10000,
  });
  await expect(activeEditor(page).locator("textarea, .native-edit-context").first()).toBeFocused({
    timeout: 10000,
  });
  await page.waitForTimeout(250);
}

/** Put the caret at the end of a 1-based line, without the mouse. */
export async function caretToLineEnd(page: Page, line: number): Promise<void> {
  await key(page, "Control+Home");
  await key(page, "ArrowDown", line - 1);
  await key(page, "End");
}

/** Wait for the suggest list to show a row, then click it like a person would. */
export async function pickSuggestion(page: Page, label: string, detail?: string): Promise<void> {
  const row = suggestRow(page, label, detail);
  await row.waitFor({ timeout: 10000 });
  await page.waitForTimeout(250);
  await click(page, row, { at: [0.25, 0.5] });
  await expect(suggestWidget(page)).toBeHidden({ timeout: 5000 });
}

/**
 * Tab to the next snippet placeholder until the selection is `length` long
 * (read off the status bar), at most `max` presses. Snippet placeholder order
 * after a choice is accepted differs between VS Code versions; this does not care.
 */
export async function tabToPlaceholder(page: Page, length: number, max = 3): Promise<void> {
  const status = page.locator(".statusbar");
  for (let i = 0; i < max; i++) {
    await press(page, "Tab");
    await page.waitForTimeout(250);
    if ((await status.innerText()).includes(`(${length} selected)`)) return;
  }
  throw new Error(`no snippet placeholder of length ${length} after ${max} Tabs`);
}

/** A quick pick row by its exact label (ignoring codicons), not by any text in it. */
export const quickPickItem = (page: Page, label: string): Locator =>
  quickInput(page)
    .locator(".monaco-list-row")
    .filter({
      has: page.locator(".label-name", { hasText: new RegExp(`^\\s*${escape(label)}\\s*$`) }),
    })
    .first();

/**
 * Walk the suggest list with the arrow keys until the focused row (which is
 * the one that shows its detail text) contains `detail`, then accept it with
 * Enter. For lists where two providers offer the same label — e.g. the
 * extension's builder completion and TypeScript's own auto-import entry.
 */
export async function acceptSuggestionWithDetail(
  page: Page,
  detail: string,
  max = 12
): Promise<void> {
  const focused = suggestWidget(page).locator(".monaco-list-row.focused");
  for (let attempt = 0; attempt < 2; attempt++) {
    for (let i = 0; i < max; i++) {
      await focused.waitFor({ timeout: 5000 });
      if ((await focused.innerText()).includes(detail)) {
        await page.waitForTimeout(500);
        await press(page, "Enter");
        return;
      }
      await key(page, "ArrowDown");
      await page.waitForTimeout(150);
    }
    // A slow provider can miss the first query; ask again.
    await key(page, "Escape");
    await press(page, "Control+Space");
    await suggestWidget(page).waitFor({ timeout: 10000 });
    await page.waitForTimeout(600);
  }
  throw new Error(`no suggestion with "${detail}" in the first ${max} rows`);
}
