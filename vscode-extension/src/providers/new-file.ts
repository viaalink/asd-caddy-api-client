/**
 * Caddy: New Config File... -- creates a correctly *named* file (the name is
 * what turns on validation, IntelliSense and lint) with a starter config from
 * the validated JSON snippets, then places the cursor on the first
 * placeholder.
 */

import * as vscode from "vscode";
import JSON_SNIPPETS from "../snippets/json-snippets.json";

const STARTERS = [
  {
    label: "$(server) Full Caddy config",
    description: "caddy-server.json",
    detail: "Admin endpoint + one HTTPS server with a proxied route. Apply with POST /load.",
    defaultName: "caddy-server.json",
    suffix: "caddy-server.json",
    snippet: "caddy-server",
  },
  {
    label: "$(arrow-swap) Route",
    description: "<name>.caddy.json",
    detail: "A single route: reverse proxy, static files, redirect...",
    defaultName: "app.caddy.json",
    suffix: ".caddy.json",
    snippet: "caddy-route",
  },
  {
    label: "$(shield) caddy-security config",
    description: "caddy-security.json",
    detail: "Local users, a login portal and an authorization policy.",
    defaultName: "caddy-security.json",
    suffix: "caddy-security.json",
    snippet: "caddy-sec-config",
  },
] as const;

export async function newConfigFile(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  const starter = await vscode.window.showQuickPick(STARTERS, {
    title: "New Caddy Config File",
    placeHolder: "What kind of Caddy config?",
  });
  if (!starter) return;

  const snippet = JSON_SNIPPETS.find((s) => s.prefix === starter.snippet);
  const body = snippet ? snippet.body.join("\n") : "{\n  $0\n}";

  if (!folder) {
    // No folder open: an untitled JSON doc still gets snippets/hover, just no schema.
    const doc = await vscode.workspace.openTextDocument({ language: "json", content: "" });
    const editor = await vscode.window.showTextDocument(doc);
    await editor.insertSnippet(new vscode.SnippetString(body));
    return;
  }

  const name = await vscode.window.showInputBox({
    title: "File name",
    value: starter.defaultName,
    valueSelection: [
      0,
      starter.defaultName.length - starter.suffix.length || starter.defaultName.length,
    ],
    prompt: `The name must end in ${starter.suffix} for validation to apply`,
    validateInput: (v) =>
      v.toLowerCase().endsWith(starter.suffix.toLowerCase())
        ? undefined
        : `Must end in ${starter.suffix}`,
  });
  if (!name) return;

  const uri = vscode.Uri.joinPath(folder.uri, name);
  try {
    await vscode.workspace.fs.stat(uri);
    vscode.window.showErrorMessage(`${name} already exists.`);
    return;
  } catch {
    // doesn't exist yet -- good
  }

  await vscode.workspace.fs.writeFile(uri, new Uint8Array());
  const editor = await vscode.window.showTextDocument(uri);
  await editor.insertSnippet(new vscode.SnippetString(body));
}
