/**
 * Caddy-specific checks that a JSON Schema can't express: things Caddy (or
 * caddy-security) only rejects -- or silently mishandles -- when the config is
 * loaded. VS Code's built-in JSON service already reports schema errors for
 * the contributed `jsonValidation` file patterns, so these complement it
 * rather than duplicate it.
 *
 * Pure (jsonc-parser only, no vscode import): unit tested directly in
 * src/__tests__/caddy-lint.test.ts.
 */

import { parseTree, type Node } from "jsonc-parser";

export type LintSeverity = "error" | "warning" | "info";

export interface LintFix {
  title: string;
  /** Replacement for the full [start, end) range of the finding. */
  newText: string;
}

export interface LintFinding {
  start: number;
  end: number;
  message: string;
  severity: LintSeverity;
  code: string;
  fixes: LintFix[];
}

/** Collections whose items are referenced by `name` elsewhere in a config. */
const DEFINITION_KEYS = {
  authorization_policies: "policy",
  authentication_portals: "portal",
  identity_stores: "identity store",
  identity_providers: "identity provider",
} as const;

type DefinitionKey = keyof typeof DEFINITION_KEYS;

interface PropertyVisit {
  key: string;
  keyNode: Node;
  value: Node;
  /** Property keys from the root down to (not including) this one. */
  ancestors: string[];
}

function eachProperty(root: Node, visit: (p: PropertyVisit) => void): void {
  const walk = (node: Node, ancestors: string[]): void => {
    if (node.type === "object") {
      for (const prop of node.children ?? []) {
        const [keyNode, value] = prop.children ?? [];
        if (!keyNode || !value || typeof keyNode.value !== "string") continue;
        const key = keyNode.value;
        visit({ key, keyNode, value, ancestors });
        walk(value, [...ancestors, key]);
      }
    } else if (node.type === "array") {
      for (const child of node.children ?? []) walk(child, ancestors);
    }
  };
  walk(root, []);
}

function stringValue(node: Node | undefined): string | undefined {
  return node?.type === "string" && typeof node.value === "string" ? node.value : undefined;
}

function finding(
  node: Node,
  severity: LintSeverity,
  code: string,
  message: string,
  fixes: LintFix[] = []
): LintFinding {
  return { start: node.offset, end: node.offset + node.length, severity, code, message, fixes };
}

function quoted(text: string): string {
  return JSON.stringify(text);
}

/** Levenshtein distance, for "did you mean" suggestions. */
export function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** Closest candidates to `word`, best first; at most `limit`. */
export function closestMatches(word: string, candidates: Iterable<string>, limit = 3): string[] {
  const maxDistance = Math.max(2, Math.floor(word.length / 3));
  return [...new Set(candidates)]
    .map((c) => ({ c, d: editDistance(word.toLowerCase(), c.toLowerCase()) }))
    .filter(({ c, d }) => c !== word && d <= maxDistance)
    .sort((x, y) => x.d - y.d || x.c.localeCompare(y.c))
    .slice(0, limit)
    .map(({ c }) => c);
}

