/**
 * Compare the pins in upstreams.json with the newest upstream versions.
 *
 *   just upstreams-check                 # report
 *   just upstreams-check --json out.json # also write a machine-readable result
 *   just upstreams-check --only caddy,caddy-l4
 *
 * Exit codes: 0 all up to date, 10 updates available, 1 error.
 * Read-only: it uses `git ls-remote` and raw go.mod files, never touches local/.
 */

import { writeFileSync } from "fs";
import { formatReport, loadConfig, resolveTargets, shortRef } from "./upstreams/lib.js";

export const EXIT_UPDATES = 10;

function parseArgs(argv: string[]): { json?: string; only?: Set<string> } {
  const out: { json?: string; only?: Set<string> } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") out.json = argv[++i];
    else if (arg === "--only") out.only = new Set(argv[++i].split(",").filter(Boolean));
    else if (arg === "--help" || arg === "-h") {
      console.log("usage: check-upstreams [--json <file>] [--only name,name]");
      process.exit(0);
    } else throw new Error(`unknown argument ${arg}`);
  }
  return out;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const targets = await resolveTargets(config, new Map(), args.only);
  console.log(formatReport(targets));

  const changed = targets.filter((t) => t.changed);
  if (args.json) {
    const caddy = targets.find((t) => t.upstream.caddyBinary);
    writeFileSync(
      args.json,
      JSON.stringify(
        {
          updates: changed.length > 0,
          caddyVersion: caddy?.ref.replace(/^v/, ""),
          upstreams: targets.map((t) => ({
            name: t.upstream.name,
            pinned: shortRef(t.upstream.pin),
            latest: shortRef(t),
            commit: t.commit,
            changed: t.changed,
            kind: t.kind ?? null,
            warnings: t.warnings,
          })),
        },
        null,
        2
      ) + "\n"
    );
  }
  return changed.length > 0 ? EXIT_UPDATES : 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`check-upstreams: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
);
