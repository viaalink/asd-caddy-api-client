/**
 * Zod schemas and types for the caddy-l4 plugin (github.com/mholt/caddy-l4):
 * the `layer4` app, its servers and routes, every matcher and handler module.
 *
 * Built like the caddy-security support: the base schemas are generated from
 * the Go source (tygo + ts-to-zod, `src/generated/plugins/caddy-l4-*.zod.ts`)
 * and composed here. Composition fills in what the generator can't know:
 * - modules with custom JSON (`tls`, `quic` and `http` matchers, `not`) whose
 *   Go structs carry only `json:"-"` fields;
 * - cross-package references the generated Zod files leave as `z.any()`
 *   (`caddy.Duration`, `reverseproxy.TLSConfig`, `caddytls.ConnectionPolicies`);
 * - value sets the Go code checks at provision time (`proxy_protocol: v1|v2`,
 *   `resolver_preference`, Postgres `tls`, PROXY protocol fallback policies);
 * - the `handler`/`policy` discriminators Caddy adds for module names.
 *
 * Every object passes unknown fields through, and a matcher set or handler of
 * a module this file doesn't know is accepted as-is: configs read back from a
 * Caddy with extra or newer layer4 modules must still parse.
 */

import { z } from "zod";
import { CaddyDurationSchema, CaddyRouteMatcherSchema } from "../schemas.js";
import { tlsConfigSchema as GeneratedReverseProxyTlsConfigSchema } from "../generated/caddy-reverseproxy.zod.js";
import { connectionPolicySchema as GeneratedConnectionPolicySchema } from "../generated/caddy-tls.zod.js";
import {
  matchLocalIpSchema as GeneratedMatchLocalIpSchema,
  matchRegexpSchema as GeneratedCoreMatchRegexpSchema,
  matchRemoteIpSchema as GeneratedMatchRemoteIpSchema,
} from "../generated/plugins/caddy-l4-core.zod.js";
import { matchClockSchema as GeneratedMatchClockSchema } from "../generated/plugins/caddy-l4-clock.zod.js";
import {
  matchDnsRuleSchema as GeneratedMatchDnsRuleSchema,
  matchDnsSchema as GeneratedMatchDnsSchema,
} from "../generated/plugins/caddy-l4-dns.zod.js";
import { matchOpenVpnSchema as GeneratedMatchOpenVpnSchema } from "../generated/plugins/caddy-l4-openvpn.zod.js";
import { matchPostgresSchema as GeneratedMatchPostgresSchema } from "../generated/plugins/caddy-l4-postgres.zod.js";
import {
  activeHealthChecksSchema as GeneratedActiveHealthChecksSchema,
  handlerSchema as GeneratedProxyHandlerSchema,
  loadBalancingSchema as GeneratedLoadBalancingSchema,
  passiveHealthChecksSchema as GeneratedPassiveHealthChecksSchema,
  randomChoiceSelectionSchema as GeneratedRandomChoiceSelectionSchema,
  upstreamSchema as GeneratedUpstreamSchema,
} from "../generated/plugins/caddy-l4-proxy.zod.js";
import { handlerSchema as GeneratedProxyProtocolHandlerSchema } from "../generated/plugins/caddy-l4-proxyprotocol.zod.js";
import { matchRdpSchema as GeneratedMatchRdpSchema } from "../generated/plugins/caddy-l4-rdp.zod.js";
import { matchRegexpSchema as GeneratedMatchRegexpSchema } from "../generated/plugins/caddy-l4-regexp.zod.js";
import { remoteIpListSchema as GeneratedRemoteIpListSchema } from "../generated/plugins/caddy-l4-remoteiplist.zod.js";
import {
  socks4MatcherSchema as GeneratedSocks4MatcherSchema,
  socks5HandlerSchema as GeneratedSocks5HandlerSchema,
  socks5MatcherSchema as GeneratedSocks5MatcherSchema,
} from "../generated/plugins/caddy-l4-socks.zod.js";
import { handlerSchema as GeneratedSubrouteHandlerSchema } from "../generated/plugins/caddy-l4-subroute.zod.js";
import { handlerSchema as GeneratedThrottleHandlerSchema } from "../generated/plugins/caddy-l4-throttle.zod.js";
import { handlerSchema as GeneratedTlsHandlerSchema } from "../generated/plugins/caddy-l4-tls.zod.js";
import { matchVarsSchema as GeneratedMatchVarsSchema } from "../generated/plugins/caddy-l4-vars.zod.js";
import { matchWinboxSchema as GeneratedMatchWinboxSchema } from "../generated/plugins/caddy-l4-winbox.zod.js";
import { matchWireGuardSchema as GeneratedMatchWireGuardSchema } from "../generated/plugins/caddy-l4-wireguard.zod.js";

