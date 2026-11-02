/**
 * Playwright fixtures for code-server extension testing.
 *
 * The workbench is loaded ONCE per worker (`workbench`, worker-scoped) and
 * shared by every test in that worker; the test-scoped `page` fixture hands
 * out that shared page after resetting it to a clean state (no editors, no
 * quick input, no notifications, no panel, explorer visible). Loading the
 * workbench takes several seconds, so paying it once instead of per test is
 * most of this suite's wall time.
 *
 * Any spec file can reuse this by importing `test`/`expect` from here:
 *
 *   import { test, expect, openFile } from "./fixtures";
 *   test("my provider", async ({ page, scratchFile }) => { ... });
 *
 * Tests stay independent in outcome: every test starts from the reset state,
 * and anything a test writes to disk goes through `scratchFile`, which
 * deletes it afterwards. The workspace code-server serves is a throwaway
 * copy of tests/test-files/ (see global-setup.ts), so fixtures in git are
 * never modified.
 */

import { test as base, expect, type Locator, type Page } from "@playwright/test";
import { parse as parseJsonc, printParseErrorCode, type ParseError } from "jsonc-parser";
import * as path from "path";
import * as fs from "fs";

export { expect };

export const PORT_FILE = path.join(__dirname, ".codeserver-port");
export const WORKSPACE_FILE = path.join(__dirname, ".codeserver-workspace");

/** The extension's diagnostics debounce (src/providers/diagnostics.ts DEBOUNCE_MS) plus margin. */
export const DIAGNOSTICS_SETTLE_MS = 1200;

export interface Workbench {
  page: Page;
  url: string;
  /** Every console message the workbench page logged since it loaded. */
  consoleMessages: string[];
}

export type ScratchFileFactory = (name: string, content?: string) => Promise<string>;

interface WorkerFixtures {
  codeServerUrl: string;
  /** Absolute path of the workspace folder code-server has open. */
  workspaceDir: string;
  workbench: Workbench;
}

interface TestFixtures {
  /** Every console message logged by the shared workbench page. */
  consoleMessages: string[];
  /**
   * Create a file in the workspace (deleted after the test) and return its
   * basename. Name it to match the schema you want active, e.g.
   * `foo.caddy.json` for the route schema.
   */
  scratchFile: ScratchFileFactory;
}

function readSetupFile(file: string, what: string): string {
  if (!fs.existsSync(file)) {
    throw new Error(`code-server ${what} file not found (${file}). Did global setup run?`);
  }
  return fs.readFileSync(file, "utf-8").trim();
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  codeServerUrl: [
    async ({}, use) => {
      await use(`http://127.0.0.1:${readSetupFile(PORT_FILE, "port")}`);
    },
    { scope: "worker" },
  ],

  workspaceDir: [
    async ({}, use) => {
      await use(readSetupFile(WORKSPACE_FILE, "workspace"));
    },
    { scope: "worker" },
  ],

  workbench: [
    async ({ browser, codeServerUrl, workspaceDir }, use) => {
      const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
      const page = await context.newPage();
      const consoleMessages: string[] = [];
      page.on("console", (msg) => consoleMessages.push(msg.text()));
      // Name the folder explicitly: code-server otherwise reopens the folder it
      // remembers from an earlier run instead of this run's workspace copy.
      const url = `${codeServerUrl}/?folder=${encodeURIComponent(workspaceDir)}`;
      await loadWorkbench(page, url);
      await use({ page, url, consoleMessages });
      await context.close();
    },
    { scope: "worker" },
  ],

  page: async ({ workbench }, use) => {
    await resetWorkbench(workbench);
    await use(workbench.page);
  },

  consoleMessages: async ({ workbench }, use) => {
    await use(workbench.consoleMessages);
  },

  scratchFile: async ({ page, workspaceDir }, use) => {
    const created: string[] = [];
    await use(async (name, content = "") => {
      const file = path.join(workspaceDir, name);
      fs.writeFileSync(file, content);
      created.push(file);
      return name;
    });
    // Close editors first so deleting the file can't leave a "(deleted)" tab behind.
    await closeAllEditors(page);
    for (const file of created) fs.rmSync(file, { force: true });
  },
});

// ============================================================================
// Workbench lifecycle
// ============================================================================

async function loadWorkbench(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForSelector(".monaco-workbench", { timeout: 30000 });
  // The explorer tree rendering the workspace is the "ready to use" signal.
  await page.locator(".explorer-folders-view .monaco-list-row").first().waitFor({ timeout: 30000 });
  await handleTrustDialog(page);
  await closeNotifications(page);
}

