/**
 * Status bar item for Caddy files: which config kind/schema the file is
 * validated as, plus the number of Caddy findings. Clicking opens the Caddy
 * command menu. Hidden for every other file.
 */

import * as vscode from "vscode";
import { caddyFileKind, isCaddyJsonFile } from "./file-kinds";

export class CaddyStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(
    "caddy.status",
    vscode.StatusBarAlignment.Right,
    100
  );
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly countFindings: (uri: vscode.Uri) => number,
    onDidUpdate: vscode.Event<vscode.Uri>
  ) {
    this.item.name = "Caddy";
    this.item.command = "caddy.showMenu";
    this.disposables.push(
      this.item,
      vscode.window.onDidChangeActiveTextEditor(() => this.update()),
      onDidUpdate((uri) => {
        if (vscode.window.activeTextEditor?.document.uri.toString() === uri.toString())
          this.update();
      })
    );
    this.update();
  }

  update(): void {
    const doc = vscode.window.activeTextEditor?.document;
    if (
      !doc ||
      (doc.languageId !== "json" && doc.languageId !== "jsonc") ||
      !isCaddyJsonFile(doc.fileName)
    ) {
      this.item.hide();
      return;
    }

    const kind = caddyFileKind(doc.fileName);
    const findings = this.countFindings(doc.uri);
    const label = kind?.label ?? "Caddy";
    this.item.text = findings > 0 ? `$(warning) ${label}: ${findings}` : `$(check) ${label}`;

    const md = new vscode.MarkdownString(undefined, true);
    md.appendMarkdown(`**${label}**\n\n`);
    md.appendMarkdown(
      kind
        ? `${kind.description}  \nValidated against \`${kind.schemaFile}\`\n\n`
        : `No schema for this file name — rename it to \`*.caddy.json\`, \`caddy-server.json\` or \`caddy-security.json\` for validation.\n\n`
    );
    md.appendMarkdown(
      findings > 0 ? `${findings} Caddy finding(s) — see Problems\n\n` : `No Caddy findings\n\n`
    );
    md.appendMarkdown(`_Click for Caddy commands_`);
    this.item.tooltip = md;
    this.item.show();
  }

  dispose(): void {
    vscode.Disposable.from(...this.disposables).dispose();
  }
}