// ============================================================================
// Matchers (`layer4.matchers.*`)
// ============================================================================

/** `remote_ip`: the client address is in one of these IPs/CIDR ranges. */
export const Layer4RemoteIpMatcherSchema = GeneratedMatchRemoteIpSchema.passthrough();
/** `local_ip`: the address the connection came in on is in one of these ranges. */
export const Layer4LocalIpMatcherSchema = GeneratedMatchLocalIpSchema.passthrough();

/**
 * The TLS ClientHello conditions (`tls.handshake_match.*` modules) used by the
 * `tls` and `quic` matchers: `sni`, `sni_regexp`, `alpn`, `remote_ip`, `local_ip`.
 */
export const Layer4TlsHandshakeMatchSchema = z
  .object({
    /** Server names (SNI), wildcards like `*.example.com` allowed. */
    sni: z.array(z.string().min(1)).optional(),
    /** SNI matched by a regular expression. */
    sni_regexp: GeneratedCoreMatchRegexpSchema.passthrough().optional(),
    /** ALPN protocols offered by the client, e.g. `["h2", "http/1.1"]`. */
    alpn: z.array(z.string().min(1)).optional(),
    remote_ip: z
      .object({
        ranges: z.array(z.string()).optional(),
        not_ranges: z.array(z.string()).optional(),
      })
      .passthrough()
      .optional(),
    local_ip: z
      .object({ ranges: z.array(z.string()).optional() })
      .passthrough()
      .optional(),
  })
  .catchall(z.unknown());

/** `tls`: a TLS ClientHello, optionally with conditions (`{}` matches any TLS). */
export const Layer4TlsMatcherSchema = Layer4TlsHandshakeMatchSchema;
/** `quic`: a QUIC Initial packet, with the same ClientHello conditions as `tls`. */
export const Layer4QuicMatcherSchema = Layer4TlsHandshakeMatchSchema;

/**
 * `http`: an HTTP request; the value is a list of HTTP matcher sets, as in an
 * HTTP route's `match` (`[{ "host": ["example.com"] }]`), or `[]` for any HTTP.
 */
export const Layer4HttpMatcherSchema = z.array(CaddyRouteMatcherSchema.passthrough());

/** `postgres`: a Postgres StartupMessage or SSLRequest. */
export const Layer4PostgresMatcherSchema = GeneratedMatchPostgresSchema.extend({
  /** `"enabled"` requires an SSLRequest, `"disabled"` its absence; unset: either. */
  tls: z.enum(["enabled", "disabled", ""]).optional(),
}).passthrough();

/** An options-free protocol matcher: `ssh`, `xmpp`, `proxy_protocol`. */
export const Layer4EmptyMatcherSchema = z.object({}).passthrough();

/** `rdp`: Remote Desktop Protocol, optionally by cookie or custom info. */
export const Layer4RdpMatcherSchema = GeneratedMatchRdpSchema.passthrough();

/** `openvpn`: OpenVPN in plain, auth, crypt or crypt2 mode. */
export const Layer4OpenVpnMatcherSchema = GeneratedMatchOpenVpnSchema.extend({
  modes: z.array(z.enum(["plain", "auth", "crypt", "crypt2"])).optional(),
  group_key_direction: z.enum(["normal", "inverse", "bidi", "bidirectional"]).optional(),
}).passthrough();

