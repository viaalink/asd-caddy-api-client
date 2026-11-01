/**
 * Desktop VS Code integration tests: the extension loaded from this folder
 * (--extensionDevelopmentPath) into a real VS Code, asserted through the
 * VS Code API rather than through the UI.
 */

import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  EXTENSION_ID,
  EXTENSION_DIR,
  caddyDiagnostics,
  closeAllEditors,
  completionLabel,
  hoverText,
  openFixture,
  openScratch,
  positionAfter,
  removeScratchDir,
  sleep,
  waitFor,
} from "./helpers";

interface ContributedCommand {
  command: string;
  title: string;
}

interface SnippetDefinition {
  prefix: string;
  body: string | string[];
}

/** A route with a URL as dial (dial-url) and a reused @id (duplicate-id). */
const LINT_ROUTE = JSON.stringify(
  {
    "@id": "lint-demo",
    match: [{ host: ["example.com"] }],
    handle: [
      {
        handler: "reverse_proxy",
        "@id": "lint-demo",
        upstreams: [{ dial: "http://localhost:3000" }],
      },
    ],
    terminal: true,
  },
  null,
  2
);

after(async () => {
  await closeAllEditors();
  removeScratchDir();
});

describe("activation", () => {
  it("activates when a JSON file opens, without throwing", async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `${EXTENSION_ID} is not loaded`);
    await openFixture("valid.caddy.json");
    await waitFor("extension activation", () => (ext.isActive ? true : undefined));
    // activate() on an active extension resolves with its exports; it
    // rejects if activation threw.
    await ext.activate();
  });

  it("registers every contributed caddy.* command", async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext);
    await ext.activate();
    const contributed = (ext.packageJSON.contributes.commands as ContributedCommand[]).map(
      (c) => c.command
    );
    assert.deepStrictEqual([...contributed].sort(), [
      "caddy.applyToCaddy",
      "caddy.insertRoute",
      "caddy.insertSecurityConfig",
      "caddy.newConfigFile",
      "caddy.openWalkthrough",
      "caddy.runRouteWizard",
      "caddy.runSecurityWizard",
      "caddy.showHandlerDocs",
      "caddy.showMenu",
      "caddy.showRunningConfig",
    ]);
    const registered = new Set(await vscode.commands.getCommands(true));
    const missing = contributed.filter((c) => !registered.has(c));
    assert.deepStrictEqual(missing, [], "contributed but not registered");
  });
});

describe("diagnostics", () => {
  const invalid: Array<[string, RegExp]> = [
    ["invalid.caddy.json", /handle|handler|foo|unknown_field/],
    ["invalid-missing-handle.caddy.json", /handle/],
    ["invalid-unknown-field.caddy.json", /paths|termnal/],
    ["invalid.caddy-security.json", /name|maybe/],
  ];

  // Through the schemas the extension contributes (package.json
  // jsonValidation), validated by VS Code's built-in JSON language service.
  for (const [file, expected] of invalid) {
    it(`reports schema errors for ${file}`, async () => {
      const doc = await openFixture(file);
      const diagnostics = await waitFor(
        `diagnostics on ${file}`,
        () => {
          const found = vscode.languages.getDiagnostics(doc.uri);
          return found.length > 0 ? found : undefined;
        },
        20000
      );
      assert.ok(
        diagnostics.some((d) => expected.test(d.message)),
        `no diagnostic matching ${expected}: ${diagnostics.map((d) => d.message).join(" | ")}`
      );
    });
  }

  // The extension's own diagnostics (source "caddy") are Caddy lint, not
  // schema validation.
  it("reports caddy lint findings with their codes", async () => {
    const doc = await openScratch("lint.caddy.json", LINT_ROUTE);
    const codes = await waitFor("caddy lint diagnostics", () => {
      const found = caddyDiagnostics(doc.uri).map((d) => String(d.code));
      return found.includes("dial-url") && found.includes("duplicate-id") ? found : undefined;
    });
    assert.ok(codes.includes("dial-url"), codes.join(", "));
  });

  it("schema-invalid fixtures carry no caddy lint findings", async () => {
    // Schema errors are VS Code's ("json"); lint must not double-report them.
    const doc = await openFixture("invalid-missing-handle.caddy.json");
    await waitFor("json diagnostics", () =>
      vscode.languages.getDiagnostics(doc.uri).length > 0 ? true : undefined
    );
    assert.deepStrictEqual(
      caddyDiagnostics(doc.uri).map((d) => d.message),
      []
    );
  });

  for (const file of ["valid.caddy.json", "valid-route.caddy.json", "valid.caddy-security.json"]) {
    it(`reports no diagnostics at all for ${file}`, async () => {
      const doc = await openFixture(file);
      // Absence has no completion event: give the JSON language service
      // (and a debounced caddy pass) time to report, then assert none.
      await sleep(1500);
      assert.deepStrictEqual(
        vscode.languages.getDiagnostics(doc.uri).map((d) => `${d.source}: ${d.message}`),
        [],
        `unexpected diagnostics on ${file}`
      );
    });
  }
});

