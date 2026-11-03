/**
 * THE STORYBOARD — the one file to edit when the film should change.
 *
 * Scenes play top to bottom; steps inside a scene play top to bottom. To add a
 * feature, append a Scene (or splice one in where it reads best) and add it to
 * `scenes` at the bottom. Each step:
 *
 *   caption  burned in, and spoken unless `say` differs
 *   act      what the user does — use ./lib/actions.ts and ./lib/vscode.ts
 *   check    asserts the feature actually showed (fails the recording if not)
 *   hold     minimum ms on screen (× pace); the voice line can make it longer
 *   only     ["qa"] / ["promo"] to limit a step; [] parks it (say why)
 *   still    also save a clean PNG of the step's end state: stills/<name>.png
 *   clip     contiguous steps with the same name → <name>.gif (README)
 *
 * Seed files live in ./seed/ and are copied fresh for every recording, so line
 * numbers below refer to those files as committed.
 *
 * Render: `just vscode-demo-video promo` / `just vscode-demo-video qa`.
 */

import { expect, type Locator, type Page } from "@playwright/test";
import { beat, click, hover, key, park, press, type } from "./lib/actions";
import { liveCaddy } from "./lib/live";
import type { Scene, Storyboard } from "./lib/types";
import {
  acceptSuggestionWithDetail,
  activeEditor,
  caretToLineEnd,
  codeLens,
  editorLine,
  explorerItem,
  hoverWidget,
  openFile,
  pickSuggestion,
  quickInput,
  quickInputRow,
  quickPickItem,
  runCommand,
  suggestRow,
  suggestWidget,
  token,
  tokens,
} from "./lib/vscode";

// ─────────────────────────────────────────────────────────────── 0.3.0 UI

/** The extension's status bar item ("✓ Caddy Route" / "⚠ Caddy Route: 2"). */
const caddyStatus = (page: Page): Locator =>
  page.locator(".statusbar-item", { hasText: "Caddy Route" }).first();

/** The Ctrl+. code action menu. */
const actionMenu = (page: Page): Locator => page.locator(".action-widget").first();

/** A VS Code modal dialog (not a browser alert). */
const dialog = (page: Page): Locator => page.locator(".monaco-dialog-box").first();

const toast = (page: Page, text: string): Locator =>
  page.locator(".notification-toast", { hasText: text }).first();

const terminalText = (page: Page): Locator => page.locator(".terminal-wrapper .xterm-rows").first();

// ─────────────────────────────────────────────────────────────── scenes

const intellisense: Scene = {
  title: "IntelliSense",
  steps: [
    {
      caption: "Open any *.caddy.json file: the status bar shows it is a Caddy route.",
      say: "Open any Caddy route config, and the extension switches on.",
      act: async (page) => {
        await openFile(page, "app.caddy.json");
      },
      check: async (page) => {
        await expect(editorLine(page, '"@id"')).toBeVisible();
        await expect(caddyStatus(page)).toBeVisible({ timeout: 10000 });
      },
      hold: 1800,
    },
    {
      caption: "Inside match, Ctrl+Space lists every matcher.",
      say: "Inside match, Control Space lists every matcher Caddy understands.",
      act: async (page) => {
        await caretToLineEnd(page, 4);
        await key(page, "Enter");
        await beat(page, 300);
        await press(page, "Control+Space");
      },
      check: async (page) => {
        await expect(suggestRow(page, "host")).toBeVisible({ timeout: 10000 });
      },
      hold: 2000,
    },
    {
      caption: "Pick host, type the domain.",
      act: async (page) => {
        await pickSuggestion(page, "host");
        await type(page, "api.example.com");
        await key(page, "Escape");
      },
      check: async (page) => {
        await expect(editorLine(page, '"api.example.com"')).toBeVisible();
      },
      hold: 1200,
    },
    {
      caption: "Start a handler and every Caddy handler is suggested.",
      say: "Start a handler, and every Caddy handler is suggested.",
      act: async (page) => {
        await park(page);
        // Line 11 is the handle object: the host completion inserted a 3-line array.
        await caretToLineEnd(page, 11);
        await key(page, "Enter");
        await type(page, '"handler": "rev');
      },
      check: async (page) => {
        await expect(suggestRow(page, "reverse_proxy")).toBeVisible({ timeout: 10000 });
      },
      hold: 1800,
      still: "01-completion",
    },
    {
      caption: "Pick reverse_proxy; field completions know the handler.",
      say: "Pick reverse proxy, and the field completions know which handler you are in.",
      act: async (page) => {
        await pickSuggestion(page, "reverse_proxy");
        await park(page);
        await key(page, "End");
        await type(page, ",");
        await key(page, "Enter");
        await press(page, "Control+Space");
        await expect(suggestRow(page, "upstreams")).toBeVisible({
          timeout: 10000,
        });
        await beat(page, 900);
        await pickSuggestion(page, "upstreams");
        // Out of habit, a URL where Caddy wants host:port — the next scene catches it.
        await type(page, "http://localhost:3000");
        await key(page, "Escape");
      },
      check: async (page) => {
        await expect(editorLine(page, '"dial": "http://localhost:3000"')).toBeVisible();
      },
      hold: 1600,
    },
  ],
};

