/**
 * Talk to a running Caddy through its admin API, using the library's own
 * CaddyClient (which also sends the explicit Origin header Caddy v2.11+
 * requires -- CVE-2026-27589).
 *
 *  - Caddy: Show Running Config      read-only view of GET /config/
 *  - Caddy: Apply File to Running Caddy
 *      caddy-server.json  -> POST /load (replaces the whole config)
 *      *.caddy.json       -> add the route(s) to a chosen HTTP server, or
 *                            replace in place when a route's @id already exists
 *
 * Every write asks for confirmation first: these change a live server.
 */

import * as vscode from "vscode";
import { CaddyClient } from "@viaalink/caddy-api-client/caddy";
import type { CaddyRoute } from "@viaalink/caddy-api-client/caddy";
import { caddyFileKind } from "./file-kinds";

import { RUNNING_CONFIG_SCHEME } from "./lazy";

function adminUrl(): string {
  return vscode.workspace
    .getConfiguration("caddy")
    .get<string>("adminUrl", "http://localhost:2019")
    .replace(/\/$/, "");
}

function client(): CaddyClient {
  return new CaddyClient({ adminUrl: adminUrl() });
}

function describeError(err: unknown): string {
  // CaddyApiError carries the admin API's status and body; matched structurally
  // so the extension doesn't bundle the library's root entry just for the class.
  if (err instanceof Error && "statusCode" in err) {
    const { statusCode, responseBody } = err as Error & {
      statusCode: number;
      responseBody?: string;
    };
    const body = responseBody?.trim();
    return `HTTP ${statusCode}${body ? `: ${body}` : ""}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/** Content for the read-only running-config view (see extension.ts). */
export async function runningConfigText(): Promise<string> {
  const config = await client().getConfig();
  return JSON.stringify(config, null, 2) + "\n";
}

export async function showRunningConfig(refresh: (uri: vscode.Uri) => void): Promise<void> {
  // The path ends in caddy-server.json so the full-config schema, hover and
  // CodeLens apply to the read-only view too.
  const uri = vscode.Uri.parse(`${RUNNING_CONFIG_SCHEME}:/running/caddy-server.json`);
  try {
    await runningConfigText(); // surface "unreachable" as a message, not an empty editor
    refresh(uri);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.languages.setTextDocumentLanguage(doc, "json");
    await vscode.window.showTextDocument(doc, { preview: false });
  } catch (err) {
    await offerAdminUrl(
      `Could not read the config from Caddy at ${adminUrl()}: ${describeError(err)}`
    );
  }
}

async function offerAdminUrl(message: string): Promise<void> {
  const choice = await vscode.window.showErrorMessage(message, "Change Admin URL");
  if (choice) {
    await vscode.commands.executeCommand("workbench.action.openSettings", "caddy.adminUrl");
  }
}

function routesIn(value: unknown): CaddyRoute[] | undefined {
  if (Array.isArray(value)) return value as CaddyRoute[];
  if (typeof value === "object" && value !== null && "handle" in value)
    return [value as CaddyRoute];
  return undefined;
}

async function applyRoutes(text: string): Promise<void> {
  let routes: CaddyRoute[] | undefined;
  try {
    routes = routesIn(JSON.parse(text) as unknown);
  } catch {
    vscode.window.showErrorMessage("This file isn't valid JSON yet — fix the errors first.");
    return;
  }
  if (!routes || routes.length === 0) {
    vscode.window.showErrorMessage(
      'Expected a route object (with "handle") or an array of routes.'
    );
    return;
  }

  const api = client();
  let servers: string[];
  try {
    servers = Object.keys(await api.getServers());
  } catch (err) {
    await offerAdminUrl(`Could not list HTTP servers at ${adminUrl()}: ${describeError(err)}`);
    return;
  }
  if (servers.length === 0) {
    vscode.window.showErrorMessage(
      "The running Caddy has no HTTP servers. Apply a caddy-server.json first."
    );
    return;
  }

  const server =
    servers.length === 1
      ? servers[0]
      : await vscode.window.showQuickPick(servers, {
          placeHolder: "Add the route(s) to which server?",
        });
  if (!server) return;

  const summary = routes
    .map((r) => (typeof r["@id"] === "string" ? r["@id"] : "(no @id)"))
    .join(", ");
  const confirm = await vscode.window.showWarningMessage(
    `Apply ${routes.length} route(s) [${summary}] to server "${server}" at ${adminUrl()}?`,
    {
      modal: true,
      detail: "Routes with an existing @id are replaced in place; others are appended.",
    },
    "Apply"
  );
  if (confirm !== "Apply") return;

  try {
    let replaced = 0;
    let added = 0;
    for (const route of routes) {
      const id = typeof route["@id"] === "string" ? route["@id"] : undefined;
      if (id && (await api.replaceRouteById(server, id, route))) {
        replaced++;
      } else {
        await api.request(`/config/apps/http/servers/${encodeURIComponent(server)}/routes`, {
          method: "POST",
          body: JSON.stringify(route),
        });
        added++;
      }
    }
    vscode.window.showInformationMessage(
      `Caddy updated: ${added} route(s) added, ${replaced} replaced on "${server}".`
    );
  } catch (err) {
    vscode.window.showErrorMessage(`Caddy rejected the route: ${describeError(err)}`);
  }
}

async function applyFullConfig(text: string): Promise<void> {
  let config: unknown;
  try {
    config = JSON.parse(text);
  } catch {
    vscode.window.showErrorMessage("This file isn't valid JSON yet — fix the errors first.");
    return;
  }
  const confirm = await vscode.window.showWarningMessage(
    `Replace the entire running config of Caddy at ${adminUrl()}?`,
    {
      modal: true,
      detail:
        "POST /load swaps the whole config atomically; Caddy keeps the old one if this fails.",
    },
    "Load Config"
  );
  if (confirm !== "Load Config") return;

  try {
    await client().applyConfig(config as Parameters<CaddyClient["applyConfig"]>[0]);
    vscode.window.showInformationMessage("Caddy loaded the new config.");
  } catch (err) {
    vscode.window.showErrorMessage(`Caddy rejected the config: ${describeError(err)}`);
  }
}

export async function applyActiveFile(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const kind = editor && caddyFileKind(editor.document.fileName);
  if (!editor || !kind) {
    vscode.window.showErrorMessage(
      "Open a caddy-server.json (full config) or *.caddy.json (route) file to apply it."
    );
    return;
  }
  const text = editor.document.getText();
  if (kind.schemaFile === "caddy-full-config.json") return applyFullConfig(text);
  if (kind.schemaFile === "caddy-route.json") return applyRoutes(text);
  vscode.window.showInformationMessage(
    `${kind.label} files are applied as part of a full config (apps.security) — paste it into caddy-server.json.`
  );
}
