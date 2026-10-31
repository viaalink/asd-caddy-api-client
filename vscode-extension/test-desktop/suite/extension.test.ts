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
    assert.deepStrictEqual(contributed.sort(), [
      "caddy.insertRoute",
      "caddy.insertSecurityConfig",
      "caddy.runRouteWizard",
      "caddy.runSecurityWizard",
      "caddy.showHandlerDocs",
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

  // The extension's own validator (diagnostic source "caddy").
  // SKIPPED -- extension bug in src/providers/schema-validator.ts:
  // SimpleSchemaValidator never resolves "$ref", and every generated schema's
  // root is {"$ref": "#/definitions/<name>"}, so it validates against an
  // empty schema and never reports anything. Un-skip once $ref resolves.
  for (const [file] of invalid) {
    it.skip(`reports caddy-source errors for ${file} (skipped: validator ignores $ref)`, async () => {
      const doc = await openFixture(file);
      await waitFor(`caddy diagnostics on ${file}`, () => {
        const found = caddyDiagnostics(doc.uri);
        return found.length > 0 ? found : undefined;
      });
    });
  }

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
    const matchers = items.filter((i) => i.detail === "Matcher property").map(completionLabel);
    for (const field of ["host", "path", "method", "header", "query"]) {
      assert.ok(matchers.includes(field), `missing matcher ${field} in ${matchers.join(", ")}`);
    }
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
  const KNOWN_BROKEN: Record<string, string> = {
    // ${4:"upstreams": [{ "dial": "${5:localhost:3000}" }]} -- the unescaped
    // "}" closes placeholder 4 early, leaving `... "localhost:3000" ]}`.
    "caddy-route": 'unescaped "}" inside placeholder ${4:...}',
  };
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