/** `socks4`: SOCKSv4 (CONNECT/BIND), optionally limited to destinations. */
export const Layer4Socks4MatcherSchema = GeneratedSocks4MatcherSchema.extend({
  commands: z.array(z.enum(["CONNECT", "BIND"])).optional(),
  ports: z.array(z.number().int().min(0).max(65535)).optional(),
}).passthrough();

/** `socks5`: SOCKSv5, optionally by offered auth methods (0 none, 1 GSSAPI, 2 user/pass). */
export const Layer4Socks5MatcherSchema = GeneratedSocks5MatcherSchema.extend({
  auth_methods: z.array(z.number().int().min(0).max(255)).optional(),
}).passthrough();

/** `regexp`: the first `count` bytes (default 4) match `pattern`. */
export const Layer4RegexpMatcherSchema = GeneratedMatchRegexpSchema.extend({
  pattern: z.string().min(1),
  count: z.number().int().min(1).max(65535).optional(),
}).passthrough();

/** `remote_ip_list`: the client address is listed in a file, re-read when it changes. */
export const Layer4RemoteIpListMatcherSchema = GeneratedRemoteIpListSchema.extend({
  remote_ip_file: z.string().min(1),
}).passthrough();

/** A clock time as caddy-l4 parses it (Go layout `15:04:05`), or a placeholder. */
const Layer4ClockTimeSchema = z
  .string()
  .regex(/^(\d{2}:\d{2}:\d{2}|.*\{[^}]+\}.*)$/, "use HH:MM:SS (e.g. 08:00:00) or a placeholder");

/**
 * `clock`: the connection arrives between `after` and `before` (`HH:MM:SS`,
 * in `timezone`, default UTC); `after` later than `before` spans midnight.
 */
export const Layer4ClockMatcherSchema = GeneratedMatchClockSchema.extend({
  after: Layer4ClockTimeSchema.optional(),
  before: Layer4ClockTimeSchema.optional(),
}).passthrough();

/** One DNS question rule for the `dns` matcher. */
export const Layer4DnsRuleSchema = GeneratedMatchDnsRuleSchema.passthrough();

/** `dns`: a DNS query, optionally allowed/denied by question rules. */
export const Layer4DnsMatcherSchema = GeneratedMatchDnsSchema.extend({
  allow: z.array(Layer4DnsRuleSchema).optional(),
  deny: z.array(Layer4DnsRuleSchema).optional(),
}).passthrough();

/** `vars`: placeholder → accepted values. */
export const Layer4VarsMatcherSchema = GeneratedMatchVarsSchema;

/** `vars_regexp`: placeholder → regular expression. */
export const Layer4VarsRegexpMatcherSchema = z.record(
  z.string(),
  GeneratedCoreMatchRegexpSchema.passthrough()
);

/** `winbox`: MikroTik Winbox, optionally by username. */
export const Layer4WinboxMatcherSchema = GeneratedMatchWinboxSchema.extend({
  modes: z.array(z.enum(["standard", "romon"])).optional(),
}).passthrough();

/** `wireguard`: a WireGuard handshake initiation. */
export const Layer4WireGuardMatcherSchema = GeneratedMatchWireGuardSchema.passthrough();

/** The matcher modules this library knows (`layer4.matchers.<name>`). */
export const LAYER4_MATCHERS = [
  "clock",
  "dns",
  "http",
  "local_ip",
  "not",
  "openvpn",
  "postgres",
  "proxy_protocol",
  "quic",
  "rdp",
  "regexp",
  "remote_ip",
  "remote_ip_list",
  "socks4",
  "socks5",
  "ssh",
  "tls",
  "vars",
  "vars_regexp",
  "winbox",
  "wireguard",
  "xmpp",
] as const;

/** Name of a known layer4 matcher module. */
export type Layer4MatcherName = (typeof LAYER4_MATCHERS)[number];

