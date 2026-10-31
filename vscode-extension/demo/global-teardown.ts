/** Stop the demo code-server and remove its port file. */

import * as fs from "fs";
import { PORT_FILE } from "./global-setup";

export default async function globalTeardown(): Promise<void> {
  if (fs.existsSync(PORT_FILE)) fs.unlinkSync(PORT_FILE);
  const proc = globalThis.__DEMO_CODE_SERVER__;
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
