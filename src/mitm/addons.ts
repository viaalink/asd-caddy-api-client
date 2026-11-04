/**
 * mitmproxy addons shipped with this package (Python, in `mitmproxy-addons/`).
 *
 *   pgwire  PostgreSQL wire protocol → readable SQL, parameters, results and
 *           errors on every TCP flow (see TcpServiceRegistration)
 *
 * Node only: it resolves a file inside the installed package.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type MitmproxyAddon = "pgwire";

/**
 * Absolute path of a bundled mitmproxy addon, for `mitmweb -s <path>`.
 *
 * @example
 * ```typescript
 * const args = ["--mode", mitmproxyReverseTcpMode({ host: "postgres", port: 5432 }, 5432),
 *               "-s", mitmproxyAddonPath("pgwire")];
 * ```
 */
export function mitmproxyAddonPath(addon: MitmproxyAddon): string {
  // The bundle lives at dist/ or dist/mitm/ (or src/mitm/ in development): walk up to the package root.
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, "mitmproxy-addons", `${addon}.py`);
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error(`mitmproxy addon "${addon}" not found next to @viaalink/caddy-api-client`);
}