const Layer4MatcherSetBaseSchema = z.object({
  clock: Layer4ClockMatcherSchema.optional(),
  dns: Layer4DnsMatcherSchema.optional(),
  http: Layer4HttpMatcherSchema.optional(),
  local_ip: Layer4LocalIpMatcherSchema.optional(),
  openvpn: Layer4OpenVpnMatcherSchema.optional(),
  postgres: Layer4PostgresMatcherSchema.optional(),
  proxy_protocol: Layer4EmptyMatcherSchema.optional(),
  quic: Layer4QuicMatcherSchema.optional(),
  rdp: Layer4RdpMatcherSchema.optional(),
  regexp: Layer4RegexpMatcherSchema.optional(),
  remote_ip: Layer4RemoteIpMatcherSchema.optional(),
  remote_ip_list: Layer4RemoteIpListMatcherSchema.optional(),
  socks4: Layer4Socks4MatcherSchema.optional(),
  socks5: Layer4Socks5MatcherSchema.optional(),
  ssh: Layer4EmptyMatcherSchema.optional(),
  tls: Layer4TlsMatcherSchema.optional(),
  vars: Layer4VarsMatcherSchema.optional(),
  vars_regexp: Layer4VarsRegexpMatcherSchema.optional(),
  winbox: Layer4WinboxMatcherSchema.optional(),
  wireguard: Layer4WireGuardMatcherSchema.optional(),
  xmpp: Layer4EmptyMatcherSchema.optional(),
});

/**
 * A matcher set: every matcher in it must match (AND); a route's `match` list
 * matches when any set does (OR). Known matchers are typed; matchers of other
 * layer4 modules pass through unchecked.
 */
export interface Layer4MatcherSet extends z.infer<typeof Layer4MatcherSetBaseSchema> {
  /** `not`: none of these matcher sets match. */
  not?: Layer4MatcherSet[];
  [matcher: string]: unknown;
}

/**
 * A matcher set, e.g. `{ "postgres": {} }` or `{ "tls": { "sni": ["db.example.com"] } }`.
 */
export const Layer4MatcherSetSchema: z.ZodType<Layer4MatcherSet, z.ZodTypeDef, unknown> =
  Layer4MatcherSetBaseSchema.extend({
    not: z.array(z.lazy(() => Layer4MatcherSetSchema)).optional(),
  }).catchall(z.unknown());

// ============================================================================
// Handlers (`layer4.handlers.*`)
// ============================================================================

/** Upstream TLS: the same options as the HTTP reverse proxy's TLS transport. */
export const Layer4UpstreamTlsSchema = GeneratedReverseProxyTlsConfigSchema.extend({
  ca: z.record(z.unknown()).optional(),
  handshake_timeout: CaddyDurationSchema.optional(),
}).passthrough();

/** One upstream: a list of dial addresses (`host:port`), as caddy-l4 takes them. */
export const Layer4UpstreamSchema = GeneratedUpstreamSchema.extend({
  /** Addresses to dial, `host:port` (or `udp/host:port`, `unix//path`). */
  dial: z.array(z.string().min(1)).min(1),
  resolver_preference: z.enum(["ipv4_only", "ipv6_only", "ipv4_first", "ipv6_first"]).optional(),
  /** Speak TLS to the upstream. */
  tls: Layer4UpstreamTlsSchema.optional(),
  max_connections: z.number().int().min(0).optional(),
  /** Weight for the `weighted_round_robin` policy. */
  weight: z.number().int().min(0).optional(),
}).passthrough();

export const Layer4ActiveHealthChecksSchema = GeneratedActiveHealthChecksSchema.extend({
  interval: CaddyDurationSchema.optional(),
  timeout: CaddyDurationSchema.optional(),
}).passthrough();

export const Layer4PassiveHealthChecksSchema = GeneratedPassiveHealthChecksSchema.extend({
  fail_duration: CaddyDurationSchema.optional(),
}).passthrough();

