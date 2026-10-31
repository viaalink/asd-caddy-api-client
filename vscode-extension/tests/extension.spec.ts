/**
 * code-server UI tests for the Caddy Configuration Tools extension.
 *
 * Every test here verifies behaviour of THIS extension (its providers,
 * commands, snippets, diagnostics or Marketplace listing) as a user sees
 * it in the browser -- not VS Code's own editor features. The workbench is
 * loaded once per worker and reset between tests (see fixtures.ts).
 *
 * Completion/diagnostics tests use real files in the (throwaway) workspace:
 * the extension's providers are registered for `scheme: "file"` documents,
 * so an untitled buffer never reaches them.
 */

import {
  test,
  expect,
  openFile,
  triggerCompletion,
  suggestItem,
  suggestWidget,
  suggestLabels,
  goToLineEnd,
  saveActiveEditor,
  expectValidJson,
  readWorkspaceFile,
  caddyProblemRows,
  problemRows,
  runCommand,
  openCommandPalette,
  pickQuickOption,
  quickOptions,
  quickInputTitled,
  answerInputBox,
  DIAGNOSTICS_SETTLE_MS,
  type ScratchFileFactory,
} from "./fixtures";
import type { Page } from "@playwright/test";

const CADDY_COMMANDS = [
  "Caddy: Show Handler Documentation",
  "Caddy: Insert Route Configuration",
  "Caddy: Insert Security Configuration",
  "Caddy: Route Configuration Wizard",
  "Caddy: Security Configuration Wizard",
];

/** Create a scratch file with `content` and open it. */
async function openScratch(
  page: Page,
  scratchFile: ScratchFileFactory,
  name: string,
  content = ""
): Promise<void> {
  await openFile(page, await scratchFile(name, content));
}

/**
 * Wait out the diagnostics debounce, then assert the open file has no
 * problems at all -- neither from the extension's own validator (source
 * "caddy") nor from VS Code validating against the schemas the extension
 * contributes. Absence can't be awaited as an event, so this is a bounded
 * wait (DIAGNOSTICS_SETTLE_MS); callers pair it with a positive control
 * where one is available.
 */
async function expectNoProblems(page: Page): Promise<void> {
  // Deliberate fixed wait: there is no event for "validation ran and found nothing".
  await page.waitForTimeout(DIAGNOSTICS_SETTLE_MS);
  const rows = await problemRows(page);
  await expect(rows).toHaveCount(0);
  await expect(page.locator(".squiggly-error, .squiggly-warning")).toHaveCount(0);
}

/** Save the active editor and return its on-disk content parsed as strict JSON. */
async function saveAndParse(
  page: Page,
  workspaceDir: string,
  name: string
): Promise<{ text: string; value: unknown }> {
  await saveActiveEditor(page);
  const text = readWorkspaceFile(workspaceDir, name);
  return { text, value: expectValidJson(text) };
}

/**
 * Type a snippet prefix at the cursor, assert the snippet is offered, accept
 * it, and leave snippet mode with every placeholder at its default.
 */
async function insertSnippetByPrefix(page: Page, prefix: string): Promise<void> {
  await page.keyboard.type(prefix);
  await triggerCompletion(page);
  const item = suggestItem(page, prefix);
  await expect(item, `snippet "${prefix}" not offered`).toHaveCount(1);
  await item.click();
  await expect(suggestWidget(page)).toBeHidden();
  // Leave snippet mode (and any choice popup) keeping the defaults.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
}

// ============================================================================
// ACTIVATION AND LISTING
// ============================================================================

