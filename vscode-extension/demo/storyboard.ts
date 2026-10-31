/**
 * THE STORYBOARD — the one file to edit when the film should change.
 *
 * Scenes play top to bottom; steps inside a scene play top to bottom. To add a
 * feature, append a Scene (or splice one in where it reads best). Each step:
 *
 *   caption  burned in, and spoken unless `say` differs
 *   act      what the user does — use ./lib/actions.ts and ./lib/vscode.ts
 *   check    asserts the feature actually showed (fails the recording if not)
 *   hold     minimum ms on screen (× pace); the voice line can make it longer
 *   only     ["qa"] / ["promo"] to limit a step; [] parks it (say why)
 *
 * Seed files live in ./seed/ and are copied fresh for every recording, so
 * line numbers below refer to those files as committed.
 *
 * Render: `just vscode-demo-video promo` / `just vscode-demo-video qa`.
 */

import { expect, type Page } from "@playwright/test";
import { beat, click, hover, key, park, press, type } from "./lib/actions";
import type { Scene, Storyboard } from "./lib/types";
import {
  activeEditor,
  caretToLineEnd,
  codeLens,
  editorLine,
  explorerItem,
  hoverWidget,
  openFile,
  pickSuggestion,
  problemsRow,
  quickInput,
  quickInputRow,
  runCommand,
  suggestRow,
  suggestWidget,
  tabToPlaceholder,
  token,
  tokens,
} from "./lib/vscode";

/** The text of the active editor, as the model has it (not just what is rendered). */
async function editorText(page: Page): Promise<string> {
  return (await activeEditor(page).locator(".view-lines").innerText()).replace(/ /g, " ");
}

// ─────────────────────────────────────────────────────────────── scenes

const intellisense: Scene = {
  title: "IntelliSense",
  steps: [
    {
      caption: "Open a Caddy route config: any *.caddy.json file gets the extension.",
      say: "Open any Caddy route config, and the extension switches on.",
      act: async (page) => {
        await openFile(page, "app.caddy.json");
      },
      check: async (page) => {
        await expect(editorLine(page, '"@id"')).toBeVisible();
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
        await expect(suggestRow(page, "host", "Matcher property")).toBeVisible({ timeout: 10000 });
      },
      hold: 2200,
    },
    {
      caption: "Pick host, type the domain.",
      act: async (page) => {
        await pickSuggestion(page, "host", "Matcher property");
        await type(page, "api.example.com");
        await key(page, "Escape");
      },
      check: async (page) => {
        await expect(editorLine(page, '"host": ["api.example.com"]')).toBeVisible();
      },
      hold: 1400,
    },
    {
      caption: 'Start a handler: "handler": " suggests every Caddy handler.',
      say: "Start a handler, and every Caddy handler is suggested.",
      act: async (page) => {
        await park(page);
        await caretToLineEnd(page, 9);
        await key(page, "Enter");
        await type(page, '"handler": "');
      },
      check: async (page) => {
        await expect(suggestWidget(page)).toBeVisible({ timeout: 10000 });
      },
      hold: 2000,
    },
    {
      caption: "Narrow it down and pick reverse_proxy.",
      act: async (page) => {
        await type(page, "rev");
        await pickSuggestion(page, "reverse_proxy");
      },
      check: async (page) => {
        await expect(editorLine(page, '"handler": "reverse_proxy"')).toBeVisible();
      },
      hold: 1400,
    },
    {
      caption: "Field completions know the handler: upstreams, transport, load_balancing…",
      say: "Field completions know which handler you are in.",
      act: async (page) => {
        await park(page);
        await key(page, "End");
        await type(page, ",");
        await key(page, "Enter");
        await press(page, "Control+Space");
        await expect(suggestRow(page, "upstreams", "Reverse Proxy field")).toBeVisible({
          timeout: 10000,
        });
        await beat(page, 900);
        await pickSuggestion(page, "upstreams", "Reverse Proxy field");
        await type(page, "localhost:3000");
        await key(page, "Escape");
      },
      check: async (page) => {
        await expect(editorLine(page, '"dial": "localhost:3000"')).toBeVisible();
      },
      hold: 2400,
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
      hold: 3600,
    },
    {
      caption: "A CodeLens above each handler links to the official Caddy docs.",
      say: "And a code lens above each handler links straight to the official Caddy docs.",
      act: async (page) => {
        await park(page, { x: 1180, y: 120 });
        await beat(page, 300);
        await hover(page, codeLens(page, "Reverse Proxy Docs"), { at: [0.12, 0.5] });
      },
      check: async (page) => {
        await expect(codeLens(page, "Reverse Proxy Docs")).toBeVisible();
      },
      hold: 2400,
    },
  ],
};

