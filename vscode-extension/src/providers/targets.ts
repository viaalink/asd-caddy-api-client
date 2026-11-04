/**
 * The running Caddy this workspace works with: found automatically, picked in
 * a list, or forced with the `caddy.adminUrl` setting. See caddy-targets.ts for
 * how Caddys are found and the order in which one is chosen.
 *
 *   status bar   "Caddy: <name>" while a Caddy file is open; click to choose
 *   command      Caddy: Choose Running Caddy
 *   settings     caddy.adminUrl (override), caddy.targets (your own list),
 *                caddy.autoDetect, caddy.allowRemoteAdmin
 */
import { execFile } from "child_process";
import { promises as fs } from "fs";
import * as vscode from "vscode";
import {
  type CaddyTarget,
  chooseTarget,
  discoverTargets,
  type DiscoveryDeps,
  isLocalAdminUrl,
} from "./caddy-targets";
import { isCaddyJsonFile } from "./file-kinds";

const PICKED = "caddy.pickedAdminUrl";

const systemDeps: DiscoveryDeps = {
  run: (command, args) =>
    new Promise((resolve) => {
      execFile(command, args, { timeout: 4000, windowsHide: true }, (err, stdout) =>
        resolve(err ? undefined : stdout)
      );
    }),
  readFile: async (file) => {
    try {
      return await fs.readFile(file, "utf8");
    } catch {
      return undefined;
    }
  },
  cwdOf: async (pid) => {
    if (process.platform === "linux") {
      try {
        return await fs.readlink(`/proc/${pid}/cwd`);
      } catch {
        return undefined;
      }
    }
    if (process.platform === "darwin") {
      const out = await systemDeps.run("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]);
      return out
        ?.split("\n")
        .find((l) => l.startsWith("n"))
        ?.slice(1);
    }
    return undefined;
  },
  probe: async (adminUrl) => {
    try {
      const res = await fetch(`${adminUrl}/config/`, {
        headers: { Origin: new URL(adminUrl).origin },
        signal: AbortSignal.timeout(1200),
      });
      // 403 is Caddy refusing this Origin: it is there, the admin `origins` need a look.
      return res.status === 200 || res.status === 403;
    } catch {
      return false;
    }
  },
  env: process.env,
  platform: process.platform,
};

export class CaddyTargets implements vscode.Disposable {
  private discovered: CaddyTarget[] | undefined;
  private current: string | undefined;
  private warnedPlainRemote = new Set<string>();
  private readonly item = vscode.window.createStatusBarItem(
    "caddy.target",
    vscode.StatusBarAlignment.Right,
    99
  );
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly state: vscode.Memento,
    private readonly deps: DiscoveryDeps = systemDeps
  ) {
    this.item.name = "Caddy: running instance";
    this.item.command = "caddy.selectTarget";
    this.disposables.push(
      this.item,
      vscode.window.onDidChangeActiveTextEditor(() => this.render()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("caddy")) {
          this.current = undefined;
          this.render();
        }
      })
    );
    this.render();
  }

  private settings(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration("caddy");
  }

  /** `caddy.adminUrl` only when the user set it somewhere; its default doesn't count. */
  private explicitAdminUrl(): string | undefined {
    const i = this.settings().inspect<string>("adminUrl");
    const value = i?.workspaceFolderValue ?? i?.workspaceValue ?? i?.globalValue;
    return value?.trim() ? value.trim() : undefined;
  }

  private configured(): CaddyTarget[] {
    const list = this.settings().get<Array<{ name?: string; adminUrl?: string }>>("targets", []);
    return list
      .filter((t): t is { name?: string; adminUrl: string } => typeof t?.adminUrl === "string")
      .map((t) => ({
        name: t.name || t.adminUrl,
        adminUrl: t.adminUrl.replace(/\/$/, ""),
        source: "configured" as const,
        detail: "caddy.targets",
      }));
  }

  private nameOf(adminUrl: string): string {
    const known = [...this.configured(), ...(this.discovered ?? [])].find(
      (t) => t.adminUrl === adminUrl
    );
    return known?.name ?? adminUrl.replace(/^https?:\/\//, "");
  }

  async scan(): Promise<CaddyTarget[]> {
    if (!this.settings().get<boolean>("autoDetect", true)) {
      this.discovered = [];
      return this.discovered;
    }
    this.discovered = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: "Looking for running Caddys" },
      () => discoverTargets(this.deps)
    );
    return this.discovered;
  }

  /**
   * The admin URL to use now, asking the user when more than one Caddy could be
   * meant. Undefined when they cancel or the address is refused.
   */
  async resolve(): Promise<string | undefined> {
    const input = () => ({
      explicitAdminUrl: this.explicitAdminUrl(),
      picked: this.state.get<string>(PICKED),
      configured: this.configured(),
      discovered: this.discovered,
    });
    let choice = chooseTarget(input());
    if (!choice.adminUrl && !this.discovered) {
      await this.scan();
      choice = chooseTarget(input());
    }
    const adminUrl = choice.adminUrl ?? (await this.pick());
    if (!adminUrl || !(await this.allowed(adminUrl))) return undefined;
    this.current = adminUrl;
    this.render();
    return adminUrl;
  }

  /** The last resolved admin URL, for views that must not prompt (the running-config document). */
  last(): string | undefined {
    return this.current;
  }

  /** Caddy: Choose Running Caddy. */
  async pick(): Promise<string | undefined> {
    type Item = vscode.QuickPickItem & {
      adminUrl?: string;
      action?: "enter" | "rescan" | "settings";
    };
    const build = async (): Promise<Item[]> => {
      const found = await this.scan();
      const items: Item[] = [];
      const explicit = this.explicitAdminUrl();
      if (explicit) {
        items.push({
          label: "$(settings-gear) caddy.adminUrl overrides the choice",
          description: explicit,
          detail: "Remove the setting to choose here or let the extension find Caddy",
          action: "settings",
        });
      }
      // The actions first: with many Caddys running they would scroll out of sight.
      items.push({ label: "$(edit) Enter an admin URL…", action: "enter" });
      items.push({ label: "$(refresh) Look again", action: "rescan" });
      const configured = this.configured();
      if (configured.length)
        items.push({
          label: "Your Caddys (caddy.targets)",
          kind: vscode.QuickPickItemKind.Separator,
        });
      for (const t of configured)
        items.push({ label: `$(server) ${t.name}`, description: t.adminUrl, adminUrl: t.adminUrl });
      items.push({ label: "Running on this machine", kind: vscode.QuickPickItemKind.Separator });
      if (!found.length)
        items.push({
          label: "$(info) No running Caddy found",
          detail: this.settings().get<boolean>("autoDetect", true)
            ? "Start one, or enter its admin URL"
            : "caddy.autoDetect is off",
        });
      for (const t of found)
        items.push({
          label: `${t.reachable ? "$(pass-filled)" : "$(circle-slash)"} ${t.name}`,
          description: t.adminUrl,
          detail: `${t.reachable ? "answers" : "does not answer"} · ${t.detail ?? t.source}`,
          adminUrl: t.adminUrl,
        });
      return items;
    };

    for (;;) {
      const picked = await vscode.window.showQuickPick(build(), {
        title: "Which running Caddy?",
        placeHolder: "Apply and Show Running Config use this Caddy in this workspace",
        matchOnDescription: true,
      });
      if (!picked) return undefined;
      if (picked.action === "rescan") continue;
      if (picked.action === "settings") {
        await vscode.commands.executeCommand("workbench.action.openSettings", "caddy.adminUrl");
        return undefined;
      }
      let adminUrl = picked.adminUrl;
      if (picked.action === "enter") {
        adminUrl = (
          await vscode.window.showInputBox({
            title: "Caddy admin URL",
            value: "http://localhost:2019",
            validateInput: (v) =>
              /^https?:\/\/[^/]+$/.test(v.trim().replace(/\/$/, ""))
                ? undefined
                : "Like http://localhost:2019",
          })
        )
          ?.trim()
          .replace(/\/$/, "");
      }
      if (!adminUrl) return undefined;
      if (!(await this.allowed(adminUrl))) return undefined;
      await this.state.update(PICKED, adminUrl);
      this.current = adminUrl;
      this.render();
      return adminUrl;
    }
  }

  /**
   * Local addresses always; others only with caddy.allowRemoteAdmin, because the
   * admin API has no authentication of its own.
   */
  private async allowed(adminUrl: string): Promise<boolean> {
    if (isLocalAdminUrl(adminUrl)) return true;
    if (!this.settings().get<boolean>("allowRemoteAdmin", false)) {
      const choice = await vscode.window.showWarningMessage(
        `${adminUrl} is not on this machine.`,
        {
          modal: true,
          detail:
            "Caddy's admin API has no login: anyone who can reach it can replace your server's config. " +
            "Reach a remote Caddy through an SSH tunnel instead (ssh -L 2019:localhost:2019 your-server, then use http://localhost:2019). " +
            "If the address really is safe to reach (a private network, or an HTTPS proxy with its own login), turn on caddy.allowRemoteAdmin.",
        },
        "Open Setting"
      );
      if (choice)
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "caddy.allowRemoteAdmin"
        );
      return false;
    }
    if (adminUrl.startsWith("http://") && !this.warnedPlainRemote.has(adminUrl)) {
      this.warnedPlainRemote.add(adminUrl);
      vscode.window.showWarningMessage(
        `${adminUrl} is a remote admin API over plain HTTP: configs, including secrets in them, travel unencrypted.`
      );
    }
    return true;
  }

  private render(): void {
    const doc = vscode.window.activeTextEditor?.document;
    const relevant =
      doc &&
      (doc.languageId === "json" || doc.languageId === "jsonc") &&
      (isCaddyJsonFile(doc.fileName) || doc.uri.scheme === "caddy-running");
    if (!relevant) {
      this.item.hide();
      return;
    }
    const explicit = this.explicitAdminUrl();
    const adminUrl = explicit ?? this.current ?? this.state.get<string>(PICKED);
    this.item.text = `$(server-process) ${adminUrl ? this.nameOf(adminUrl) : "Choose Caddy"}`;
    this.item.tooltip = adminUrl
      ? `Apply and Show Running Config use the Caddy at ${adminUrl}` +
        (explicit ? " (caddy.adminUrl setting)" : "") +
        "\nClick to choose another"
      : "Click to choose which running Caddy to use";
    this.item.show();
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
