/**
 * Quick fixes for Caddy configs:
 *  - every caddy-lint finding that carries fixes (dial URL/port, host format,
 *    LDAP %s placeholder, unknown policy/portal/store name)
 *  - "Did you mean ...?" for unknown properties -- for VS Code's own JSON
 *    schema diagnostics ("Property upstream is not allowed.") as well, using
 *    the extension's schema validator to know which names ARE allowed there.
 */

import * as vscode from "vscode";
import { findNodeAtOffset, getNodePath, parseTree, type Node } from "jsonc-parser";
import { closestMatches } from "./caddy-lint";
import { findingForDiagnostic, isCaddyDocument } from "./diagnostics";
import type { SimpleSchemaValidator } from "./schema-validator";

const UNKNOWN_PROPERTY = /^(?:Property (\S+) is not allowed|Unexpected property: (\S+))/;

/** jsonc-parser path -> the validator's "a.b[0].c" error path format. */
function toValidatorPath(segments: Array<string | number>): string {
  return segments
    .map((s, i) => (typeof s === "number" ? `[${s}]` : i === 0 ? s : `.${s}`))
    .join("");
}

export class CaddyCodeActionProvider implements vscode.CodeActionProvider {
  static readonly metadata: vscode.CodeActionProviderMetadata = {
    providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
  };

  constructor(private readonly validator: SimpleSchemaValidator) {}

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    if (!isCaddyDocument(document)) return [];
    const actions: vscode.CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      const finding = findingForDiagnostic.get(diagnostic);
      if (finding) {
        finding.fixes.forEach((fix, i) => {
          actions.push(
            this.replace(document, diagnostic, diagnostic.range, fix.title, fix.newText, i === 0)
          );
        });
        continue;
      }

      const unknown = UNKNOWN_PROPERTY.exec(diagnostic.message);
      if (unknown) {
        const name = (unknown[1] ?? unknown[2]).replace(/^"|"$/g, "");
        actions.push(...this.didYouMean(document, diagnostic, name));
      }
    }
    return actions;
  }

  private didYouMean(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic,
    name: string
  ): vscode.CodeAction[] {
    const schema = this.validator.getSchemaForFile(document.fileName);
    const text = document.getText();
    const root = parseTree(text);
    if (!schema || !root) return [];

    const node = findNodeAtOffset(root, document.offsetAt(diagnostic.range.start) + 1);
    const keyNode = this.propertyKeyNode(node, name);
    if (!keyNode) return [];

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return []; // half-typed document: no reliable "allowed" list yet
    }
    const path = toValidatorPath(getNodePath(keyNode));
    const error = this.validator
      .validate(data, schema)
      .find((e) => e.keyword === "additionalProperties" && e.path === path);
    const suggestions = closestMatches(name, error?.allowed ?? []);

    const keyRange = new vscode.Range(
      document.positionAt(keyNode.offset),
      document.positionAt(keyNode.offset + keyNode.length)
    );
    return suggestions.map((s, i) =>
      this.replace(
        document,
        diagnostic,
        keyRange,
        `Did you mean "${s}"?`,
        JSON.stringify(s),
        i === 0
      )
    );
  }

  /** The key node of the property named `name` at/around `node`. */
  private propertyKeyNode(node: Node | undefined, name: string): Node | undefined {
    for (let n = node; n; n = n.parent) {
      if (n.type === "property" && n.children?.[0]?.value === name) return n.children[0];
      if (n.type === "string" && n.value === name && n.parent?.type === "property") {
        return n.parent.children?.[0] === n ? n : undefined;
      }
    }
    return undefined;
  }

  private replace(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic,
    range: vscode.Range,
    title: string,
    newText: string,
    preferred: boolean
  ): vscode.CodeAction {
    const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
    action.edit = new vscode.WorkspaceEdit();
    action.edit.replace(document.uri, range, newText);
    action.diagnostics = [diagnostic];
    action.isPreferred = preferred;
    return action;
  }
}