const URL_RE = /^(https?):\/\/([^/?#]+)/i;

function checkDial(value: Node, findings: LintFinding[]): void {
  const dial = stringValue(value);
  if (dial === undefined || dial.includes("{")) return; // placeholders resolve at runtime
  // A unix socket has a path, not a port. Same networks as the library's DialAddressSchema.
  const unix = /^(unix|unix\+h2c|unixgram|unixpacket)\/(.*)$/.exec(dial);
  if (unix) {
    if (!unix[2]) {
      findings.push(
        finding(
          value,
          "error",
          "dial-unix-path",
          `"dial" address "${dial}" names no socket path. Write it as "${unix[1]}//path/to/app.sock".`,
          []
        )
      );
    }
    return;
  }

  const url = URL_RE.exec(dial);
  if (url) {
    const scheme = url[1].toLowerCase();
    const hostPort = url[2].includes(":") ? url[2] : `${url[2]}:${scheme === "https" ? 443 : 80}`;
    findings.push(
      finding(
        value,
        "error",
        "dial-url",
        `"dial" takes a network address (host:port), not a URL. Caddy fails to load this upstream.` +
          (scheme === "https"
            ? ` For HTTPS upstreams also set "transport": { "protocol": "http", "tls": {} }.`
            : ""),
        [{ title: `Change to "${hostPort}"`, newText: quoted(hostPort) }]
      )
    );
    return;
  }

  // network/host:port or [ipv6]:port -- anything with a trailing :port is fine.
  const withoutNetwork = dial.replace(/^(tcp|tcp4|tcp6|udp|udp4|udp6)\//, "");
  if (!/:\d+(-\d+)?$/.test(withoutNetwork)) {
    findings.push(
      finding(
        value,
        "error",
        "dial-port",
        `"dial" address "${dial}" has no port. Caddy rejects it ("missing port in address").`,
        [
          { title: `Add port 80 ("${dial}:80")`, newText: quoted(`${dial}:80`) },
          { title: `Add port 443 ("${dial}:443")`, newText: quoted(`${dial}:443`) },
        ]
      )
    );
  }
}

function checkHostMatcher(value: Node, findings: LintFinding[]): void {
  for (const item of value.type === "array" ? (value.children ?? []) : []) {
    const host = stringValue(item);
    if (host === undefined) continue;
    const url = URL_RE.exec(host);
    const bare = url ? url[2].replace(/:\d+$/, "") : host.replace(/:\d+$/, "");
    if (url || bare !== host || host.includes("/")) {
      const clean = bare.replace(/\/.*$/, "");
      findings.push(
        finding(
          item,
          "error",
          "host-format",
          `The "host" matcher compares hostnames only; "${host}" can never match. ` +
            `Match the port on the server's "listen", and paths with a "path" matcher.`,
          [{ title: `Change to "${clean}"`, newText: quoted(clean) }]
        )
      );
    }
  }
}

function checkLdapFilter(value: Node, findings: LintFinding[]): void {
  const filter = stringValue(value);
  if (filter === undefined || !filter.includes("{username}")) return;
  const fixed = filter.replace(/\{username\}/g, "%s");
  findings.push(
    finding(
      value,
      "error",
      "ldap-filter-placeholder",
      `"{username}" is Caddyfile syntax. Configs loaded through the JSON admin API skip the ` +
        `Caddyfile parser, so go-authcrunch looks for "%s" and every LDAP login fails.`,
      [{ title: `Replace {username} with %s`, newText: quoted(fixed) }]
    )
  );
}

function checkRedirect(handler: Node, findings: LintFinding[]): void {
  const props = new Map<string, Node>();
  for (const prop of handler.children ?? []) {
    const [k, v] = prop.children ?? [];
    if (k && v && typeof k.value === "string") props.set(k.value, v);
  }
  if (stringValue(props.get("handler")) !== "static_response") return;
  const statusNode = props.get("status_code");
  const status = Number(statusNode?.value);
  if (!statusNode || !(status >= 300 && status < 400)) return;

  const headers = props.get("headers");
  const hasLocation = (headers?.children ?? []).some(
    (p) =>
      typeof p.children?.[0]?.value === "string" && p.children[0].value.toLowerCase() === "location"
  );
  if (!hasLocation) {
    findings.push(
      finding(
        statusNode,
        "warning",
        "redirect-no-location",
        `A ${status} response without a "Location" header redirects nowhere. ` +
          `Add "headers": { "Location": ["https://..."] }.`
      )
    );
  }
}

export function lintCaddyConfig(text: string): LintFinding[] {
  const root = parseTree(text, [], { allowTrailingComma: true, disallowComments: false });
  if (!root) return [];

  const findings: LintFinding[] = [];
  const ids = new Map<string, Node[]>();
  const definitions = new Map<DefinitionKey, Set<string>>();
  const references: Array<{ kind: DefinitionKey; node: Node; name: string }> = [];

  eachProperty(root, ({ key, value, ancestors }) => {
    const parentKey = ancestors[ancestors.length - 1];

    if (key === "@id") {
      const id = stringValue(value);
      if (id !== undefined) ids.set(id, [...(ids.get(id) ?? []), value]);
    }

    if (key === "dial") checkDial(value, findings);
    if (key === "host" && parentKey === "match") checkHostMatcher(value, findings);
    if (key === "search_user_filter") checkLdapFilter(value, findings);
    if (key === "handle" && value.type === "array") {
      for (const handler of value.children ?? []) {
        if (handler.type === "object") checkRedirect(handler, findings);
      }
    }

    if (key in DEFINITION_KEYS && value.type === "array") {
      const kind = key as DefinitionKey;
      for (const item of value.children ?? []) {
        if (item.type === "object") {
          // definition: [{ "name": "x", ... }]
          const nameProp = (item.children ?? []).find((p) => p.children?.[0]?.value === "name");
          const name = stringValue(nameProp?.children?.[1]);
          if (name !== undefined) {
            definitions.set(kind, (definitions.get(kind) ?? new Set()).add(name));
          }
        } else {
          // reference: a portal's "identity_stores": ["local"]
          const name = stringValue(item);
          if (name !== undefined) references.push({ kind, node: item, name });
        }
      }
    }

    if (key === "gatekeeper_name") {
      const name = stringValue(value);
      if (name !== undefined)
        references.push({ kind: "authorization_policies", node: value, name });
    }
    if (key === "portal_name") {
      const name = stringValue(value);
      if (name !== undefined)
        references.push({ kind: "authentication_portals", node: value, name });
    }
  });

  for (const [id, nodes] of ids) {
    if (nodes.length < 2) continue;
    for (const node of nodes.slice(1)) {
      findings.push(
        finding(
          node,
          "error",
          "duplicate-id",
          `Duplicate @id "${id}". IDs must be unique across the whole Caddy config, or ` +
            `the admin API rejects the load and /id/${id} can't address the object.`
        )
      );
    }
  }

  // Only check references against collections this same document defines --
  // a lone route file legitimately points at a policy defined elsewhere.
  for (const ref of references) {
    const defined = definitions.get(ref.kind);
    if (!defined || defined.has(ref.name)) continue;
    const label = DEFINITION_KEYS[ref.kind];
    const suggestions = closestMatches(ref.name, defined);
    findings.push(
      finding(
        ref.node,
        "error",
        "unknown-reference",
        `No ${label} named "${ref.name}" is defined in this config` +
          ` (defined: ${[...defined].map((n) => `"${n}"`).join(", ")}).`,
        (suggestions.length > 0 ? suggestions : [...defined]).map((name) => ({
          title: `Change to "${name}"`,
          newText: quoted(name),
        }))
      )
    );
  }

  return findings.sort((a, b) => a.start - b.start);
}