/** Bring the shared workbench back to a clean state between tests. */
export async function resetWorkbench(workbench: Workbench): Promise<void> {
  const { page, url } = workbench;
  const alive =
    !page.isClosed() &&
    (await page
      .locator(".monaco-workbench")
      .isVisible()
      .catch(() => false));
  if (!alive) {
    await loadWorkbench(page, url);
    return;
  }

  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await closeAllEditors(page);
  await closeNotifications(page);

  // Close the bottom panel (Problems/Output) if a test opened it.
  if (await page.locator(".part.panel").isVisible()) {
    await page.keyboard.press("Control+j");
    await page.locator(".part.panel").waitFor({ state: "hidden", timeout: 3000 });
  }

  // Back to the explorer if a test switched the sidebar (e.g. Extensions view).
  if (!(await page.locator(".explorer-folders-view").isVisible())) {
    await page.keyboard.press("Control+Shift+e");
    await page.locator(".explorer-folders-view").waitFor({ timeout: 5000 });
  }
}

/**
 * Helper to dismiss the workspace trust dialog if present
 */
export async function handleTrustDialog(page: Page): Promise<void> {
  // Trust is disabled in settings (global-setup.ts); this is a safety net.
  const trustButton = page.locator('button:has-text("Yes, I trust the authors")');
  if (await trustButton.isVisible({ timeout: 1000 }).catch(() => false)) {
    await trustButton.click();
    await trustButton.waitFor({ state: "hidden", timeout: 2000 }).catch(() => {});
  }
}

/**
 * Helper to close any notification toasts
 */
export async function closeNotifications(page: Page): Promise<void> {
  const toasts = page.locator(".notifications-toasts .notification-toast");
  const closeButtons = page.locator(".notification-toast .codicon-notifications-clear");
  for (let i = 0; i < 10 && (await toasts.count()) > 0; i++) {
    const button = closeButtons.first();
    if (!(await button.isVisible().catch(() => false))) {
      // The clear button only renders on hover.
      await toasts
        .first()
        .hover()
        .catch(() => {});
    }
    await button.click({ timeout: 1000 }).catch(() => {});
  }
}

/**
 * Helper to dismiss any modal dialogs (save dialogs, etc.)
 */
async function dismissDialogs(page: Page): Promise<void> {
  const modalBlock = page.locator(".monaco-dialog-modal-block");
  if (await modalBlock.isVisible().catch(() => false)) {
    // Dialog buttons are <a role="button">, not <button>.
    const dontSaveButton = page
      .locator(".monaco-dialog-box")
      .getByRole("button", { name: "Don't Save", exact: true });
    if (await dontSaveButton.isVisible().catch(() => false)) {
      await dontSaveButton.click();
    } else {
      await page.keyboard.press("Escape");
    }
    await modalBlock.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
  }
}

/**
 * Close all editors, answering "Don't Save" for dirty ones.
 */
export async function closeAllEditors(page: Page): Promise<void> {
  await dismissDialogs(page);
  const tabs = page.locator('.tabs-container [role="tab"]');
  const modalBlock = page.locator(".monaco-dialog-modal-block");
  for (let attempt = 0; attempt < 5 && (await tabs.count()) > 0; attempt++) {
    await page.keyboard.press("Escape");
    // workbench.action.closeAllEditors
    await page.keyboard.press("Control+k");
    await page.keyboard.press("Control+w");
    await Promise.race([
      modalBlock.waitFor({ state: "visible", timeout: 2000 }),
      expect(tabs).toHaveCount(0, { timeout: 2000 }),
    ]).catch(() => {});
    await dismissDialogs(page);
  }
  await expect(tabs).toHaveCount(0, { timeout: 5000 });
}

// ============================================================================
// Editor helpers
// ============================================================================

/**
 * Wait for the active Monaco editor to be ready for input.
 */
export async function waitForEditor(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const editor = document.querySelector(".editor-instance .monaco-editor");
      return editor !== null && editor.querySelector(".cursor") !== null;
    },
    undefined,
    { timeout: 30000 }
  );
}

/**
 * Open a workspace file by name and wait until its tab is active and the
 * editor ready. Goes through File > Open File (Ctrl+O), whose simple dialog
 * reads the disk directly -- Quick Open (Ctrl+P) misses just-created scratch
 * files (stale search cache) and ranks "recently opened" fuzzy matches
 * (invalid.caddy.json for "valid.caddy.json") above exact ones.
 */