test.describe("Extension Activation", () => {
  // VS Code's declarative jsonValidation keeps working even when our
  // activate() throws, so the diagnostics tests alone would not notice a
  // broken bundle (e.g. a dangling require() in dist/extension.js).
  test("activates without error", async ({ page, consoleMessages }) => {
    // Opening a JSON file is what triggers activation (onLanguage:json).
    await openFile(page, "valid.caddy.json");
    await expect
      .poll(() => consoleMessages.some((m) => /Caddy Configuration Tools: Activated/.test(m)), {
        timeout: 15000,
      })
      .toBe(true);
    const failures = consoleMessages.filter((m) =>
      /Activating extension 'viaalink\.vscode-caddy-tools' failed/.test(m)
    );
    expect(failures, failures.join("\n")).toEqual([]);
  });
});

test.describe("Extension Listing", () => {
  // A stale/broken vsix can install "successfully" while still rendering as
  // a blank/generic entry in the Extensions panel.
  test("shows a proper icon, description, and rendered README in the Extensions panel", async ({
    page,
  }) => {
    await page.keyboard.press("Control+Shift+X");

    const entry = page.locator('.extension-list-item:has-text("Caddy Configuration Tools")');
    await expect(entry).toBeVisible({ timeout: 10000 });
    await expect(entry.locator("img")).toHaveAttribute("src", /icon\.png|\.png$/);
    await expect(entry).toContainText("viaalink");

    await entry.click();
    const detailsPane = page.locator(".extension-editor");
    await expect(
      detailsPane.getByRole("heading", { name: "Caddy Configuration Tools" })
    ).toBeVisible({ timeout: 10000 });
    await expect(detailsPane).toContainText("viaalink");

    // README.md renders two webview iframes deep (outer sandbox shell ->
    // inner content frame) -- proves it actually rendered, not a blank pane.
    const readmeFrame = page
      .frameLocator('iframe[src*="webview/browser/pre"]')
      .frameLocator("iframe")
      .first();
    await expect(readmeFrame.getByText("IntelliSense & Autocompletion")).toBeVisible({
      timeout: 10000,
    });
  });
});

// ============================================================================
// HOVER AND CODELENS
// ============================================================================

test.describe("Hover and CodeLens", () => {
  test("hover on handler shows documentation", async ({ page }) => {
    await openFile(page, "valid.caddy.json");

    // Our provider must render its docs, including the example (a typo'd
    // appendCodeBlock once made it throw silently).
    const reverseProxySpan = page
      .locator(".view-lines span")
      .filter({ hasText: /^"reverse_proxy"$/ })
      .first();
    await expect(reverseProxySpan).toBeVisible();
    await reverseProxySpan.hover();

    const hoverWidget = page.locator(".monaco-hover").filter({ hasText: "Handler" }).first();
    await expect(hoverWidget).toBeVisible({ timeout: 5000 });
    await expect(hoverWidget).toContainText("Reverse Proxy Handler");
    await expect(hoverWidget).toContainText("Example");
  });

  test("CodeLens shows documentation links above handlers", async ({ page }) => {
    await openFile(page, "valid-route.caddy.json");
    const lenses = page.locator(".codelens-decoration");
    await expect(lenses.filter({ hasText: "Reverse Proxy Docs" })).toHaveCount(1, {
      timeout: 10000,
    });
    await expect(lenses.filter({ hasText: "Headers Docs" })).toHaveCount(1);
  });
});

// ============================================================================
// DIAGNOSTICS
// ============================================================================