export const Layer4HealthChecksSchema = z
  .object({
    active: Layer4ActiveHealthChecksSchema.optional(),
    passive: Layer4PassiveHealthChecksSchema.optional(),
  })
  .passthrough();

/** Upstream selection policies (`layer4.proxy.selection_policies.*`). */
export const LAYER4_SELECTION_POLICIES = [
  "first",
  "ip_hash",
  "least_conn",
  "random",
  "random_choose",
  "round_robin",
  "weighted_round_robin",
] as const;

export type Layer4SelectionPolicyName = (typeof LAYER4_SELECTION_POLICIES)[number];

const selectionPolicy = <P extends Layer4SelectionPolicyName>(policy: P) =>
  z.object({ policy: z.literal(policy) }).passthrough();

/** `load_balancing.selection`: `{ "policy": "round_robin" }`, `{ "policy": "random_choose", "choose": 2 }`. */
export const Layer4SelectionPolicySchema = z.discriminatedUnion("policy", [
  selectionPolicy("first"),
  selectionPolicy("ip_hash"),
  selectionPolicy("least_conn"),
  selectionPolicy("random"),
  GeneratedRandomChoiceSelectionSchema.extend({
    policy: z.literal("random_choose"),
    /** How many random upstreams to choose the least loaded from. Default: 2. */
    choose: z.number().int().min(2).optional(),
  }).passthrough(),
  selectionPolicy("round_robin"),
  selectionPolicy("weighted_round_robin"),
]);

export type Layer4SelectionPolicy = z.infer<typeof Layer4SelectionPolicySchema>;

export const Layer4LoadBalancingSchema = GeneratedLoadBalancingSchema.extend({
  selection: Layer4SelectionPolicySchema.optional(),
  try_duration: CaddyDurationSchema.optional(),
  try_interval: CaddyDurationSchema.optional(),
}).passthrough();

/** The `proxy` handler: forwards the connection to one of its upstreams. */
export const Layer4ProxyHandlerSchema = GeneratedProxyHandlerSchema.extend({
  handler: z.literal("proxy"),
  upstreams: z.array(Layer4UpstreamSchema).min(1),
  health_checks: Layer4HealthChecksSchema.optional(),
  load_balancing: Layer4LoadBalancingSchema.optional(),
  /** "PROXY protocol" header to send upstream: "v1" or "v2". */
  proxy_protocol: z.enum(["v1", "v2"]).optional(),
  half_close_timeout: CaddyDurationSchema.optional(),
}).passthrough();

/** A TLS connection policy for the `tls` handler (as in Caddy's TLS app). */
export const Layer4TlsConnectionPolicySchema = GeneratedConnectionPolicySchema.extend({
  /** Which ClientHellos this policy is for (`sni`, `alpn`, `remote_ip`, …). */
  match: Layer4TlsHandshakeMatchSchema.optional(),
  certificate_selection: z.record(z.unknown()).optional(),
  client_authentication: z.record(z.unknown()).optional(),
}).passthrough();

/** The `tls` handler: terminates TLS, the next handlers see the plaintext. */
export const Layer4TlsHandlerSchema = GeneratedTlsHandlerSchema.extend({
  handler: z.literal("tls"),
  connection_policies: z.array(Layer4TlsConnectionPolicySchema).optional(),
  handshake_timeout: CaddyDurationSchema.optional(),
}).passthrough();

/** The `throttle` handler: limits read bandwidth and/or adds latency. */
export const Layer4ThrottleHandlerSchema = GeneratedThrottleHandlerSchema.extend({
  handler: z.literal("throttle"),
  read_bytes_per_second: z.number().min(0).optional(),
  read_burst_size: z.number().int().min(0).optional(),
  total_read_bytes_per_second: z.number().min(0).optional(),
  total_read_burst_size: z.number().int().min(0).optional(),
  latency: CaddyDurationSchema.optional(),
}).passthrough();

