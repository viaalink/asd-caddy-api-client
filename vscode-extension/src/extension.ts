/**
 * VS Code extension: Caddy Configuration Tools
 */

import * as vscode from "vscode";
import { CaddyDiagnosticsProvider } from "./providers/diagnostics";
import { CaddyCodeLensProvider } from "./providers/codelens";
import { CaddyHoverProvider } from "./providers/hover";
import { CaddyCompletionProvider } from "./providers/completion";
import { CaddyCodeActionProvider } from "./providers/code-actions";
import { CaddyStatusBar } from "./providers/status-bar";
import { SimpleSchemaValidator } from "./providers/schema-validator";
import { registerCommands } from "./providers/commands";
import { liveCaddy, securityWizard, RUNNING_CONFIG_SCHEME } from "./providers/lazy";
import { CaddyTargets } from "./providers/targets";
import { newConfigFile } from "./providers/new-file";
import { runRouteWizard } from "./wizards/route-wizard";

const MENU: Array<{ label: string; detail: string; command: string }> = [
  {
    label: "$(new-file) New Config File...",
    detail: "Create caddy-server.json, a route or a security config",
    command: "caddy.newConfigFile",
  },
  {
    label: "$(wand) Route Configuration Wizard",
    detail: "Build a route step by step",
    command: "caddy.runRouteWizard",
  },
  {
    label: "$(shield) Security Configuration Wizard",
    detail: "Local/LDAP/OAuth login, portal and policy",
    command: "caddy.runSecurityWizard",
  },
  {
    label: "$(insert) Insert Route Configuration",
    detail: "Reverse proxy, files, redirect, load balancer...",
    command: "caddy.insertRoute",
  },
  {
    label: "$(lock) Insert Security Configuration",
    detail: "Identity stores, portal, policy",
    command: "caddy.insertSecurityConfig",
  },
  {
    label: "$(cloud-upload) Apply File to Running Caddy",
    detail: "POST /load, or add/replace routes via the admin API",
    command: "caddy.applyToCaddy",
  },
  {
    label: "$(server-process) Choose Running Caddy",
    detail: "Which Caddy Apply and Show Running Config talk to",
    command: "caddy.selectTarget",
  },
  {
    label: "$(eye) Show Running Config",
    detail: "Read-only view of the live config",
    command: "caddy.showRunningConfig",
  },
  {
    label: "$(book) Show Handler Documentation",
    detail: "Browse all handlers with links to caddyserver.com",
    command: "caddy.showHandlerDocs",
  },
  {
    label: "$(rocket) Get Started",
    detail: "Walkthrough of the extension",
    command: "caddy.openWalkthrough",
  },
];

export function activate(context: vscode.ExtensionContext): void {
  const startTime = performance.now();
  // LogOutputChannel: debug-level timing lines are hidden unless the user
  // raises the level ("Developer: Set Log Level..."), unlike the 0.2.0
  // "Caddy Tools Debug" channel that logged every keystroke.
  const log = vscode.window.createOutputChannel("Caddy Tools", { log: true });
  context.subscriptions.push(log);

  const jsonSelector: vscode.DocumentSelector = [{ language: "json" }, { language: "jsonc" }];
  const tsSelector: vscode.DocumentSelector = [
    { language: "typescript", scheme: "file" },
    { language: "javascript", scheme: "file" },
    { language: "typescript", scheme: "untitled" },
    { language: "javascript", scheme: "untitled" },
  ];

  const validator = new SimpleSchemaValidator(context.extensionPath, (m) => log.trace(m));
  const diagnostics = new CaddyDiagnosticsProvider(log);
  const completionProvider = new CaddyCompletionProvider(log);

  context.subscriptions.push(
    diagnostics,
    new CaddyStatusBar((uri) => diagnostics.count(uri), diagnostics.onDidUpdate),
    vscode.languages.registerCodeLensProvider(jsonSelector, new CaddyCodeLensProvider(log)),
    vscode.languages.registerHoverProvider(jsonSelector, new CaddyHoverProvider(log)),
    vscode.languages.registerCodeActionsProvider(
      jsonSelector,
      new CaddyCodeActionProvider(validator),
      CaddyCodeActionProvider.metadata
    ),
    vscode.languages.registerCompletionItemProvider(jsonSelector, completionProvider, '"'),
    vscode.languages.registerCompletionItemProvider(tsSelector, completionProvider, "."),
    vscode.commands.registerCommand("caddy.runRouteWizard", runRouteWizard),
    vscode.commands.registerCommand("caddy.runSecurityWizard", () =>
      securityWizard().runSecurityWizard()
    ),
    vscode.commands.registerCommand("caddy.newConfigFile", newConfigFile),
    vscode.commands.registerCommand("caddy.openWalkthrough", async () => {
      const category = `${context.extension.id}#gettingStarted`;
      await vscode.commands.executeCommand("workbench.action.openWalkthrough", category, false);
      // code-server's welcome page can render before extension walkthroughs are
      // registered and then falls back to its own default walkthrough. Selecting
      // ours again once the page exists lands on it (desktop VS Code: a no-op).
      await new Promise((resolve) => setTimeout(resolve, 400));
      await vscode.commands.executeCommand("workbench.action.openWalkthrough", category, false);
    }),
    vscode.commands.registerCommand("caddy.showMenu", async () => {
      const picked = await vscode.window.showQuickPick(MENU, {
        title: "Caddy",
        placeHolder: "Choose a Caddy command",
        matchOnDetail: true,
      });
      if (picked) await vscode.commands.executeCommand(picked.command);
    })
  );
  registerCommands(context);

  const runningConfigChanged = new vscode.EventEmitter<vscode.Uri>();
  const targets = new CaddyTargets(context.workspaceState);
  context.subscriptions.push(
    runningConfigChanged,
    targets,
    vscode.workspace.registerTextDocumentContentProvider(RUNNING_CONFIG_SCHEME, {
      onDidChange: runningConfigChanged.event,
      provideTextDocumentContent: async () => {
        const adminUrl = targets.last() ?? (await targets.resolve());
        return adminUrl ? liveCaddy().runningConfigText(adminUrl) : "";
      },
    }),
    vscode.commands.registerCommand("caddy.selectTarget", () => targets.pick()),
    vscode.commands.registerCommand("caddy.showRunningConfig", async () => {
      const adminUrl = await targets.resolve();
      if (adminUrl)
        await liveCaddy().showRunningConfig(adminUrl, (uri) => runningConfigChanged.fire(uri));
    }),
    vscode.commands.registerCommand("caddy.applyToCaddy", async () => {
      const adminUrl = await targets.resolve();
      if (adminUrl) await liveCaddy().applyActiveFile(adminUrl);
    })
  );

  const totalTime = performance.now() - startTime;
  log.info(`Activated in ${totalTime.toFixed(1)}ms`);
  // Kept on the console: the activation test watches for this line.
  console.log(`Caddy Configuration Tools: Activated in ${totalTime.toFixed(2)}ms`);
}

export function deactivate(): void {
  // Everything is disposed through context.subscriptions.
}