export async function openFile(page: Page, filename: string): Promise<void> {
  const workspaceDir = readSetupFile(WORKSPACE_FILE, "workspace");
  await dismissDialogs(page);
  await page.keyboard.press("Control+o");
  const dialog = quickInputTitled(page, "Open File");
  await dialog.waitFor({ state: "visible", timeout: 5000 });
  const input = dialog.locator(".quick-input-box input");
  // The dialog sets its value to the current folder once it has listed it;
  // filling before that gets overwritten.
  await expect(input).toHaveValue(/\/$/, { timeout: 5000 });
  await expect(dialog.locator('[role="option"]').first()).toBeVisible({ timeout: 5000 });
  const target = path.join(workspaceDir, filename);
  await input.fill(target);
  await expect(input).toHaveValue(target);
  await input.press("Enter");
  await expect(page.locator(".tabs-container .tab.active .label-name")).toHaveText(filename, {
    timeout: 10000,
  });
  await waitForEditor(page);
  await focusEditor(page);
}

/** Give keyboard focus to the active editor (workbench.action.focusFirstEditorGroup). */
export async function focusEditor(page: Page): Promise<void> {
  await page.keyboard.press("Control+1");
  await expect(page.locator(".editor-instance .monaco-editor.focused")).toHaveCount(1, {
    timeout: 5000,
  });
}

/** Open a new untitled editor with the JSON language mode. */
export async function newUntitledJson(page: Page): Promise<void> {
  await page.keyboard.press("Control+n");
  await waitForEditor(page);
  await page.keyboard.press("Control+k");
  await page.keyboard.press("m");
  const langInput = page.locator(".quick-input-widget .quick-input-box input");
  await langInput.waitFor({ state: "visible", timeout: 5000 });
  await langInput.fill("JSON");
  await page
    .locator('.quick-input-widget [role="option"][aria-label^="JSON"]')
    .first()
    .waitFor({ timeout: 5000 });
  await page.keyboard.press("Enter");
  await expect(page.locator("#status\\.editor\\.mode")).toContainText("JSON", { timeout: 5000 });
}

/** Move the cursor to `line` (1-based) via Go to Line, then to the line's end. */
export async function goToLineEnd(page: Page, line: number): Promise<void> {
  await page.keyboard.press("Control+g");
  const input = page.locator(".quick-input-widget .quick-input-box input");
  await input.waitFor({ state: "visible", timeout: 5000 });
  await input.fill(`:${line}`);
  await page.keyboard.press("Enter");
  await input.waitFor({ state: "hidden", timeout: 5000 });
  await expect(page.locator(".editor-instance .monaco-editor.focused")).toHaveCount(1);
  await page.keyboard.press("End");
}

/** The suggest widget, once it is showing. */
export function suggestWidget(page: Page): Locator {
  return page.locator(".editor-widget.suggest-widget.visible");
}

/** Suggest rows whose label is exactly `label`. */
export function suggestItem(page: Page, label: string): Locator {
  return suggestWidget(page)
    .locator(".monaco-list-row")
    .filter({ has: page.locator(".label-name", { hasText: new RegExp(`^${escapeRe(label)}$`) }) });
}

/**
 * Trigger completion (Ctrl+Space) and wait for the suggest widget to show
 * at least one real row (not the "Loading..." / "No suggestions" message).
 */