test.describe("Diagnostics", () => {
  // These go through the schemas the extension contributes via package.json
  // `jsonValidation` (VS Code's JSON language service does the validating).
  const invalid: Array<[string, RegExp[]]> = [
    ["invalid.caddy.json", [/handler is not allowed/, /Missing property "handle"/]],
    ["invalid-missing-handle.caddy.json", [/Missing property "handle"/]],
    ["invalid-unknown-field.caddy.json", [/paths/, /termnal/]],
    ["invalid.caddy-security.json", [/Missing property "name"/]],
  ];
  for (const [file, messages] of invalid) {
    test(`${file} is reported against the contributed schema`, async ({ page }) => {
      await openFile(page, file);
      const rows = await problemRows(page);
      for (const message of messages) {
        await expect(rows.filter({ hasText: message }).first()).toBeVisible({ timeout: 10000 });
      }
      await expect(page.locator(".squiggly-error, .squiggly-warning").first()).toBeVisible();
    });
  }

  test.fixme(
    "the extension's own validator reports caddy-source problems",
    // Extension bug (src/providers/schema-validator.ts): SimpleSchemaValidator
    // never resolves "$ref", and every generated schema's root is
    // {"$ref": "#/definitions/<name>"} -- so it validates against an empty
    // schema and the "caddy" diagnostics collection is always empty. All
    // problems users see today come from jsonValidation. Remove .fixme once
    // the validator resolves $ref.
    async ({ page }) => {
      await openFile(page, "invalid-missing-handle.caddy.json");
      const rows = await caddyProblemRows(page);
      await expect(rows.first()).toBeVisible({ timeout: 10000 });
    }
  );

  for (const file of ["valid.caddy.json", "valid-route.caddy.json", "valid.caddy-security.json"]) {
    test(`${file} shows no problems`, async ({ page }) => {
      await openFile(page, file);
      await expectNoProblems(page);
    });
  }
});

// ============================================================================
// SCHEMA-AWARE COMPLETIONS
// ============================================================================

test.describe("Schema-Aware IntelliSense", () => {
  test("completions show handler types in a handler value", async ({ page, scratchFile }) => {
    await openScratch(
      page,
      scratchFile,
      "c-handler.caddy.json",
      '{\n  "handle": [{ "handler": "" }]\n}\n'
    );
    await goToLineEnd(page, 2);
    // Cursor between the quotes of "handler": "|"
    for (let i = 0; i < '" }]'.length; i++) await page.keyboard.press("ArrowLeft");
    await triggerCompletion(page);
    for (const handler of ["reverse_proxy", "file_server", "static_response", "headers"]) {
      await expect(suggestItem(page, handler)).toHaveCount(1);
    }
  });

  test("completions show HTTP methods in match config", async ({ page, scratchFile }) => {
    await openScratch(
      page,
      scratchFile,
      "c-method.caddy.json",
      '{\n  "match": [{ "method": [""] }]\n}\n'
    );
    await goToLineEnd(page, 2);
    for (let i = 0; i < '"] }]'.length; i++) await page.keyboard.press("ArrowLeft");
    await triggerCompletion(page);
    for (const method of ["GET", "POST", "DELETE"]) {
      await expect(suggestItem(page, method)).toHaveCount(1);
    }
  });

  test("completions show route properties at root level", async ({ page, scratchFile }) => {
    await openScratch(page, scratchFile, "c-root.caddy.json", "{\n  \n}\n");
    await goToLineEnd(page, 2);
    await triggerCompletion(page);
    for (const prop of ["@id", "match", "handle", "terminal"]) {
      await expect(suggestItem(page, prop)).toHaveCount(1);
    }
  });

  test("offers match properties when actually inside a match object", async ({
    page,
    scratchFile,
  }) => {
    await openScratch(page, scratchFile, "c-match.caddy.json", '{\n  "match": [{\n    \n  }]\n}\n');
    await goToLineEnd(page, 3);
    await triggerCompletion(page);
    for (const prop of ["host", "path", "method"]) {
      await expect(suggestItem(page, prop)).toHaveCount(1);
    }
  });

  test("does not offer match properties inside a handler's nested object", async ({
    page,
    scratchFile,
  }) => {
    // Regression: context detection once counted brackets across the whole
    // document, so after a "match" array matcher properties were offered
    // anywhere later in the file.
    await openScratch(
      page,
      scratchFile,
      "c-nested.caddy.json",
      '{\n  "match": [{ "host": ["example.com"] }],\n  "handle": [{\n    "handler": "headers",\n    "response": {\n      \n    }\n  }]\n}\n'
    );
    await goToLineEnd(page, 6);
    await page.keyboard.press("Control+Space");
    // Either nothing is offered or what is offered isn't a matcher property;
    // wait for the widget to settle on one of its states before asserting.
    const widget = page.locator(".editor-widget.suggest-widget");
    await expect(widget).toHaveClass(/visible|message/, { timeout: 5000 });
    await expect(suggestItem(page, "host")).toHaveCount(0);
    await expect(suggestItem(page, "path")).toHaveCount(0);
  });

  test("offers handler-specific fields, not match properties, inside a handle object", async ({
    page,
    scratchFile,
  }) => {
    await openScratch(
      page,
      scratchFile,
      "c-fields.caddy.json",
      '{\n  "match": [{ "host": ["example.com"] }],\n  "handle": [{\n    "handler": "reverse_proxy",\n    \n  }]\n}\n'
    );
    await goToLineEnd(page, 5);
    await triggerCompletion(page);
    await expect(suggestItem(page, "upstreams")).toHaveCount(1);
    await expect(suggestItem(page, "host")).toHaveCount(0);
  });
});

