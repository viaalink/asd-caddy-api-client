/**
 * Which running Caddy the extension talks to.
 *
 * Caddy has no registry of running instances, so they are found the way a
 * person would find them on their own machine, then each one is asked whether
 * it answers:
 *
 *   - `caddy run` / `caddy start` processes: their `--config` file names the admin
 *     address (`admin.listen` in JSON, `admin …` in a Caddyfile's global options);
 *     without one Caddy listens on localhost:2019. This also finds the Caddys
 *     the Viaalink CLI starts per project.
 *   - Docker containers that publish Caddy's admin port 2019.
 *   - CADDY_ADMIN, and localhost:2019 itself.
 *
 * Only local Caddys are discovered. The admin API has no authentication: anyone
 * who can reach it can rewrite the server, so an address that is not on this
 * machine is refused unless `caddy.allowRemoteAdmin` is on (an SSH tunnel to
 * localhost is the safe way to reach a remote Caddy).
 *
 * No vscode import: unit tested in src/__tests__/caddy-targets.test.ts. The
 * system is reached through `DiscoveryDeps`, so tests run without processes.
 */
import * as path from "path";

export type TargetSource = "setting" | "configured" | "process" | "docker" | "env" | "default";

export interface CaddyTarget {
  /** Shown in the picker and the status bar. */
  name: string;
  /** http(s)://host:port, no trailing slash. */
  adminUrl: string;
  source: TargetSource;
  /** Where it was found: a config path, a container, a variable. */
  detail?: string;
  /** Answered GET /config/ during the last scan. */
  reachable?: boolean;
}

export const DEFAULT_ADMIN_URL = "http://localhost:2019";