/** Fallback policies of the `proxy_protocol` handler (case-insensitive in Caddy). */
export const LAYER4_PROXY_PROTOCOL_POLICIES = [
  "IGNORE",
  "USE",
  "REJECT",
  "REQUIRE",
  "SKIP",
] as const;

/** The `proxy_protocol` handler: reads a PROXY protocol header sent by a load balancer. */
export const Layer4ProxyProtocolHandlerSchema = GeneratedProxyProtocolHandlerSchema.extend({
  handler: z.literal("proxy_protocol"),
  timeout: CaddyDurationSchema.optional(),
  fallback_policy: z
    .string()
    .refine(
      (p) => (LAYER4_PROXY_PROTOCOL_POLICIES as readonly string[]).includes(p.toUpperCase()),
      { message: `fallback_policy must be one of ${LAYER4_PROXY_PROTOCOL_POLICIES.join(", ")}` }
    )
    .optional(),
}).passthrough();

/** The `socks5` handler: a SOCKSv5 server. */
export const Layer4Socks5HandlerSchema = GeneratedSocks5HandlerSchema.extend({
  handler: z.literal("socks5"),
  commands: z.array(z.enum(["CONNECT", "ASSOCIATE", "BIND"])).optional(),
}).passthrough();

/** The `echo` handler: writes back whatever it reads. */
export const Layer4EchoHandlerSchema = z.object({ handler: z.literal("echo") }).passthrough();
/** The `close` handler: closes the connection. */
export const Layer4CloseHandlerSchema = z.object({ handler: z.literal("close") }).passthrough();
/** The `postgres_tls` handler: answers a Postgres SSLRequest so `tls` can take over. */
export const Layer4PostgresTlsHandlerSchema = z
  .object({ handler: z.literal("postgres_tls") })
  .passthrough();
/** The `vars` handler: sets variables (placeholders) on the connection. */
export const Layer4VarsHandlerSchema = z
  .object({ handler: z.literal("vars") })
  .catchall(z.unknown());

/** The handler modules this library knows (`layer4.handlers.<name>`). */
export const LAYER4_HANDLERS = [
  "close",
  "echo",
  "postgres_tls",
  "proxy",
  "proxy_protocol",
  "socks5",
  "subroute",
  "tee",
  "throttle",
  "tls",
  "vars",
] as const;

export type Layer4HandlerName = (typeof LAYER4_HANDLERS)[number];

/** A handler of a layer4 module this library doesn't model: checked for its name only. */
export const Layer4OtherHandlerSchema = z
  .object({ handler: z.string().min(1) })
  .passthrough()
  .refine((h) => !(LAYER4_HANDLERS as readonly string[]).includes(h.handler), {
    message: "invalid options for a known layer4 handler",
  });

export type Layer4ProxyHandler = z.infer<typeof Layer4ProxyHandlerSchema>;
export type Layer4TlsHandler = z.infer<typeof Layer4TlsHandlerSchema>;
export type Layer4ThrottleHandler = z.infer<typeof Layer4ThrottleHandlerSchema>;
export type Layer4ProxyProtocolHandler = z.infer<typeof Layer4ProxyProtocolHandlerSchema>;
export type Layer4Socks5Handler = z.infer<typeof Layer4Socks5HandlerSchema>;
export type Layer4EchoHandler = z.infer<typeof Layer4EchoHandlerSchema>;
export type Layer4CloseHandler = z.infer<typeof Layer4CloseHandlerSchema>;
export type Layer4PostgresTlsHandler = z.infer<typeof Layer4PostgresTlsHandlerSchema>;
export type Layer4VarsHandler = z.infer<typeof Layer4VarsHandlerSchema>;
export type Layer4OtherHandler = z.infer<typeof Layer4OtherHandlerSchema>;

/** The `subroute` handler: its own list of routes, tried in order. */
export interface Layer4SubrouteHandler {
  handler: "subroute";
  routes?: Layer4Route[];
  matching_timeout?: z.infer<typeof CaddyDurationSchema>;
  [key: string]: unknown;
}

