/**
 * The running MITMproxy demo (repo-root demo/, started with `just demo start`).
 *
 * Its ports are picked per checkout by via (tpl.env → .env), so they are read
 * from the repository's .env rather than assumed.
 */

import { readFileSync } from "fs";
import { resolve } from "path";

const ENV_FILE = resolve(__dirname, "../../../.env");

function envValue(key: string): string {
  const line = readFileSync(ENV_FILE, "utf8")
    .split("\n")
    .find((l) => l.startsWith(`${key}=`));
  const value = line?.slice(key.length + 1).trim();
  if (!value) throw new Error(`${key} is not in .env — run \`just demo start\` first`);
  return value;
}

/** Where the demo's own Caddy listens on this machine. */
export function demoUrl(path = "/"): string {
  return `http://127.0.0.1:${envValue("DEMO_HTTP_PORT")}${path}`;
}

/** Put the demo in its starting state: direct routes, empty flow lists. */
export async function resetDemo(): Promise<void> {
  for (const service of ["elasticsearch", "nodeapi"]) {
    const res = await fetch(demoUrl(`/api/monitoring/disable/${service}`), { method: "POST" });
    if (!res.ok) throw new Error(`disable ${service}: HTTP ${res.status}`);
  }
  // The demo API clears both mitmweb flow lists from inside the compose network.
  const res = await fetch(demoUrl("/api/monitoring/clear"), { method: "POST" });
  if (!res.ok) throw new Error(`clear flows: HTTP ${res.status}`);
}

/** Throws unless the demo API answers through the demo Caddy. */
export async function assertDemoUp(): Promise<void> {
  const res = await fetch(demoUrl("/api/health")).catch(() => null);
  const body = res ? await res.text() : "";
  if (!body.includes('"status":"ok"')) {
    throw new Error(`MITMproxy demo is not running at ${demoUrl()} — run \`just demo start\``);
  }
}