const validation: Scene = {
  title: "Validation",
  steps: [
    {
      caption: "Make a typo: upstream instead of upstreams…",
      say: "Make a typo, upstream instead of upstreams,",
      act: async (page) => {
        await click(page, token(page, '"upstreams"'), { double: true, at: [0.5, 0.5] });
        await beat(page, 250);
        await type(page, "upstream");
        await park(page);
      },
      check: async (page) => {
        await expect(
          activeEditor(page).locator(".squiggly-error, .squiggly-warning").first()
        ).toBeVisible({ timeout: 10000 });
      },
      hold: 2200,
    },
    {
      caption: "…and it is flagged right away, in the editor and the Problems panel.",
      say: "and it is flagged right away, in the editor and in the Problems panel.",
      act: async (page) => {
        await press(page, "Control+Shift+M");
      },
      check: async (page) => {
        await expect(problemsRow(page, "upstream")).toBeVisible({ timeout: 10000 });
      },
      hold: 3000,
    },
    {
      caption: "Undo, and the problem is gone.",
      act: async (page) => {
        await press(page, "Control+Z");
        await beat(page, 900);
        await press(page, "Control+J");
      },
      check: async (page) => {
        await expect(editorLine(page, '"upstreams"')).toBeVisible();
      },
      hold: 1400,
      only: ["qa"],
    },
  ],
};

const snippets: Scene = {
  title: "Snippets",
  steps: [
    {
      caption: "Snippets scaffold a whole route: type caddy-route…",
      say: "Snippets scaffold a whole route. Type caddy route,",
      act: async (page) => {
        await openFile(page, "blog.caddy.json");
        await type(page, "caddy-route");
      },
      check: async (page) => {
        await expect(suggestRow(page, "caddy-route")).toBeVisible({ timeout: 10000 });
      },
      hold: 1600,
    },
    {
      caption: "…and Tab through the placeholders.",
      say: "then tab through the placeholders.",
      act: async (page) => {
        await press(page, "Enter");
        await beat(page, 500);
        await type(page, "blog");
        await press(page, "Tab");
        await type(page, "blog.example.com");
        await press(page, "Tab");
        // Placeholder 3 is a choice list (reverse_proxy, file_server, …).
        await expect(suggestWidget(page)).toBeVisible({ timeout: 5000 });
        await beat(page, 700);
        await press(page, "Enter");
        await tabToPlaceholder(page, "localhost:3000".length);
        await type(page, "localhost:4000");
        await key(page, "Escape");
      },
      check: async (page) => {
        const text = await editorText(page);
        expect(text).toContain('"@id": "blog"');
        expect(text).toContain("blog.example.com");
        expect(text).toContain("localhost:4000");
      },
      hold: 2000,
    },
  ],
};

const routeWizard: Scene = {
  title: "Route wizard",
  steps: [
    {
      caption: "Prefer questions to syntax? Run the Route Configuration Wizard.",
      say: "Prefer questions to syntax? Run the route configuration wizard.",
      act: async (page) => {
        await openFile(page, "shop.caddy.json");
        await runCommand(page, "Caddy: Route Configuration Wizard");
      },
      check: async (page) => {
        await expect(quickInput(page)).toContainText("Select Route Type", { timeout: 10000 });
      },
      hold: 2000,
    },
    {
      caption: "Pick a route type, name it, add a host…",
      say: "Pick a route type, give it a name and a host,",
      act: async (page) => {
        await beat(page, 400);
        await click(page, quickInputRow(page, "File Server"));
        await expect(quickInput(page)).toContainText("Route ID", { timeout: 5000 });
        await type(page, "shop");
        await press(page, "Enter");
        await expect(quickInput(page)).toContainText("Host", { timeout: 5000 });
        await type(page, "shop.example.com");
        await press(page, "Enter");
      },
      check: async (page) => {
        await expect(quickInput(page)).toContainText("Document Root", { timeout: 5000 });
      },
      hold: 1600,
    },
    {
      caption: "…and it writes a complete, valid route for you.",
      say: "and it writes a complete, valid route for you.",
      act: async (page) => {
        await type(page, "/srv/shop");
        await press(page, "Enter");
        await expect(quickInput(page)).toContainText("Security Headers", { timeout: 5000 });
        await beat(page, 500);
        await click(page, quickInputRow(page, "Yes"));
        await park(page);
        await expect(editorLine(page, '"handler": "file_server"')).toBeVisible({ timeout: 10000 });
        await key(page, "Control+Home");
      },
      check: async (page) => {
        await expect(editorLine(page, '"@id": "shop"')).toBeVisible();
        await expect(editorLine(page, "X-Frame-Options")).toBeVisible();
      },
      hold: 2800,
    },
  ],
};