const lint: Scene = {
  title: "Caddy lint",
  steps: [
    {
      caption: "A URL where Caddy wants host:port? Flagged before Caddy ever rejects it.",
      say: "A URL where Caddy wants host and port? It is flagged before Caddy ever rejects it.",
      act: async (page) => {
        // Monaco splits a URL out into its own (link) span, so match by content.
        const url = activeEditor(page).locator(".view-line span span", {
          hasText: "localhost:3000",
        });
        await hover(page, url.last(), { at: [0.6, 0.55] });
      },
      check: async (page) => {
        await expect(hoverWidget(page)).toContainText("not a URL", { timeout: 10000 });
        await expect(caddyStatus(page)).toContainText(":", { timeout: 10000 });
      },
      hold: 2600,
      clip: "quick-fix",
    },
    {
      caption: "Ctrl+. offers the fix…",
      say: "Control period offers the fix,",
      act: async (page) => {
        await park(page);
        await press(page, "Control+.");
      },
      check: async (page) => {
        await expect(actionMenu(page)).toContainText('Change to "localhost:3000"', {
          timeout: 10000,
        });
      },
      hold: 1600,
      still: "02-quick-fix",
      clip: "quick-fix",
    },
    {
      caption: "…one keystroke, and it is valid again.",
      say: "and one keystroke makes it valid again.",
      act: async (page) => {
        await press(page, "Enter");
      },
      check: async (page) => {
        await expect(editorLine(page, '"dial": "localhost:3000"')).toBeVisible({ timeout: 5000 });
      },
      hold: 1400,
      clip: "quick-fix",
    },
    {
      caption: "Typos too: upstream instead of upstreams…",
      say: "Typos get caught as well: here it says upstream instead of upstreams.",
      act: async (page) => {
        await click(page, token(page, '"upstreams"'), { double: true });
        await beat(page, 200);
        await type(page, "upstream");
        await park(page);
      },
      check: async (page) => {
        await expect(
          activeEditor(page).locator(".squiggly-warning, .squiggly-error").first()
        ).toBeVisible({ timeout: 10000 });
      },
      hold: 1400,
      clip: "quick-fix",
    },
    {
      caption: '…"Did you mean upstreams?" Ctrl+. and Enter.',
      say: "Did you mean upstreams? Control period, enter.",
      act: async (page) => {
        await press(page, "Control+.");
        await expect(actionMenu(page)).toContainText('Did you mean "upstreams"?', {
          timeout: 10000,
        });
        await beat(page, 1100);
        await press(page, "Enter");
      },
      check: async (page) => {
        await expect(editorLine(page, '"upstreams"')).toBeVisible({ timeout: 5000 });
      },
      hold: 1600,
      clip: "quick-fix",
    },
  ],
};

