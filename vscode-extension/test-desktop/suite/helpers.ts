/**
 * Shared helpers for the desktop VS Code integration tier.
 *
 * Fixtures are read (never written) from tests/test-files/, shared with the
 * code-server Playwright tier. Documents that need specific content are
 * written to a per-run temp directory instead.
 */

import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

export const EXTENSION_ID = "viaalink.vscode-caddy-tools";

/** tests/test-files/, from test-desktop/out/. */
export const FIXTURES_DIR = path.resolve(__dirname, "../../tests/test-files");

export const EXTENSION_DIR = path.resolve(__dirname, "../..");

let scratchDir: string | undefined;

/** A per-run temp directory for documents with test-specific content. */
export function getScratchDir(): string {
  scratchDir ??= fs.mkdtempSync(path.join(os.tmpdir(), "caddy-desktop-"));
  return scratchDir;
}

export function removeScratchDir(): void {
  if (scratchDir) fs.rmSync(scratchDir, { recursive: true, force: true });
  scratchDir = undefined;
}

export function fixtureUri(name: string): vscode.Uri {
  return vscode.Uri.file(path.join(FIXTURES_DIR, name));
}

export async function openFixture(name: string): Promise<vscode.TextDocument> {
  const doc = await vscode.workspace.openTextDocument(fixtureUri(name));
  await vscode.window.showTextDocument(doc);
  return doc;
}

/** Write `content` to a scratch file named `name` and open it. */
export async function openScratch(name: string, content: string): Promise<vscode.TextDocument> {
  const file = path.join(getScratchDir(), name);
  fs.writeFileSync(file, content);
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  await vscode.window.showTextDocument(doc);
  return doc;
}

/** Position just after the first occurrence of `marker` in `doc`. */
export function positionAfter(doc: vscode.TextDocument, marker: string): vscode.Position {
  const offset = doc.getText().indexOf(marker);
  assert.ok(offset >= 0, `marker ${JSON.stringify(marker)} not in ${doc.fileName}`);
  return doc.positionAt(offset + marker.length);
}

/** Poll `probe` until it returns a defined value, or fail after `timeoutMs`. */
export async function waitFor<T>(
  what: string,
  probe: () => T | undefined | Promise<T | undefined>,
  timeoutMs = 10000
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline)
      throw new Error(`Timed out after ${timeoutMs}ms waiting for ${what}`);
    await sleep(100);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Diagnostics this extension reported for `uri` (source "caddy"). */
export function caddyDiagnostics(uri: vscode.Uri): vscode.Diagnostic[] {
  return vscode.languages.getDiagnostics(uri).filter((d) => d.source === "caddy");
}

export function completionLabel(item: vscode.CompletionItem): string {
  return typeof item.label === "string" ? item.label : item.label.label;
}

/** Hover contents flattened to plain strings. */
export function hoverText(hovers: vscode.Hover[]): string {
  return hovers
    .flatMap((h) => h.contents)
    .map((c) => (typeof c === "string" ? c : c.value))
    .join("\n");
}

export async function closeAllEditors(): Promise<void> {
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
}
