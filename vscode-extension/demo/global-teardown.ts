/** Stop the demo code-server and the live Caddy, and remove their port files. */

import * as fs from "fs";
import { CADDY_FILE, PORT_FILE } from "./global-setup";

export default async function globalTeardown(): Promise<void> {
  if (fs.existsSync(PORT_FILE)) fs.unlinkSync(PORT_FILE);
  if (fs.existsSync(CADDY_FILE)) fs.unlinkSync(CADDY_FILE);
  for (const proc of [globalThis.__DEMO_CODE_SERVER__, globalThis.__DEMO_CADDY__]) stop(proc);
}

function stop(proc: { pid?: number } | undefined): void {
  if (proc?.pid) {
    try {
      process.kill(-proc.pid, "SIGTERM"); // the whole process group
    } catch {
      try {
        process.kill(proc.pid, "SIGTERM");
      } catch {
        // already gone
      }
    }
  }
}