const docs: Scene = {
  title: "Docs",
  steps: [
    {
      caption: "Hover a handler for its documentation, fields and an example.",
      say: "Hover a handler for its documentation, its fields, and an example.",
      act: async (page) => {
        await hover(page, token(page, '"reverse_proxy"'), { at: [0.45, 0.55] });
      },
      check: async (page) => {
        await expect(hoverWidget(page)).toContainText("Reverse Proxy Handler", { timeout: 10000 });
      },
      hold: 3000,
    },
    {
      caption: "A CodeLens above each handler links to the official Caddy docs.",
      act: async (page) => {
        await park(page, { x: 1180, y: 120 });
        await beat(page, 300);
        await hover(page, codeLens(page, "Reverse Proxy Docs"), { at: [0.12, 0.5] });
      },
      check: async (page) => {
        await expect(codeLens(page, "Reverse Proxy Docs")).toBeVisible();
      },
      hold: 2000,
      only: ["qa"],
    },
  ],
};

const newFile: Scene = {
  title: "New config file",
  steps: [
    {
      caption: "Caddy: New Config File… starts from a validated template.",
      say: "New Config File starts you from a validated template.",
      act: async (page) => {
        await park(page);
        await runCommand(page, "Caddy: New Config File");
      },
      check: async (page) => {
        await expect(quickPickItem(page, "Route")).toBeVisible({ timeout: 10000 });
      },
      hold: 1800,
    },
    {
      caption: "Pick Route, name it, and Tab through the placeholders.",
      say: "Pick a route, give it a name, and tab through the placeholders to fill it in.",
      act: async (page) => {
        await click(page, quickPickItem(page, "Route"));
        await expect(quickInput(page)).toContainText("File name", { timeout: 5000 });
        // The input preselects the "app" in app.caddy.json; typing replaces it.
        await type(page, "blog");
        await press(page, "Enter");
        await expect(
          page.locator(".tabs-container .tab.active", { hasText: "blog.caddy.json" })
        ).toBeVisible({ timeout: 10000 });
        await park(page);
        await beat(page, 400);
        await type(page, "blog");
        await press(page, "Tab");
        await type(page, "blog.example.com");
        await press(page, "Tab");
        await type(page, "localhost:4000");
        await key(page, "Escape");
      },
      check: async (page) => {
        await expect(editorLine(page, '"@id": "blog"')).toBeVisible();
        await expect(editorLine(page, "blog.example.com")).toBeVisible();
        await expect(editorLine(page, "localhost:4000")).toBeVisible();
      },
      hold: 1600,
    },
  ],
};

const live: Scene = {
  title: "Live apply",
  steps: [
    {
      caption: "Ready? Apply a route to the running Caddy, straight from the editor.",
      act: async (page) => {
        if (!liveCaddy()) throw new Error("no live Caddy (see demo/global-setup.ts startCaddy)");
        await openFile(page, "hello.caddy.json");
        await runCommand(page, "Caddy: Apply File to Running Caddy");
      },
      check: async (page) => {
        await expect(dialog(page)).toContainText("Apply 1 route(s) [hello]", { timeout: 10000 });
      },
      hold: 2200,
    },
    {
      caption: "Confirm, and Caddy is updated through its admin API.",
      act: async (page) => {
        await click(page, dialog(page).locator(".monaco-button", { hasText: /^Apply$/ }));
      },
      check: async (page) => {
        await expect(toast(page, "Caddy updated: 1 route(s) added")).toBeVisible({
          timeout: 10000,
        });
      },
      hold: 2000,
    },
    {
      caption: "It is live. curl it.",
      say: "And it is live: one curl, and the new route answers right away.",
      act: async (page) => {
        const caddy = liveCaddy();
        // Clear of the "Caddy updated" toast at the bottom right.
        await park(page, { x: 1000, y: 380 });
        await press(page, "Control+Backquote");
        await expect(page.locator(".terminal-wrapper").first()).toBeVisible({ timeout: 10000 });
        await beat(page, 900);
        await type(page, `curl -s localhost:${caddy?.http ?? 8080}`);
        await key(page, "Enter");
      },
      check: async (page) => {
        await expect(terminalText(page)).toContainText("Hello from Caddy Tools!", {
          timeout: 10000,
        });
      },
      hold: 2400,
      still: "03-live-apply",
    },
    {
      caption: "Caddy: Show Running Config opens the live config, read-only.",
      act: async (page) => {
        await press(page, "Control+J");
        await runCommand(page, "Caddy: Show Running Config");
      },
      check: async (page) => {
        await expect(editorLine(page, '"srv0"')).toBeVisible({ timeout: 10000 });
      },
      hold: 2400,
      only: ["qa"],
    },
  ],
};