export async function triggerCompletion(page: Page): Promise<void> {
  // A Ctrl+Space that lands while focus is still returning from a quick
  // input (e.g. Go to Line) is dropped, so retry until the widget shows.
  await expect(async () => {
    if (!(await suggestWidget(page).isVisible())) await page.keyboard.press("Control+Space");
    await suggestWidget(page).locator(".monaco-list-row").first().waitFor({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
}

/**
 * Labels of every item in the open suggest widget. The list is virtualized
 * (only ~12 rows exist in the DOM), so this pages through it with PageDown
 * until the selection reaches the last item (it moves the selection, nothing else).
 */
export async function suggestLabels(page: Page): Promise<string[]> {
  const labels = new Set<string>();
  const rows = suggestWidget(page).locator(".monaco-list-row");
  const focused = suggestWidget(page).locator(".monaco-list-row.focused");
  for (let i = 0; i < 50; i++) {
    for (const label of await rows.locator(".label-name").allTextContents()) labels.add(label);
    const pos = await focused.getAttribute("aria-posinset").catch(() => null);
    const size = await focused.getAttribute("aria-setsize").catch(() => null);
    if (pos === null || pos === size) break;
    await page.keyboard.press("PageDown");
    await expect(focused).not.toHaveAttribute("aria-posinset", pos);
  }
  return [...labels];
}

/**
 * Save the active editor: waits for it to be dirty first (edits from
 * commands/snippets apply asynchronously -- saving before they land would
 * save the old content), then for the dirty marker to clear.
 */
export async function saveActiveEditor(page: Page): Promise<void> {
  await expect(page.locator(".tabs-container .tab.active.dirty")).toHaveCount(1, {
    timeout: 5000,
  });
  await page.keyboard.press("Control+s");
  await expect(page.locator(".tabs-container .tab.active.dirty")).toHaveCount(0, {
    timeout: 5000,
  });
}

/**
 * Parse `text` with jsonc-parser in strict-JSON mode and fail with the
 * parser's error codes (and the text) if it isn't valid JSON.
 */
export function expectValidJson(text: string): unknown {
  const errors: ParseError[] = [];
  const value: unknown = parseJsonc(text, errors, {
    allowTrailingComma: false,
    disallowComments: true,
  });
  const described = errors.map((e) => `${printParseErrorCode(e.error)} at offset ${e.offset}`);
  expect(described, `buffer is not valid JSON:\n${text}`).toEqual([]);
  return value;
}

/** Read a workspace file from disk. */
export function readWorkspaceFile(workspaceDir: string, name: string): string {
  return fs.readFileSync(path.join(workspaceDir, name), "utf-8");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ============================================================================
// Problems panel
// ============================================================================

/** Open (focus) the Problems panel and return the locator of its marker rows. */
export async function openProblems(page: Page): Promise<Locator> {
  await page.keyboard.press("Control+Shift+m");
  const panel = page.locator(".markers-panel");
  await panel.waitFor({ state: "visible", timeout: 5000 });
  return panel.locator(".monaco-list-row");
}

/**
 * Problems-panel marker rows (one per diagnostic, file header rows excluded)
 * from any source: VS Code's JSON language service validating against the
 * schemas this extension contributes (`jsonValidation`), and the extension's
 * own diagnostics provider.
 */
export async function problemRows(page: Page): Promise<Locator> {
  const rows = await openProblems(page);
  return rows.filter({ has: page.locator(".marker-message") });
}

/**
 * Problems-panel marker rows reported by this extension's own diagnostics
 * provider (diagnostic source "caddy", rendered in `.marker-source`).
 */
export async function caddyProblemRows(page: Page): Promise<Locator> {
  const rows = await openProblems(page);
  return rows.filter({ has: page.locator(".marker-source", { hasText: /^caddy/ }) });
}

// ============================================================================
// Command palette and quick input
// ============================================================================

/**
 * Helper to open command palette
 */
export async function openCommandPalette(page: Page): Promise<void> {
  await page.keyboard.press("F1");
  await page.locator(".quick-input-widget .quick-input-box input").waitFor({ timeout: 5000 });
}

/**
 * Run a command by its exact palette title (e.g. "Caddy: Insert Route
 * Configuration"); fails if the command isn't listed.
 */
export async function runCommand(page: Page, title: string): Promise<void> {
  await openCommandPalette(page);
  await page.locator(".quick-input-widget .quick-input-box input").fill(`>${title}`);
  await pickQuickOption(page, title);
}

/** The quick input (pick or input box) currently showing, by its title. */
export function quickInputTitled(page: Page, title: string | RegExp): Locator {
  return page
    .locator(".quick-input-widget")
    .filter({ has: page.locator(".quick-input-title", { hasText: title }) });
}

/** Rows of the visible quick pick. */
export function quickOptions(page: Page): Locator {
  return page.locator('.quick-input-widget .quick-input-list [role="option"]');
}

/** Pick an option in the visible quick pick by its label. */
export async function pickQuickOption(page: Page, label: string): Promise<void> {
  const option = page.locator(
    `.quick-input-widget .quick-input-list [role="option"][aria-label^="${label}"]`
  );
  await option.first().waitFor({ state: "visible", timeout: 5000 });
  await option.first().click();
}

/** Fill the input box titled `title` (keeping its default when `value` is omitted) and submit. */
export async function answerInputBox(page: Page, title: string, value?: string): Promise<void> {
  const widget = quickInputTitled(page, title);
  await widget.waitFor({ state: "visible", timeout: 5000 });
  const input = widget.locator(".quick-input-box input");
  if (value !== undefined) await input.fill(value);
  await input.press("Enter");
  await widget.waitFor({ state: "hidden", timeout: 5000 });
}
