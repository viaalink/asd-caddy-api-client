/**
 * The live Caddy started by global-setup.ts for the "apply to running Caddy"
 * scene: its admin and HTTP ports, or null when no caddy binary was found.
 */

import { existsSync, readFileSync } from "fs";
import { CADDY_FILE } from "../global-setup";

export interface LiveCaddy {
  admin: number;
  http: number;
}

export function liveCaddy(): LiveCaddy | null {
  if (!existsSync(CADDY_FILE)) return null;
  return JSON.parse(readFileSync(CADDY_FILE, "utf8")) as LiveCaddy;
}