const builders: Scene = {
  title: "TypeScript builders",
  steps: [
    {
      caption: "Writing TypeScript? Completions cover the @viaalink/caddy-api-client builders.",
      say: "Writing TypeScript? Completions cover the typed builders of our Caddy client library.",
      act: async (page) => {
        await park(page);
        if (await page.locator(".terminal-wrapper").first().isVisible()) {
          await press(page, "Control+J");
        }
        await openFile(page, "routes.ts");
        await key(page, "Control+End");
        await type(page, "const admin = buildProt");
        await suggestWidget(page).waitFor({ timeout: 15000 });
        // Re-ask so every provider (the extension's and TypeScript's) has answered.
        await beat(page, 600);
        await key(page, "Escape");
        await press(page, "Control+Space");
      },
      check: async (page) => {
        await expect(suggestRow(page, "buildProtectedRoute")).toBeVisible({ timeout: 15000 });
      },
      hold: 1800,
    },
    {
      caption: "Accept: the call is scaffolded and the import is added for you.",
      say: "Accept it: the call is scaffolded, and the import is added for you.",
      act: async (page) => {
        // TypeScript offers its own auto-import entry with the same label; the
        // extension's is the one whose detail reads "CaddyRoute — …".
        await acceptSuggestionWithDetail(page, "CaddyRoute");
        await beat(page, 400);
        await type(page, "admin.example.com");
        await press(page, "Tab");
        await type(page, "admins");
        await press(page, "Tab");
        await type(page, "localhost:9000");
        await key(page, "Escape");
      },
      check: async (page) => {
        await expect(editorLine(page, 'gatekeeperName: "admins"')).toBeVisible();
        // A string, not a regex: Monaco renders spaces as &nbsp;, which only
        // Playwright's string matching normalises.
        await expect(
          editorLine(page, 'buildProtectedRoute } from "@viaalink/caddy-api-client"')
        ).toBeVisible();
      },
      hold: 2200,
    },
    {
      caption: "Hover any builder for its typed signature and docs.",
      act: async (page) => {
        await hover(page, tokens(page, "buildProtectedRoute").last(), { at: [0.5, 0.55] });
      },
      check: async (page) => {
        await expect(hoverWidget(page)).toContainText("buildProtectedRoute", { timeout: 15000 });
      },
      hold: 3000,
      only: ["qa"],
    },
  ],
};

const security: Scene = {
  title: "caddy-security",
  steps: [
    {
      caption: "caddy-security in one snippet: identity store, portal, policy and config.",
      say: "And caddy security in one snippet: the identity store, the login portal, the policy and the config.",
      act: async (page) => {
        await park(page);
        await openFile(page, "auth.ts");
        await key(page, "Control+End");
        await type(page, "caddy-sec-full");
        await expect(suggestRow(page, "caddy-sec-full-local")).toBeVisible({ timeout: 15000 });
        await beat(page, 600);
        await press(page, "Enter");
        await beat(page, 300);
        await key(page, "Escape");
        await key(page, "Control+End");
      },
      check: async (page) => {
        await expect(editorLine(page, "buildSecurityConfig({")).toBeVisible();
        await expect(editorLine(page, "buildAuthorizationPolicy({")).toBeVisible();
      },
      hold: 2400,
    },
    {
      // QA only: the promo already shows caddy-security via the snippet.
      caption: "Or answer three questions in the Security Configuration Wizard.",
      act: async (page) => {
        await openFile(page, "caddy-security.json");
        await key(page, "Control+End");
        await runCommand(page, "Caddy: Security Configuration Wizard");
        await click(page, quickInputRow(page, "Quick Setup"));
      },
      check: async (page) => {
        await expect(quickInput(page)).toContainText("Portal Name", { timeout: 5000 });
      },
      only: ["qa"],
    },
  ],
};

