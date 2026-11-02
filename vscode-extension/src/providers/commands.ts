/**
 * Command Handlers for Caddy extension
 *
 * Provides command palette commands for common Caddy configuration tasks.
 */

import * as vscode from "vscode";
import { HANDLER_METADATA } from "@viaalink/caddy-api-client/extension-assets";
import JSON_SNIPPETS from "../snippets/json-snippets.json";

const CADDY_DOCS_BASE = "https://caddyserver.com";

export function registerCommands(context: vscode.ExtensionContext): void {
  // Show handler documentation
  const showHandlerDocs = vscode.commands.registerCommand("caddy.showHandlerDocs", async () => {
    const handlers = Object.values(HANDLER_METADATA);

    const selected = await vscode.window.showQuickPick(
      handlers.map((h) => ({
        label: h.displayName,
        description: h.name,
        detail: h.description,
        handler: h,
      })),
      {
        placeHolder: "Select a handler to view documentation",
        matchOnDescription: true,
        matchOnDetail: true,
      }
    );

    if (selected) {
      const docsUrl = selected.handler.caddyDocsPath.startsWith("http")
        ? selected.handler.caddyDocsPath
        : `${CADDY_DOCS_BASE}${selected.handler.caddyDocsPath}`;

      vscode.env.openExternal(vscode.Uri.parse(docsUrl));
    }
  });

  // Insert route / security configuration. Both pick from the same
  // validated snippet source as the contributed JSON snippets
  // (src/snippets/json-snippets.json), so the commands can't drift from them.
  const insertRoute = vscode.commands.registerCommand("caddy.insertRoute", () =>
    insertFromGroup("route", "Select route type to insert")
  );

  const insertSecurityConfig = vscode.commands.registerCommand("caddy.insertSecurityConfig", () =>
    insertFromGroup("security", "Select security configuration to insert")
  );

  context.subscriptions.push(showHandlerDocs, insertRoute, insertSecurityConfig);
}

async function insertFromGroup(group: string, placeHolder: string): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage("Open a JSON file first, then run this command again.");
    return;
  }

  const picked = await vscode.window.showQuickPick(
    JSON_SNIPPETS.filter((s) => s.group === group).map((s) => ({
      label: s.label,
      description: s.prefix,
      detail: s.description,
      body: s.body,
    })),
    { placeHolder, matchOnDescription: true, matchOnDetail: true }
  );

  if (picked) {
    await editor.insertSnippet(new vscode.SnippetString(picked.body.join("\n")));
  }
}
