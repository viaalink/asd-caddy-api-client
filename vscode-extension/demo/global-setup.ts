/**
 * Start a camera-ready code-server for the demo recording.
 *
 * Adapted from tests/global-setup.ts (same code-server binary, same
 * build-and-install-the-vsix step, same random port + port file), but fully
 * isolated from the test suite: its own user-data dir, its own extensions dir
 * and its own seeded workspace, all under vscode-extension/local/video/ and
 * all recreated on every run. A recording therefore never inherits state from
 * a test run (or a previous recording), and `just vscode-test` never sees any
 * of this.
 *
 * What makes it "camera-ready" is the settings block below: dark theme, a
 * larger editor font, no minimap, no welcome page, no telemetry or release
 * notes, no AI/chat chrome.
 */

import { spawn, execSync, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as net from "net";
import * as path from "path";

declare global {
  var __DEMO_CODE_SERVER__: ChildProcess | undefined;
  var __DEMO_CADDY__: ChildProcess | undefined;
}

const EXT_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(EXT_ROOT, "..");
export const DEMO_ROOT = path.join(EXT_ROOT, "local", "video");
export const PORT_FILE = path.join(__dirname, ".codeserver-port");

/** Where the live Caddy's ports are written for the storyboard (see lib/live.ts). */
export const CADDY_FILE = path.join(__dirname, ".caddy-ports.json");

/** The real Caddy the "apply to running Caddy" scene talks to. */
const CADDY_BIN =
  process.env["CADDY_BIN"] ?? path.join(process.env["HOME"] ?? "", ".local/bin/caddy");

/** The folder name shows in the explorer title, so it is chosen for the camera. */
export const WORKSPACE_NAME = "my-gateway";

const CODE_SERVER_BIN = path.join(REPO_ROOT, ".asd/workspace/code/code-server/bin/code-server");

/** Settings that make code-server look good on camera. */
const SETTINGS: Record<string, unknown> = {
  "workbench.colorTheme": "Default Dark Modern",
  "workbench.startupEditor": "none",
  "workbench.tips.enabled": false,
  "workbench.welcomePage.walkthroughs.openOnInstall": false,
  "workbench.editor.enablePreview": false,
  "workbench.layoutControl.enabled": false,
  "workbench.secondarySideBar.defaultVisibility": "hidden",
  "window.commandCenter": false,
  "chat.commandCenter.enabled": false,
  "chat.disableAIFeatures": true,
  "editor.fontSize": 15,
  "editor.lineHeight": 24,
  "editor.minimap.enabled": false,
  "editor.stickyScroll.enabled": false,
  "editor.cursorBlinking": "smooth",
  "editor.cursorSmoothCaretAnimation": "on",
  "editor.smoothScrolling": true,
  "editor.hover.delay": 250,
  "editor.renderLineHighlight": "line",
  "editor.guides.indentation": true,
  "editor.formatOnType": false,
  "editor.inlineSuggest.enabled": false,
  "editor.lightbulb.enabled": "off",
  "editor.occurrencesHighlight": "off",
  "editor.selectionHighlight": false,
  "editor.wordBasedSuggestions": "off",
  "editor.suggest.showWords": false,
  "editor.suggest.preview": false,
  "editor.suggestSelection": "first",
  "editor.acceptSuggestionOnEnter": "on",
  "breadcrumbs.enabled": false,
  "explorer.compactFolders": false,
  "explorer.confirmDragAndDrop": false,
  "files.autoSave": "off",
  "files.hotExit": "off",
  "files.insertFinalNewline": true,
  "git.enabled": false,
  "scm.diffDecorations": "none",
  "telemetry.telemetryLevel": "off",
  "update.mode": "none",
  "update.showReleaseNotes": false,
  "extensions.autoUpdate": false,
  "extensions.autoCheckUpdates": false,
  "extensions.ignoreRecommendations": true,
  "security.workspace.trust.enabled": false,
  "typescript.disableAutomaticTypeAcquisition": true,
  "typescript.surveys.enabled": false,
  "npm.fetchOnlinePackageInfo": false,
  "terminal.integrated.enablePersistentSessions": false,
  // DOM renderer: crisp in the screencast, and its text is assertable.
  "terminal.integrated.gpuAcceleration": "off",
  "terminal.integrated.fontSize": 15,
  // A clean prompt: no user name, host name or home path in a public video.
  "terminal.integrated.profiles.linux": {
    demo: {
      path: "bash",
      args: ["--norc", "--noprofile"],
      env: { PS1: "\\[\\e[36m\\]my-gateway\\[\\e[0m\\] $ " },
    },
  },
  "terminal.integrated.defaultProfile.linux": "demo",
  "terminal.integrated.showExitAlert": false,
  // JSON quick-suggests inside strings, so typing a value ("api.example.com")
  // pops a list of unrelated snippets over the shot. Explicit Ctrl+Space and
  // the '"' trigger character still work.
  "[json]": { "editor.quickSuggestions": { strings: "off", comments: "off", other: "on" } },
};

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const address = server.address();
      if (address && typeof address === "object") {
        server.close(() => resolve(address.port));
      } else {
        reject(new Error("Could not get port"));
      }
    });
    server.on("error", reject);
  });
}

/** A port that is free right now, preferring a memorable one for the camera. */
async function portPreferring(preferred: number): Promise<number> {
  const free = await new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(preferred, "127.0.0.1", () => server.close(() => resolve(true)));
  });
  return free ? preferred : findFreePort();
}

/**
 * Start a throwaway Caddy: admin API on one port, one empty HTTP server on
 * another. The live-apply scene adds a route to it and curls it. Skipped (and
 * the scene with it) when there is no caddy binary.
 */