// ============================================================================
// SNIPPETS
// ============================================================================

test.describe("Snippets", () => {
  test("caddy snippets are offered in JSON files", async ({ page, scratchFile }) => {
    await openScratch(page, scratchFile, "s-list.caddy.json");
    await page.keyboard.type("caddy-");
    await triggerCompletion(page);
    const labels = await suggestLabels(page);
    for (const prefix of ["caddy-route", "caddy-handler-proxy", "caddy-sec-portal"]) {
      expect(labels, `snippet "${prefix}" missing from ${labels.join(", ")}`).toContain(prefix);
    }
  });

  test.fixme(
    "caddy-route snippet inserts a valid route",
    // Snippet bug (snippets/caddy-json.json, generated by
    // scripts/generate-snippets.js): placeholder ${4:"upstreams": [{ "dial":
    // "${5:localhost:3000}" }]} contains an unescaped "}" which closes
    // placeholder 4 early, so the literal "]}" lands after it and the buffer
    // becomes `"upstreams": [{ "dial": "localhost:3000" ]}` -- invalid JSON.
    // Needs "\\}" inside the placeholder. Remove .fixme once fixed.
    async ({ page, scratchFile, workspaceDir }) => {
      const name = "s-route.caddy.json";
      await openScratch(page, scratchFile, name, "{}");
      // Positive control: the route schema is active for this file name.
      await expect((await problemRows(page)).first()).toBeVisible({ timeout: 10000 });
      await page.locator(".editor-instance .view-lines").click();
      await page.keyboard.press("Control+a");
      await page.keyboard.press("Delete");
      await insertSnippetByPrefix(page, "caddy-route");
      const { value } = await saveAndParse(page, workspaceDir, name);
      expect(value).toMatchObject({
        handle: [{ handler: "reverse_proxy", upstreams: [{ dial: "localhost:3000" }] }],
      });
      await expectNoProblems(page);
    }
  );

  test("caddy-handler-proxy snippet inserts a valid handler into a route", async ({
    page,
    scratchFile,
    workspaceDir,
  }) => {
    const name = "s-proxy.caddy.json";
    await openScratch(page, scratchFile, name, '{\n  "handle": [\n    \n  ]\n}\n');
    await goToLineEnd(page, 3);
    await insertSnippetByPrefix(page, "caddy-handler-proxy");
    const { value } = await saveAndParse(page, workspaceDir, name);
    expect(value).toEqual({
      handle: [{ handler: "reverse_proxy", upstreams: [{ dial: "localhost:3000" }] }],
    });
    await expectNoProblems(page);
  });

  test("caddy-sec-portal snippet inserts a portal as valid JSON", async ({
    page,
    scratchFile,
    workspaceDir,
  }) => {
    const name = "s-portal-json.caddy-security-portal.json";
    await openScratch(page, scratchFile, name);
    await insertSnippetByPrefix(page, "caddy-sec-portal");
    const { value } = await saveAndParse(page, workspaceDir, name);
    expect(value).toMatchObject({ name: "myportal", identity_stores: ["local"] });
  });

  test.fixme(
    "caddy-sec-portal snippet validates against the portal schema",
    // Snippet bug (snippets/caddy-json.json via scripts/generate-snippets.js):
    // it emits "cookie": {...}, but the contributed caddy-security-portal
    // schema (additionalProperties: false) only knows "cookie_config", so
    // the inserted portal shows "Property cookie is not allowed".
    async ({ page, scratchFile, workspaceDir }) => {
      const name = "s-portal.caddy-security-portal.json";
      await openScratch(page, scratchFile, name, "{}");
      // Positive control: the portal schema is active (requires "name").
      await expect((await problemRows(page)).first()).toBeVisible({ timeout: 10000 });
      await page.locator(".editor-instance .view-lines").click();
      await page.keyboard.press("Control+a");
      await page.keyboard.press("Delete");
      await insertSnippetByPrefix(page, "caddy-sec-portal");
      await saveAndParse(page, workspaceDir, name);
      await expectNoProblems(page);
    }
  );
});