/** The 0.2.0 route wizard: still works, but New Config File tells the story better. */
const routeWizard: Scene = {
  title: "Route wizard",
  only: ["qa"],
  steps: [
    {
      caption: "The Route Configuration Wizard asks the questions instead.",
      act: async (page) => {
        await openFile(page, "shop.caddy.json");
        await runCommand(page, "Caddy: Route Configuration Wizard");
      },
      check: async (page) => {
        await expect(quickInput(page)).toContainText("Select Route Type", { timeout: 10000 });
      },
    },
    {
      caption: "Route type, name, host, root, security headers — and a complete route.",
      act: async (page) => {
        await click(page, quickInputRow(page, "File Server"));
        await expect(quickInput(page)).toContainText("Route ID", { timeout: 5000 });
        await type(page, "shop");
        await press(page, "Enter");
        await expect(quickInput(page)).toContainText("Host", { timeout: 5000 });
        await type(page, "shop.example.com");
        await press(page, "Enter");
        await expect(quickInput(page)).toContainText("Document Root", { timeout: 5000 });
        await type(page, "/srv/shop");
        await press(page, "Enter");
        await expect(quickInput(page)).toContainText("Security Headers", { timeout: 5000 });
        await click(page, quickInputRow(page, "Yes"));
        await park(page);
        await expect(editorLine(page, '"handler": "file_server"')).toBeVisible({ timeout: 10000 });
        await key(page, "Control+Home");
      },
      check: async (page) => {
        await expect(editorLine(page, '"@id": "shop"')).toBeVisible();
      },
      hold: 2400,
    },
  ],
};

const getStarted: Scene = {
  title: "Get started",
  steps: [
    {
      caption: "Every Caddy command is one click away, in the status bar menu…",
      say: "Every Caddy command is one click away, in the status bar,",
      act: async (page) => {
        await openFile(page, "app.caddy.json");
        await click(page, caddyStatus(page));
      },
      check: async (page) => {
        await expect(quickInput(page)).toContainText("Apply File to Running Caddy", {
          timeout: 10000,
        });
      },
      hold: 2200,
    },
    {
      caption: "…and a Get Started walkthrough is there whenever you need it.",
      say: "and a get started walkthrough is there whenever you need it.",
      act: async (page) => {
        await key(page, "Escape");
        await runCommand(page, "Caddy: Get Started");
        await park(page, { x: 1200, y: 690 });
      },
      check: async (page) => {
        await expect(page.getByText("Get Started with Caddy Tools").first()).toBeVisible({
          timeout: 10000,
        });
      },
      hold: 3200,
      still: "04-walkthrough",
    },
  ],
};

// ─────────────────────────────────────────────────────────────── the film

export const storyboard: Storyboard = {
  name: "caddy-tools",
  title: "Caddy Configuration Tools for VS Code",
  subtitle:
    "IntelliSense, quick fixes, docs, snippets and live apply for Caddy JSON and caddy-security",
  byline: "by Viaalink",
  closing: [
    "ext install Viaalink.vscode-caddy-tools",
    "VS Code Marketplace   marketplace.visualstudio.com/items?itemName=Viaalink.vscode-caddy-tools",
    "npm   npmjs.com/package/@viaalink/caddy-api-client",
    "GitHub   github.com/viaalink/asd-caddy-api-client",
    "viaalink.com",
  ],
  // Approved by Kelvin word for word (2026-11-03); the narration is his cloned voice.
  // Spoken: "Visual Studio Code" at the start, "client library" rather than "API client".
  intro: [
    "Caddy is a web server you configure with JSON, and a wrong field only shows up when Caddy refuses to load it.",
    "Caddy Configuration Tools for Visual Studio Code, by Viaalink, catches those mistakes while you type.",
    "It is free, open source, and built on our typed Caddy client library.",
  ],
  agenda: {
    heading: "In the next two minutes",
    items: [
      "Completions",
      "Quick fixes",
      "Docs on hover",
      "Templates",
      "Live apply to a running Caddy",
      "TypeScript builders",
      "caddy-security",
    ],
    say: "In the next two minutes: completions, quick fixes, docs on hover, templates, live apply to a running Caddy, TypeScript builders, and caddy security.",
  },
  outro: ["Install it from the VS Code Marketplace, and find the code on GitHub and npm."],
  prepare: async (page) => {
    await expect(explorerItem(page, "routes.ts")).toBeVisible();
    await park(page);
  },
  scenes: [intellisense, lint, docs, newFile, live, builders, security, routeWizard, getStarted],
};
