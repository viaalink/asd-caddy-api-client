/**
 * Which Caddy config a file holds, from its name. Mirrors package.json's
 * `contributes.jsonValidation` globs exactly, so the status bar, our
 * diagnostics and VS Code's built-in schema validation always agree on what a
 * file is. (getSchemaForFile used to have its own looser substring rules and
 * no entry at all for caddy-server.json / caddy-full.json.)
 *
 * No vscode import: unit tested in src/__tests__/file-kinds.test.ts.
 */
import * as path from "path";

export interface CaddyFileKind {
  /** Schema file name under schemas/. */
  schemaFile: string;
  /** Short label for the status bar. */
  label: string;
  /** Where this JSON goes in a running Caddy. */
  description: string;
}

const KINDS: Array<{ names: string[]; suffix: string; kind: CaddyFileKind }> = [
  {
    names: ["caddy-server.json", "caddy-full.json"],
    suffix: ".caddy-server.json",
    kind: {
      schemaFile: "caddy-full-config.json",
      label: "Caddy Config",
      description: "Complete Caddy config (POST /load)",
    },
  },
  {
    names: ["caddy.json", "caddy-config.json"],
    suffix: ".caddy.json",
    kind: {
      schemaFile: "caddy-route.json",
      label: "Caddy Route",
      description: "HTTP route (apps.http.servers.<name>.routes[])",
    },
  },
  {
    names: [".caddy-security-portal.json", "caddy-security-portal.json"],
    suffix: ".caddy-security-portal.json",
    kind: {
      schemaFile: "caddy-security-portal.json",
      label: "Auth Portal",
      description: "caddy-security authentication portal",
    },
  },
  {
    names: [".caddy-security-policy.json", "caddy-security-policy.json"],
    suffix: ".caddy-security-policy.json",
    kind: {
      schemaFile: "caddy-security-policy.json",
      label: "Auth Policy",
      description: "caddy-security authorization policy",
    },
  },
  {
    names: [".caddy-security.json", "caddy-security.json", "security-config.json"],
    suffix: ".caddy-security.json",
    kind: {
      schemaFile: "caddy-security-config.json",
      label: "Caddy Security",
      description: "caddy-security config (apps.security.config)",
    },
  },
];

export function caddyFileKind(fileName: string): CaddyFileKind | undefined {
  const base = path.basename(fileName).toLowerCase();
  // Most specific suffix first: "x.caddy-security-portal.json" also ends in ".json"
  // and must not fall through to a broader kind.
  for (const { names, suffix, kind } of KINDS) {
    if (names.includes(base) || base.endsWith(suffix)) return kind;
  }
  return undefined;
}

/**
 * Looser check for features that help in any Caddy JSON (hover, CodeLens,
 * lint): a recognised kind, or "caddy" anywhere in the file name.
 */
export function isCaddyJsonFile(fileName: string): boolean {
  return caddyFileKind(fileName) !== undefined || /caddy/i.test(path.basename(fileName));
}