async function startCaddy(): Promise<{ admin: number; http: number } | null> {
  fs.rmSync(CADDY_FILE, { force: true });
  if (!fs.existsSync(CADDY_BIN)) {
    console.warn(`⚠️  no caddy at ${CADDY_BIN} — the live-apply scene will fail; set CADDY_BIN`);
    return null;
  }
  const admin = await portPreferring(2019);
  const http = await portPreferring(8080);
  const config = {
    admin: { listen: `localhost:${admin}` },
    apps: {
      http: {
        servers: {
          srv0: { listen: [`:${http}`], automatic_https: { disable: true }, routes: [] },
        },
      },
    },
  };
  const configFile = path.join(DEMO_ROOT, "caddy.json");
  fs.writeFileSync(configFile, JSON.stringify(config));
  const caddy = spawn(CADDY_BIN, ["run", "--config", configFile], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      XDG_DATA_HOME: path.join(DEMO_ROOT, "caddy-data"),
      XDG_CONFIG_HOME: path.join(DEMO_ROOT, "caddy-config"),
    },
  });
  globalThis.__DEMO_CADDY__ = caddy;
  await waitForServer(`http://localhost:${admin}/config/`, 15000, `http://localhost:${admin}`);
  fs.writeFileSync(CADDY_FILE, JSON.stringify({ admin, http }));
  console.log(`✅ live Caddy: admin :${admin}, http :${http}`);
  return { admin, http };
}

async function waitForServer(url: string, timeout = 30000, origin?: string): Promise<void> {
  const start = Date.now();
  let delay = 100;
  while (Date.now() - start < timeout) {
    try {
      // Caddy ≥ 2.11 rejects admin requests without a matching Origin (CVE-2026-27589).
      const response = await fetch(url, origin ? { headers: { Origin: origin } } : undefined);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, 2000);
  }
  throw new Error(`${url} did not come up within ${timeout}ms`);
}

/** Newest `vscode-caddy-tools-x.y.z.vsix` by numeric semver (see tests/global-setup.ts). */
function findLatestVsix(): string | null {
  const parse = (f: string): number[] =>
    (f.match(/(\d+)\.(\d+)\.(\d+)/)?.slice(1) ?? ["0", "0", "0"]).map(Number);
  const files = fs
    .readdirSync(EXT_ROOT)
    .filter((f) => f.endsWith(".vsix"))
    .sort((a, b) => {
      const [pa, pb] = [parse(a), parse(b)];
      for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
      return 0;
    });
  const last = files.pop();
  return last ? path.join(EXT_ROOT, last) : null;
}

/** Copy the committed seed workspace to a fresh, throwaway location. */
function seedWorkspace(target: string): void {
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(path.join(__dirname, "seed"), target, { recursive: true });
}

export default async function globalSetup(): Promise<void> {
  if (!fs.existsSync(CODE_SERVER_BIN)) {
    throw new Error(
      `code-server not found at ${CODE_SERVER_BIN} — run \`just vscode-test\` once (it installs it) or symlink it.`
    );
  }

  // A recording must show the extension as it is NOW, so always rebuild unless
  // explicitly told to reuse the vsix (CADDY_DEMO_REUSE_VSIX=1, for iterating
  // on the storyboard without touching the extension).
  let vsix = findLatestVsix();
  if (!vsix || process.env["CADDY_DEMO_REUSE_VSIX"] !== "1") {
    console.log("📦 Building extension vsix...");
    execSync("npm run package", { cwd: EXT_ROOT, stdio: "inherit" });
    vsix = findLatestVsix();
  }
  if (!vsix) throw new Error("no .vsix in vscode-extension/ after `npm run package`");

  const userDataDir = path.join(DEMO_ROOT, "code-data");
  const extensionsDir = path.join(DEMO_ROOT, "code-extensions");
  const workspace = path.join(DEMO_ROOT, "workspace", WORKSPACE_NAME);
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.rmSync(extensionsDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(userDataDir, "User"), { recursive: true });
  fs.mkdirSync(DEMO_ROOT, { recursive: true });
  const caddy = await startCaddy();
  fs.mkdirSync(extensionsDir, { recursive: true });
  fs.writeFileSync(
    path.join(userDataDir, "User", "settings.json"),
    JSON.stringify(
      caddy ? { ...SETTINGS, "caddy.adminUrl": `http://localhost:${caddy.admin}` } : SETTINGS,
      null,
      2
    )
  );
  seedWorkspace(workspace);

  console.log(`📦 Installing ${path.basename(vsix)}...`);
  execSync(
    `"${CODE_SERVER_BIN}" --install-extension "${vsix}" --extensions-dir "${extensionsDir}" --user-data-dir "${userDataDir}"`,
    { stdio: "inherit" }
  );

  const port = await findFreePort();
  fs.writeFileSync(PORT_FILE, String(port));

  const codeServer = spawn(
    CODE_SERVER_BIN,
    [
      "--bind-addr",
      `127.0.0.1:${port}`,
      "--auth",
      "none",
      "--disable-telemetry",
      "--disable-update-check",
      "--disable-workspace-trust",
      "--disable-getting-started-override",
      "--extensions-dir",
      extensionsDir,
      "--user-data-dir",
      userDataDir,
      workspace,
    ],
    { detached: true, stdio: "pipe", env: { ...process.env, DISABLE_TELEMETRY: "true" } }
  );
  globalThis.__DEMO_CODE_SERVER__ = codeServer;
  codeServer.stderr?.on("data", (d: Buffer) => {
    if (process.env["DEBUG"]) console.error(`[code-server] ${d.toString()}`);
  });

  const url = `http://127.0.0.1:${port}`;
  await waitForServer(url);
  console.log(`✅ demo code-server ready at ${url}`);
}