/** The `tee` handler: also runs `branch` on a copy of the connection's data. */
export interface Layer4TeeHandler {
  handler: "tee";
  branch?: Layer4Handler[];
  [key: string]: unknown;
}

export type Layer4Handler =
  | Layer4ProxyHandler
  | Layer4TlsHandler
  | Layer4SubrouteHandler
  | Layer4ThrottleHandler
  | Layer4ProxyProtocolHandler
  | Layer4Socks5Handler
  | Layer4TeeHandler
  | Layer4EchoHandler
  | Layer4CloseHandler
  | Layer4PostgresTlsHandler
  | Layer4VarsHandler
  | Layer4OtherHandler;

export const Layer4SubrouteHandlerSchema: z.ZodType<Layer4SubrouteHandler, z.ZodTypeDef, unknown> =
  GeneratedSubrouteHandlerSchema.extend({
    handler: z.literal("subroute"),
    routes: z.array(z.lazy(() => Layer4RouteSchema)).optional(),
    matching_timeout: CaddyDurationSchema.optional(),
  }).passthrough();

export const Layer4TeeHandlerSchema: z.ZodType<Layer4TeeHandler, z.ZodTypeDef, unknown> = z
  .object({
    handler: z.literal("tee"),
    branch: z.array(z.lazy(() => Layer4HandlerSchema)).optional(),
  })
  .passthrough();

/** The options schema of every handler this library models, by name (also used for the editor JSON schemas). */
export const LAYER4_HANDLER_SCHEMAS: Record<Layer4HandlerName, z.ZodTypeAny> = {
  close: Layer4CloseHandlerSchema,
  echo: Layer4EchoHandlerSchema,
  postgres_tls: Layer4PostgresTlsHandlerSchema,
  proxy: Layer4ProxyHandlerSchema,
  proxy_protocol: Layer4ProxyProtocolHandlerSchema,
  socks5: Layer4Socks5HandlerSchema,
  subroute: Layer4SubrouteHandlerSchema,
  tee: Layer4TeeHandlerSchema,
  throttle: Layer4ThrottleHandlerSchema,
  tls: Layer4TlsHandlerSchema,
  vars: Layer4VarsHandlerSchema,
};

/**
 * Any layer4 handler. A known handler (by its `handler` name) is checked
 * against its own schema; others are checked for the name only.
 */
export const Layer4HandlerSchema: z.ZodType<Layer4Handler, z.ZodTypeDef, unknown> = z
  .object({ handler: z.string().min(1) })
  .passthrough()
  .superRefine((value, ctx) => {
    const schema = (LAYER4_HANDLER_SCHEMAS as Record<string, z.ZodTypeAny | undefined>)[
      value.handler
    ];
    if (!schema) return;
    const result = schema.safeParse(value);
    if (!result.success) {
      for (const issue of result.error.issues) ctx.addIssue(issue);
    }
  })
  .transform((value) => {
    const schema = (LAYER4_HANDLER_SCHEMAS as Record<string, z.ZodTypeAny | undefined>)[
      value.handler
    ];
    return (schema ? schema.parse(value) : value) as Layer4Handler;
  });

// ============================================================================
// Routes, servers, the app
// ============================================================================

/** A route: when any of its matcher sets matches (or there are none), run its handlers. */
export interface Layer4Route {
  /** Caddy `@id`, so the route can be found and replaced through the admin API. */
  "@id"?: string;
  match?: Layer4MatcherSet[];
  handle: Layer4Handler[];
  [key: string]: unknown;
}

export const Layer4RouteSchema: z.ZodType<Layer4Route, z.ZodTypeDef, unknown> = z
  .object({
    "@id": z.string().min(1).optional(),
    match: z.array(Layer4MatcherSetSchema).optional(),
    handle: z.array(Layer4HandlerSchema).min(1),
  })
  .passthrough();