// ============================================================================
// COMMANDS
// ============================================================================

test.describe("Commands", () => {
  test("command palette lists every Caddy command", async ({ page }) => {
    await openCommandPalette(page);
    await page.locator(".quick-input-widget .quick-input-box input").fill(">Caddy:");
    for (const title of CADDY_COMMANDS) {
      await expect(
        page.locator(`.quick-input-list [role="option"][aria-label^="${title}"]`)
      ).toHaveCount(1);
    }
  });

  test("Show Handler Docs lists handlers", async ({ page }) => {
    await runCommand(page, "Caddy: Show Handler Documentation");
    for (const handler of ["Reverse Proxy", "File Server", "Static Response", "Headers"]) {
      await expect(
        page.locator(`.quick-input-list [role="option"][aria-label^="${handler}"]`).first()
      ).toBeVisible();
    }
  });

  test("Insert Route offers every route type", async ({ page }) => {
    await openFile(page, "empty.caddy.json");
    await runCommand(page, "Caddy: Insert Route Configuration");
    for (const label of [
      "Reverse Proxy Route",
      "Static File Server",
      "Redirect Route",
      "Protected Route (caddy-security)",
    ]) {
      await expect(
        page.locator(`.quick-input-list [role="option"][aria-label^="${label}"]`)
      ).toHaveCount(1);
    }
  });

  test("Insert Route inserts a valid reverse proxy route", async ({
    page,
    scratchFile,
    workspaceDir,
  }) => {
    const name = "cmd-route.caddy.json";
    await openScratch(page, scratchFile, name);
    await runCommand(page, "Caddy: Insert Route Configuration");
    await pickQuickOption(page, "Reverse Proxy Route");
    await page.keyboard.press("Escape"); // leave snippet mode with defaults
    const { value } = await saveAndParse(page, workspaceDir, name);
    expect(value).toMatchObject({
      match: [{ host: ["example.com"] }],
      handle: [{ handler: "reverse_proxy", upstreams: [{ dial: "localhost:3000" }] }],
    });
    await expectNoProblems(page);
  });

  test("Insert Security Config offers every config type", async ({ page }) => {
    await openFile(page, "empty.caddy.json");
    await runCommand(page, "Caddy: Insert Security Configuration");
    for (const label of [
      "Local Identity Store",
      "LDAP Identity Store",
      "Authentication Portal",
      "Authorization Policy",
      "Complete Security App",
    ]) {
      await expect(
        page.locator(`.quick-input-list [role="option"][aria-label^="${label}"]`)
      ).toHaveCount(1);
    }
  });

  test("Insert Security Config inserts a local identity store as valid JSON", async ({
    page,
    scratchFile,
    workspaceDir,
  }) => {
    const name = "cmd-store.json";
    await openScratch(page, scratchFile, name);
    await runCommand(page, "Caddy: Insert Security Configuration");
    await pickQuickOption(page, "Local Identity Store");
    await page.keyboard.press("Escape"); // leave snippet mode with defaults
    const { value } = await saveAndParse(page, workspaceDir, name);
    expect(value).toMatchObject({ realm: "local", path: "/etc/caddy/users.json" });
  });

  test.fixme(
    "Insert Security Config's Authentication Portal validates against the portal schema",
    // Extension bug (src/providers/commands.ts): the inserted portal uses
    // "cookie": {...}; the contributed caddy-security-portal schema only
    // allows "cookie_config" -> "Property cookie is not allowed".
    async ({ page, scratchFile, workspaceDir }) => {
      const name = "cmd-portal.caddy-security-portal.json";
      await openScratch(page, scratchFile, name);
      await runCommand(page, "Caddy: Insert Security Configuration");
      await pickQuickOption(page, "Authentication Portal");
      await page.keyboard.press("Escape");
      const { value } = await saveAndParse(page, workspaceDir, name);
      expect(value).toMatchObject({ name: "myportal", identity_stores: ["local"] });
      await expectNoProblems(page);
    }
  );
});

