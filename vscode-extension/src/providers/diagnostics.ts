/**
 * Diagnostics Provider for Caddy configurations
 *
 * Publishes Caddy-specific findings (caddy-lint.ts) under the "caddy" source:
 * duplicate @ids, unusable dial/host values, the LDAP {username} trap, and
 * references to portals/policies/stores the config doesn't define. Plain JSON
 * Schema errors are left to VS Code's built-in JSON service, which already
 * validates the contributed jsonValidation patterns -- reporting them here as
 * well would show every schema error twice.
 */

import * as vscode from "vscode";
import { lintCaddyConfig, type LintFinding } from "./caddy-lint";
import { isCaddyJsonFile } from "./file-kinds";

const MAX_FILE_SIZE = 512 * 1024; // lint is a single parse + walk; 512KB is still ~ms
const DEBOUNCE_MS = 250;

const SEVERITY: Record<LintFinding["severity"], vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
};

/** Diagnostic -> the finding it came from, so code actions can offer its fixes. */
export const findingForDiagnostic = new WeakMap<vscode.Diagnostic, LintFinding>();

export function isCaddyDocument(document: vscode.TextDocument): boolean {
  return (
    (document.languageId === "json" || document.languageId === "jsonc") &&
    isCaddyJsonFile(document.fileName)
  );
}

export class CaddyDiagnosticsProvider implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection("caddy");
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly onDidUpdateEmitter = new vscode.EventEmitter<vscode.Uri>();
  /** Fires after a document's diagnostics were recomputed. */
  readonly onDidUpdate = this.onDidUpdateEmitter.event;

  constructor(private readonly log: vscode.LogOutputChannel) {
    this.disposables.push(
      this.collection,
      this.onDidUpdateEmitter,
      vscode.workspace.onDidChangeTextDocument((e) => this.schedule(e.document)),
      vscode.workspace.onDidOpenTextDocument((doc) => this.validate(doc)),
      vscode.workspace.onDidCloseTextDocument((doc) => {
        this.cancel(doc.uri);
        this.collection.delete(doc.uri);
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("caddy.enableDiagnostics")) this.validateAll();
      })
    );
    this.validateAll();
  }

  /** Findings currently published for a document (used by the status bar). */
  count(uri: vscode.Uri): number {
    return this.collection.get(uri)?.length ?? 0;
  }

  private validateAll(): void {
    for (const doc of vscode.workspace.textDocuments) this.validate(doc);
  }

  private cancel(uri: vscode.Uri): void {
    const key = uri.toString();
    const timer = this.timers.get(key);
    if (timer) clearTimeout(timer);
    this.timers.delete(key);
  }

  private schedule(document: vscode.TextDocument): void {
    if (!isCaddyDocument(document)) return;
    this.cancel(document.uri);
    this.timers.set(
      document.uri.toString(),
      setTimeout(() => {
        this.timers.delete(document.uri.toString());
        this.validate(document);
      }, DEBOUNCE_MS)
    );
  }

  validate(document: vscode.TextDocument): void {
    if (!isCaddyDocument(document)) return;

    const enabled = vscode.workspace.getConfiguration("caddy").get("enableDiagnostics", true);
    const text = document.getText();
    if (!enabled || text.length > MAX_FILE_SIZE) {
      if (enabled) this.log.debug(`Skipping lint for ${document.fileName}: ${text.length} bytes`);
      this.collection.delete(document.uri);
      this.onDidUpdateEmitter.fire(document.uri);
      return;
    }

    const start = performance.now();
    const diagnostics = lintCaddyConfig(text).map((f) => {
      const range = new vscode.Range(document.positionAt(f.start), document.positionAt(f.end));
      const diagnostic = new vscode.Diagnostic(range, f.message, SEVERITY[f.severity]);
      diagnostic.source = "caddy";
      diagnostic.code = f.code;
      findingForDiagnostic.set(diagnostic, f);
      return diagnostic;
    });
    this.collection.set(document.uri, diagnostics);
    this.onDidUpdateEmitter.fire(document.uri);
    this.log.debug(
      `Linted ${document.fileName} in ${(performance.now() - start).toFixed(1)}ms: ${diagnostics.length} findings`
    );
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    vscode.Disposable.from(...this.disposables).dispose();
  }
}