/** A layer4 server (`apps.layer4.servers.<name>`). */
export const Layer4ServerSchema = z
  .object({
    /** Addresses to listen on: `:5432`, `0.0.0.0:443`, `udp/:53`. */
    listen: z.array(z.string().min(1)).min(1),
    routes: z.array(Layer4RouteSchema),
    /** Close a connection after this long without reads/writes. */
    idle_timeout: CaddyDurationSchema.optional(),
    /** How long matchers may wait for enough bytes. Default: 3s. */
    matching_timeout: CaddyDurationSchema.optional(),
  })
  .passthrough();

/** The `layer4` app (`apps.layer4`). */
export const Layer4AppSchema = z
  .object({
    servers: z.record(Layer4ServerSchema).optional(),
  })
  .passthrough();

/**
 * The `layer4` listener wrapper (`caddy.listeners.layer4`): runs layer4 routes
 * in front of an HTTP server's listener, e.g. to multiplex SSH and HTTPS on :443.
 * Connections no route handles fall through to the HTTP server.
 */
export const Layer4ListenerWrapperSchema = z
  .object({
    wrapper: z.literal("layer4"),
    routes: z.array(Layer4RouteSchema).optional(),
    matching_timeout: CaddyDurationSchema.optional(),
  })
  .passthrough();

export type Layer4Upstream = z.infer<typeof Layer4UpstreamSchema>;
export type Layer4UpstreamTls = z.infer<typeof Layer4UpstreamTlsSchema>;
export type Layer4HealthChecks = z.infer<typeof Layer4HealthChecksSchema>;
export type Layer4LoadBalancing = z.infer<typeof Layer4LoadBalancingSchema>;
export type Layer4TlsConnectionPolicy = z.infer<typeof Layer4TlsConnectionPolicySchema>;
export type Layer4TlsHandshakeMatch = z.infer<typeof Layer4TlsHandshakeMatchSchema>;
export type Layer4HttpMatcher = z.infer<typeof Layer4HttpMatcherSchema>;
export type Layer4PostgresMatcher = z.infer<typeof Layer4PostgresMatcherSchema>;
export type Layer4RdpMatcher = z.infer<typeof Layer4RdpMatcherSchema>;
export type Layer4OpenVpnMatcher = z.infer<typeof Layer4OpenVpnMatcherSchema>;
export type Layer4Socks4Matcher = z.infer<typeof Layer4Socks4MatcherSchema>;
export type Layer4Socks5Matcher = z.infer<typeof Layer4Socks5MatcherSchema>;
export type Layer4RegexpMatcher = z.infer<typeof Layer4RegexpMatcherSchema>;
export type Layer4RemoteIpListMatcher = z.infer<typeof Layer4RemoteIpListMatcherSchema>;
export type Layer4ClockMatcher = z.infer<typeof Layer4ClockMatcherSchema>;
export type Layer4DnsMatcher = z.infer<typeof Layer4DnsMatcherSchema>;
export type Layer4WinboxMatcher = z.infer<typeof Layer4WinboxMatcherSchema>;
export type Layer4WireGuardMatcher = z.infer<typeof Layer4WireGuardMatcherSchema>;
export type Layer4Server = z.infer<typeof Layer4ServerSchema>;
export type Layer4App = z.infer<typeof Layer4AppSchema>;
export type Layer4ListenerWrapper = z.infer<typeof Layer4ListenerWrapperSchema>;

/**
 * Matchers that recognise a protocol from a connection's first bytes and need
 * no options, usable by name: `match: "postgres"` → `[{ "postgres": {} }]`.
 * (`mysql` and `redis` are not caddy-l4 modules; kept for compatibility, they
 * only work with a Caddy that has third-party matchers of those names.)
 */
export type Layer4Protocol =
  | "postgres"
  | "tls"
  | "http"
  | "ssh"
  | "rdp"
  | "socks4"
  | "socks5"
  | "openvpn"
  | "xmpp"
  | "proxy_protocol"
  | "quic"
  | "dns"
  | "winbox"
  | "wireguard"
  /** @deprecated not a caddy-l4 matcher */
  | "mysql"
  /** @deprecated not a caddy-l4 matcher */
  | "redis";
