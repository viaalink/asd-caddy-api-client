// Desktop VS Code integration tier (`just vscode-test-desktop`): runs the
// mocha suites in test-desktop/ inside a real VS Code (Electron) extension
// host with this folder loaded as the extension under development. VS Code
// is downloaded once into .vscode-test/ (gitignored).
import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  label: "desktop",
  files: "test-desktop/out/**/*.test.js",
  // Pinned: a recent stable that satisfies engines.vscode ^1.85.0. Bump deliberately.
  version: "1.143.1",
  extensionDevelopmentPath: ".",
  workspaceFolder: "./tests/test-files",
  launchArgs: [
    // Only the extension under development -- nothing from this machine.
    "--disable-extensions",
    "--disable-workspace-trust",
    "--skip-welcome",
    "--skip-release-notes",
  ],
  mocha: {
    ui: "bdd",
    timeout: 30000,
  },
});