// ============================================================================
// WIZARDS
// ============================================================================

test.describe("Wizards", () => {
  test("Route Wizard builds a complete reverse proxy route", async ({
    page,
    scratchFile,
    workspaceDir,
  }) => {
    const name = "wizard-route.caddy.json";
    await openScratch(page, scratchFile, name);
    await runCommand(page, "Caddy: Route Configuration Wizard");

    await expect(quickInputTitled(page, "Select Route Type (Step 1/5)")).toBeVisible();
    await expect(quickOptions(page)).toHaveCount(5);
    await pickQuickOption(page, "Reverse Proxy");
    await answerInputBox(page, "Route ID (Step 2/5)"); // keep default
    await answerInputBox(page, "Host(s) (Step 3/5)", "api.example.com");
    await answerInputBox(page, "Upstream Server (Step 4/5)", "localhost:3000");
    await expect(quickInputTitled(page, "Add Security Headers? (Step 5/5)")).toBeVisible();
    await pickQuickOption(page, "Yes");

    await expect(
      page.locator(".notification-toast", { hasText: "Route configuration inserted!" })
    ).toBeVisible({ timeout: 10000 });
    const { value } = await saveAndParse(page, workspaceDir, name);
    expect(value).toMatchObject({
      "@id": "reverse-proxy-route",
      match: [{ host: ["api.example.com"] }],
      handle: [
        { handler: "headers" },
        { handler: "reverse_proxy", upstreams: [{ dial: "localhost:3000" }] },
      ],
      terminal: true,
    });
    await expectNoProblems(page);
  });

  test("Security Wizard quick setup builds a security app config", async ({
    page,
    scratchFile,
    workspaceDir,
  }) => {
    const name = "wizard-security.json";
    await openScratch(page, scratchFile, name);
    await runCommand(page, "Caddy: Security Configuration Wizard");

    await expect(quickInputTitled(page, "Security Configuration Wizard")).toBeVisible();
    await expect(quickOptions(page)).toHaveCount(2);
    await pickQuickOption(page, "Quick Setup");
    await answerInputBox(page, "Portal Name"); // default "myportal"
    await answerInputBox(page, "Cookie Domain", ".example.com");
    await answerInputBox(page, "Users File Path"); // default

    await expect(
      page.locator(".notification-toast", { hasText: "Security configuration inserted!" })
    ).toBeVisible({ timeout: 10000 });
    const { value } = await saveAndParse(page, workspaceDir, name);
    expect(value).toMatchObject({
      config: {
        identity_stores: [{ realm: "local", path: "/etc/caddy/users.json" }],
        authentication_portals: [
          { name: "myportal", identity_stores: ["local"], cookie: { domain: ".example.com" } },
        ],
        authorization_policies: [{ name: "myportal-policy" }],
      },
    });
  });
});
