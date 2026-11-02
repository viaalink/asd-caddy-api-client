/**
 * Lazily loaded parts of the extension. live-caddy (CaddyClient) and the
 * security wizard (caddy-security builders) pull in the library's Zod schemas
 * -- ~340KB of the bundle -- so they are built as separate files
 * (see the esbuild entry points in package.json) and only `require`d the
 * first time one of their commands runs, keeping activation light.
 */
import * as path from "path";

export const RUNNING_CONFIG_SCHEME = "caddy-running";

type LiveCaddy = typeof import("./live-caddy");
type SecurityWizard = typeof import("../wizards/security-wizard");

const cache = new Map<string, unknown>();

function load<T>(relative: string): T {
  let mod = cache.get(relative);
  if (!mod) {
    // A computed path keeps esbuild from inlining the module into extension.js.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require(path.join(__dirname, relative)) as unknown;
    cache.set(relative, mod);
  }
  return mod as T;
}

export const liveCaddy = (): LiveCaddy => load<LiveCaddy>("providers/live-caddy.js");
export const securityWizard = (): SecurityWizard =>
  load<SecurityWizard>("wizards/security-wizard.js");