const builders: Scene = {
  title: "TypeScript builders",
  steps: [
    {
      caption:
        "Writing TypeScript? The same snippets cover the @viaalink/caddy-api-client builders.",
      say: "Writing TypeScript? The same snippets cover the typed builders of the Caddy API client.",
      act: async (page) => {
        await openFile(page, "routes.ts");
        await key(page, "Control+End");
        await type(page, "const admin = caddy-prot");
      },
      check: async (page) => {
        await expect(suggestRow(page, "caddy-protected-route")).toBeVisible({ timeout: 15000 });
      },
      hold: 2000,
    },
    {
      caption: "A protected route, guarded by a caddy-security policy.",
      say: "Here, a route protected by a caddy security policy.",
      act: async (page) => {
        await press(page, "Enter");
        await beat(page, 400);
        await type(page, '["admin.example.com"]');
        await press(page, "Tab");
        await type(page, '"admins"');
        await press(page, "Tab");
        await type(page, '"localhost:9000"');
        await key(page, "Escape");
      },
      check: async (page) => {
        const text = await editorText(page);
        expect(text).toContain("buildProtectedRoute({");
        expect(text).toContain('gatekeeperName: "admins"');
      },
      hold: 1800,
    },
    {
      caption: "Hover any builder for its typed signature and docs.",
      say: "Hover any builder for its signature and its docs.",
      act: async (page) => {
        await hover(page, tokens(page, "buildProtectedRoute").last(), { at: [0.5, 0.55] });
      },
      check: async (page) => {
        await expect(hoverWidget(page)).toContainText("buildProtectedRoute", { timeout: 15000 });
      },
      hold: 3600,
    },
  ],
};

const security: Scene = {
  title: "caddy-security",
  steps: [
    {
      caption:
        "caddy-security in one go: caddy-sec-full-local writes store, portal, policy and config.",
      say: "And caddy security in one go: one snippet writes the identity store, the portal, the policy and the config.",
      act: async (page) => {
        await park(page);
        await openFile(page, "auth.ts");
        await key(page, "Control+End");
        await type(page, "caddy-sec-full");
        await expect(suggestRow(page, "caddy-sec-full-local")).toBeVisible({ timeout: 15000 });
        await beat(page, 700);
        await press(page, "Enter");
        await beat(page, 400);
        await type(page, "/etc/caddy/users.json");
        await press(page, "Tab");
        await type(page, "portal");
        await press(page, "Tab");
        await type(page, ".example.com");
        await press(page, "Tab");
        await type(page, "admins");
        await key(page, "Escape");
        // Scroll so the finished config is in view.
        await key(page, "Control+End");
      },
      check: async (page) => {
        await expect(editorLine(page, "buildSecurityConfig({")).toBeVisible();
        await expect(editorLine(page, "buildAuthorizationPolicy({")).toBeVisible();
      },
      hold: 2600,
    },
    {
      // PARKED: the Security Configuration Wizard's Quick Setup writes JSON in a
      // shape the caddy-security schema does not accept (identity_stores with
      // driver/realm/path, portals without cookie_config), so filming it would
      // show the extension contradicting itself with red squiggles. Being fixed
      // in a sibling worktree; set `only` back to undefined once it lands.
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
      only: [],
    },
  ],
};

// ─────────────────────────────────────────────────────────────── the film

export const storyboard: Storyboard = {
  name: "caddy-tools",
  title: "Caddy Configuration Tools for VS Code",
  subtitle:
    "IntelliSense, docs, validation, snippets and wizards for Caddy JSON and caddy-security",
  byline: "by Viaalink",
  closing: [
    "ext install Viaalink.vscode-caddy-tools",
    "marketplace.visualstudio.com/items?itemName=Viaalink.vscode-caddy-tools",
    "viaalink.com",
  ],
  prepare: async (page) => {
    // Notifications would pop over the editor ("Route configuration inserted!").
    await runCommand(page, "Notifications: Toggle Do Not Disturb Mode", { show: false });
    await expect(explorerItem(page, "routes.ts")).toBeVisible();
    await park(page);
  },
  scenes: [intellisense, docs, validation, snippets, routeWizard, builders, security],
};
