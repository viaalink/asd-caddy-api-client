/**
 * mitmproxy addons shipped with this package (Python, in `mitmproxy-addons/`).
 *
 *   pgwire  PostgreSQL wire protocol → readable SQL, parameters, results and
 *           errors on every TCP flow (see TcpServiceRegistration)
 *
 * mitmproxyAddonPath() finds the file inside the installed package. A bundled
 * or compiled program (`bun build --compile`) has no package directory: it
 * uses mitmproxyAddonSource() or writeMitmproxyAddon() instead, which carry
 * the addon as text.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MITMPROXY_ADDON_SOURCES } from "../generated/mitmproxy-addons.js";

export type MitmproxyAddon = keyof typeof MITMPROXY_ADDON_SOURCES;

/** The addon's Python source, embedded in the library (works in any bundle). */
export function mitmproxyAddonSource(addon: MitmproxyAddon): string {
  return MITMPROXY_ADDON_SOURCES[addon];
}

/**
 * Write the addon to `dir` (created if missing) and return its path, for
 * `mitmweb -s <path>` when the package directory is not on disk, or for a
 * container that mounts `dir`.
 *
 * @example
 * ```typescript
 * const addon = writeMitmproxyAddon("pgwire", ".via/mitmproxy"); // ".via/mitmproxy/pgwire.py"
 * ```
 */
export function writeMitmproxyAddon(addon: MitmproxyAddon, dir: string): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${addon}.py`);
  writeFileSync(file, mitmproxyAddonSource(addon));
  return file;
}

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
  throw new Error(
    `mitmproxy addon "${addon}" not found next to @viaalink/caddy-api-client ` +
      `(bundled or compiled? use writeMitmproxyAddon("${addon}", dir))`
  );
}