/** "localhost:2019", ":2019", "127.0.0.1:2020", "tcp/[::1]:2019" → an http URL. Unix sockets → undefined. */
export function listenToUrl(listen: string): string | undefined {
  const value = listen.trim().replace(/^tcp\d?\//, "");
  if (!value || value.startsWith("unix")) return undefined;
  if (/^https?:\/\//.test(value)) return value.replace(/\/$/, "");
  const m = /^(\[[^\]]+\]|[^:]*):(\d+)$/.exec(value);
  if (!m) return undefined;
  const host = !m[1] || m[1] === "0.0.0.0" || m[1] === "[::]" ? "localhost" : m[1];
  return `http://${host}:${m[2]}`;
}

/** The admin address in a JSON config, `null` when the admin API is off, undefined for the default. */
export function adminFromJsonConfig(config: unknown): string | null | undefined {
  if (typeof config !== "object" || config === null) return undefined;
  const admin = (config as { admin?: { disabled?: boolean; listen?: string } }).admin;
  if (!admin) return undefined;
  if (admin.disabled) return null;
  return admin.listen ? (listenToUrl(admin.listen) ?? null) : undefined;
}

/** Same for a Caddyfile: the `admin` option in the global options block. */
export function adminFromCaddyfile(text: string): string | null | undefined {
  const withoutComments = text.replace(/(^|\s)#.*$/gm, "$1");
  const global = /^\s*\{([\s\S]*?)^\s*\}/m.exec(withoutComments);
  if (!global?.[1]) return undefined;
  const m = /^\s*admin(?:\s+([^\s{]+))?/m.exec(global[1]);
  if (!m) return undefined;
  if (m[1] === "off") return null;
  return m[1] ? (listenToUrl(m[1]) ?? null) : undefined;
}

export interface CaddyProcess {
  pid: number;
  config?: string;
  adapter?: string;
}

/** `ps -axo pid=,args=` (or the Windows equivalent) → the Caddy server processes in it. */
export function parseCaddyProcesses(listing: string): CaddyProcess[] {
  const found: CaddyProcess[] = [];
  for (const line of listing.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(.+)$/.exec(line);
    if (!m) continue;
    const args = splitArgs(m[2] ?? "");
    const exe = path.basename((args[0] ?? "").replace(/\\/g, "/")).toLowerCase();
    if (exe !== "caddy" && exe !== "caddy.exe") continue;
    if (args[1] !== "run" && args[1] !== "start") continue;
    const proc: CaddyProcess = { pid: Number(m[1]) };
    for (let i = 2; i < args.length; i++) {
      const arg = args[i] ?? "";
      const [flag, inline] = arg.split("=", 2) as [string, string | undefined];
      const value = inline ?? args[i + 1];
      if ((flag === "--config" || flag === "-c") && value) proc.config = value;
      if ((flag === "--adapter" || flag === "-a") && value) proc.adapter = value;
    }
    found.push(proc);
  }
  return found;
}

function splitArgs(line: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(/"([^"]*)"|(\S+)/g)) out.push(m[1] ?? m[2] ?? "");
  return out;
}

/** `docker ps --format '{{.Names}}\t{{.Ports}}'` → containers publishing the admin port 2019. */
export function parseDockerPorts(listing: string): Array<{ container: string; adminUrl: string }> {
  const found: Array<{ container: string; adminUrl: string }> = [];
  for (const line of listing.split(/\r?\n/)) {
    const [container, ports] = line.split("\t");
    if (!container || !ports) continue;
    for (const m of ports.matchAll(/(?:([\d.]+|\[[^\]]*\]|::):)?(\d+)->2019\/tcp/g)) {
      const host =
        !m[1] || m[1] === "0.0.0.0" || m[1] === "::" || m[1] === "[::]" ? "localhost" : m[1];
      found.push({ container, adminUrl: `http://${host}:${m[2]}` });
      break;
    }
  }
  return found;
}

/** A readable name for a Caddy found by its config path. */
export function nameForConfig(config: string | undefined): string {
  if (!config) return "Caddy";
  // Backslashes (Windows, or a Windows path that leaked into a Linux one) and doubled slashes.
  const norm = config.replace(/\\+/g, "/").replace(/\/{2,}/g, "/");
  // The Viaalink CLI keeps each project's Caddy under <project>/.asd/workspace/caddy/
  // (older projects: <project>/workspace/caddy/).
  const via = /([^/]+)\/(?:\.asd\/)?workspace\/caddy\//.exec(norm);
  if (via?.[1]) return `${via[1]} (Viaalink CLI)`;
  const parent = path.posix.basename(path.posix.dirname(norm));
  return parent ? `${parent}/${path.posix.basename(norm)}` : path.posix.basename(norm);
}

/** True for localhost, 127.0.0.0/8 and ::1: the admin API stays on this machine. */
export function isLocalAdminUrl(adminUrl: string): boolean {
  let host: string;
  try {
    host = new URL(adminUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "[::1]" ||
    host === "::1" ||
    /^127(\.\d{1,3}){3}$/.test(host)
  );
}

export interface DiscoveryDeps {
  /** Run a command; resolve with stdout, or undefined when it is not there or fails. */
  run(command: string, args: string[]): Promise<string | undefined>;
  readFile(file: string): Promise<string | undefined>;
  /** Working directory of a process, to resolve a relative --config (may be unknown). */
  cwdOf(pid: number): Promise<string | undefined>;
  /** Does an admin API answer at this URL? */
  probe(adminUrl: string): Promise<boolean>;
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
}

/** Every local Caddy admin API that can be found, reachable ones first. */
export async function discoverTargets(deps: DiscoveryDeps): Promise<CaddyTarget[]> {
  const candidates: CaddyTarget[] = [];

  const envAdmin = deps.env["CADDY_ADMIN"] && listenToUrl(deps.env["CADDY_ADMIN"]);
  if (envAdmin)
    candidates.push({
      name: "CADDY_ADMIN",
      adminUrl: envAdmin,
      source: "env",
      detail: "environment",
    });

  const listing =
    deps.platform === "win32"
      ? await deps.run("powershell", [
          "-NoProfile",
          "-Command",
          'Get-CimInstance Win32_Process -Filter "Name=\'caddy.exe\'" | ForEach-Object { "$($_.ProcessId) $($_.CommandLine)" }',
        ])
      : await deps.run("ps", ["-axo", "pid=,args="]);
  for (const proc of parseCaddyProcesses(listing ?? "")) {
    let adminUrl: string | null | undefined;
    let config = proc.config;
    if (config && !path.isAbsolute(config)) {
      const cwd = await deps.cwdOf(proc.pid);
      config = cwd ? path.join(cwd, config) : undefined;
    }
    if (proc.config) {
      // A config this machine can't read is usually a Caddy inside a container (its
      // process shows up here, its files don't): Docker discovery covers it, and
      // guessing localhost:2019 for it would be wrong.
      const text = config === undefined ? undefined : await deps.readFile(config);
      if (config === undefined || text === undefined) continue;
      const isJson = proc.adapter ? proc.adapter === "json" : config.endsWith(".json");
      if (isJson) {
        try {
          adminUrl = adminFromJsonConfig(JSON.parse(text) as unknown);
        } catch {
          adminUrl = undefined;
        }
      } else if (!proc.adapter || proc.adapter === "caddyfile") {
        adminUrl = adminFromCaddyfile(text);
      }
    }
    if (adminUrl === null) continue; // admin API switched off, or on a unix socket
    candidates.push({
      name: nameForConfig(config ?? proc.config),
      adminUrl: adminUrl ?? DEFAULT_ADMIN_URL,
      source: "process",
      detail: `pid ${proc.pid}${proc.config ? ` · ${proc.config}` : ""}`,
    });
  }

  const docker = await deps.run("docker", ["ps", "--format", "{{.Names}}\t{{.Ports}}"]);
  for (const { container, adminUrl } of parseDockerPorts(docker ?? "")) {
    candidates.push({
      name: `${container} (Docker)`,
      adminUrl,
      source: "docker",
      detail: container,
    });
  }

  candidates.push({ name: "localhost:2019", adminUrl: DEFAULT_ADMIN_URL, source: "default" });

  // One entry per address (the first, most specific name wins), then ask each one.
  const unique = new Map<string, CaddyTarget>();
  for (const c of candidates) {
    const key = normalise(c.adminUrl);
    if (!unique.has(key)) unique.set(key, { ...c, adminUrl: key });
  }
  const targets = [...unique.values()];
  await Promise.all(
    targets.map(async (t) => {
      t.reachable = await deps.probe(t.adminUrl);
    })
  );
  // The default only counts when something answers there.
  return targets
    .filter((t) => t.source !== "default" || t.reachable)
    .sort((a, b) => Number(b.reachable) - Number(a.reachable));
}

function normalise(adminUrl: string): string {
  return adminUrl.replace(/\/$/, "").replace("://127.0.0.1:", "://localhost:");
}

export interface Choice {
  /** The admin URL to use, or undefined when the user has to pick. */
  adminUrl?: string;
  /** Why this one: shown in the status bar tooltip. */
  reason: string;
}

/**
 * Which Caddy to use, in order:
 *   1. `caddy.adminUrl` set by the user (the override: no discovery),
 *   2. the one picked earlier in this workspace,
 *   3. the only entry in `caddy.targets`,
 *   4. the only Caddy that answers,
 *   5. otherwise: ask (undefined), or localhost:2019 when nothing answers.
 */
export function chooseTarget(input: {
  explicitAdminUrl?: string;
  picked?: string;
  configured: CaddyTarget[];
  discovered?: CaddyTarget[];
}): Choice {
  if (input.explicitAdminUrl)
    return {
      adminUrl: input.explicitAdminUrl.replace(/\/$/, ""),
      reason: "caddy.adminUrl setting",
    };
  if (input.picked) return { adminUrl: input.picked, reason: "picked in this workspace" };
  if (input.configured.length === 1 && input.configured[0])
    return { adminUrl: input.configured[0].adminUrl, reason: "caddy.targets" };
  if (input.configured.length > 1) return { reason: "several in caddy.targets" };
  if (!input.discovered) return { reason: "not scanned yet" };
  const live = input.discovered.filter((t) => t.reachable);
  if (live.length === 1 && live[0])
    return { adminUrl: live[0].adminUrl, reason: `found: ${live[0].name}` };
  if (live.length > 1) return { reason: `${live.length} running Caddys found` };
  return { adminUrl: DEFAULT_ADMIN_URL, reason: "no running Caddy found" };
}