describe("completions", () => {
  async function complete(doc: vscode.TextDocument, at: vscode.Position) {
    const list = await vscode.commands.executeCommand<vscode.CompletionList>(
      "vscode.executeCompletionItemProvider",
      doc.uri,
      at
    );
    return list.items;
  }

  it('offers handler names inside "handler": "|"', async () => {
    const doc = await openScratch("handler.caddy.json", '{\n  "handle": [{ "handler": "" }]\n}\n');
    const items = await complete(doc, positionAfter(doc, '"handler": "'));
    const labels = items.map(completionLabel);
    for (const handler of ["reverse_proxy", "file_server", "static_response", "headers"]) {
      assert.ok(labels.includes(handler), `missing ${handler} in ${labels.join(", ")}`);
    }
    // Ours, not just the schema's enum: our items carry the handler's display name.
    const reverseProxy = items.find((i) => completionLabel(i) === "reverse_proxy");
    assert.strictEqual(reverseProxy?.detail, "Reverse Proxy");
  });

  it("offers matcher fields inside a match object", async () => {
    const doc = await openScratch("match.caddy.json", '{\n  "match": [{\n    \n  }]\n}\n');
    const items = await complete(doc, new vscode.Position(2, 4));
    const labels = items.map(completionLabel);
    for (const field of ["host", "path", "method", "header", "query"]) {
      assert.ok(labels.includes(field), `missing matcher ${field} in ${labels.join(", ")}`);
    }
    // In a schema-backed file VS Code's JSON service lists property names; the
    // extension must not offer them a second time (0.3.0 showed every field twice).
    const dupes = labels.filter((l, i) => labels.indexOf(l) !== i);
    assert.deepStrictEqual(dupes, [], `offered twice: ${dupes.join(", ")}`);
  });

  it("does not offer matcher fields inside a handler's nested object", async () => {
    const doc = await openScratch(
      "nested.caddy.json",
      '{\n  "match": [{ "host": ["example.com"] }],\n  "handle": [{\n    "handler": "headers",\n    "response": {\n      \n    }\n  }]\n}\n'
    );
    const items = await complete(doc, new vscode.Position(5, 6));
    const matchers = items.filter((i) => i.detail === "Matcher property").map(completionLabel);
    assert.deepStrictEqual(matchers, []);
  });
});

describe("code actions", () => {
  async function actionTitles(uri: vscode.Uri, range: vscode.Range): Promise<string[]> {
    const actions = await vscode.commands.executeCommand<Array<vscode.CodeAction | vscode.Command>>(
      "vscode.executeCodeActionProvider",
      uri,
      range
    );
    return actions.map((a) => a.title);
  }

  it('offers Change to "localhost:3000" for a URL dial', async () => {
    const doc = await openScratch("fix-dial.caddy.json", LINT_ROUTE);
    const diagnostic = await waitFor("dial-url diagnostic", () =>
      caddyDiagnostics(doc.uri).find((d) => d.code === "dial-url")
    );
    const titles = await actionTitles(doc.uri, diagnostic.range);
    assert.ok(titles.includes('Change to "localhost:3000"'), titles.join(" | "));
  });

  it('offers Did you mean "upstreams"? for an "upstream" typo', async () => {
    const doc = await openScratch(
      "fix-typo.caddy.json",
      JSON.stringify(
        {
          handle: [{ handler: "reverse_proxy", upstream: [{ dial: "localhost:3000" }] }],
        },
        null,
        2
      )
    );
    const diagnostic = await waitFor(
      "unknown-property diagnostic",
      () =>
        vscode.languages
          .getDiagnostics(doc.uri)
          .find((d) => /upstream\b.*not allowed/.test(d.message)),
      20000
    );
    const titles = await actionTitles(doc.uri, diagnostic.range);
    assert.ok(titles.includes('Did you mean "upstreams"?'), titles.join(" | "));
  });
});

describe("hover", () => {
  it("shows the handler docs on reverse_proxy", async () => {
    const doc = await openFixture("valid.caddy.json");
    const at = positionAfter(doc, '"reverse_');
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      doc.uri,
      at
    );
    const text = hoverText(hovers);
    assert.match(text, /Reverse Proxy Handler/);
    assert.match(text, /### Example/);
    assert.match(text, /localhost:3000/);
  });
});

describe("code lens", () => {
  it("adds a docs lens above each known handler", async () => {
    const doc = await openFixture("valid-route.caddy.json");
    const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      "vscode.executeCodeLensProvider",
      doc.uri,
      10
    );
    const titles = lenses.map((l) => l.command?.title ?? "");
    assert.ok(
      titles.some((t) => t.includes("Reverse Proxy Docs")),
      `titles: ${titles.join(" | ")}`
    );
    assert.ok(
      titles.some((t) => t.includes("Headers Docs")),
      `titles: ${titles.join(" | ")}`
    );
  });
});

describe("JSON snippets", () => {
  // Every contributed JSON snippet, expanded with its placeholder defaults,
  // must be valid JSON. Read from the built snippets file, so snippets added
  // later are covered automatically.
  // prefix -> reason, for snippets known to be broken (they are skipped).
  const KNOWN_BROKEN: Record<string, string> = {};

  const snippetsFile = path.join(EXTENSION_DIR, "snippets", "caddy-json.json");
  const snippets = JSON.parse(fs.readFileSync(snippetsFile, "utf-8")) as Record<
    string,
    SnippetDefinition
  >;

  for (const { prefix, body } of Object.values(snippets)) {
    const run = KNOWN_BROKEN[prefix] ? it.skip : it;
    const reason = KNOWN_BROKEN[prefix] ? ` (skipped: ${KNOWN_BROKEN[prefix]})` : "";
    run(`${prefix} expands to valid JSON${reason}`, async () => {
      const doc = await vscode.workspace.openTextDocument({ language: "json", content: "" });
      const editor = await vscode.window.showTextDocument(doc);
      const source = Array.isArray(body) ? body.join("\n") : body;
      assert.ok(await editor.insertSnippet(new vscode.SnippetString(source)));
      const text = doc.getText();
      await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
      assert.doesNotThrow(() => JSON.parse(text), `${prefix} expanded to invalid JSON:\n${text}`);
    });
  }
});
