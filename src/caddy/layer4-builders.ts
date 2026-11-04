/**
 * Builders for caddy-l4 (`apps.layer4`) config: routes, servers, matcher sets
 * and handlers. Every builder validates its output against the schemas in
 * `layer4-schemas.ts`, which are composed from types generated from the
 * caddy-l4 Go source.
 */

import type { z } from "zod";
import type { CaddyDurationSchema } from "../schemas.js";
import {
  Layer4AppSchema,
  Layer4CloseHandlerSchema,
  Layer4EchoHandlerSchema,
  Layer4ListenerWrapperSchema,
  Layer4MatcherSetSchema,
  Layer4PostgresTlsHandlerSchema,
  Layer4ProxyHandlerSchema,
  Layer4ProxyProtocolHandlerSchema,
  Layer4RouteSchema,
  Layer4ServerSchema,
  Layer4Socks5HandlerSchema,
  Layer4SubrouteHandlerSchema,
  Layer4TeeHandlerSchema,
  Layer4ThrottleHandlerSchema,
  Layer4TlsHandlerSchema,
  type Layer4App,
  type Layer4CloseHandler,
  type Layer4EchoHandler,
  type Layer4Handler,
  type Layer4HealthChecks,
  type Layer4ListenerWrapper,
  type Layer4MatcherSet,
  type Layer4PostgresTlsHandler,
  type Layer4Protocol,
  type Layer4ProxyHandler,
  type Layer4ProxyProtocolHandler,
  type Layer4Route,
  type Layer4SelectionPolicy,
  type Layer4SelectionPolicyName,
  type Layer4Server,
  type Layer4Socks5Handler,
  type Layer4SubrouteHandler,
  type Layer4TeeHandler,
  type Layer4ThrottleHandler,
  type Layer4TlsConnectionPolicy,
  type Layer4TlsHandler,
  type Layer4UpstreamTls,
} from "./layer4-schemas.js";

/** A Caddy duration: Go duration string (`"10s"`, `"1m30s"`) or nanoseconds. */
type Duration = z.infer<typeof CaddyDurationSchema>;

const list = <T>(value: T | T[]): T[] => (Array.isArray(value) ? value : [value]);

/** Drop `undefined` values, so optional options don't show up as keys. */
function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

/** A protocol name becomes one matcher set (`"postgres"` → `[{ postgres: {} }]`). */
function toMatcherSets(match: Layer4Protocol | Layer4MatcherSet[] | undefined) {
  if (match === undefined) return undefined;
  return typeof match === "string" ? [{ [match]: match === "http" ? [] : {} }] : match;
}

// ============================================================================
// Handlers
// ============================================================================

/** Options for {@link buildLayer4ProxyHandler}. */
export interface Layer4ProxyHandlerOptions {
  /** PROXY protocol header to send upstream. */
  proxyProtocol?: "v1" | "v2";
  /**
   * How to pick an upstream when there are several: a policy name, or a full
   * selection (`{ policy: "random_choose", choose: 2 }`). Default: random.
   */
  loadBalancing?: Layer4SelectionPolicyName | Layer4SelectionPolicy;
  /** Keep retrying other upstreams this long when a dial fails. Default: no retries. */
  tryDuration?: Duration;
  /** Wait between retries. Default: 250ms. */
  tryInterval?: Duration;
  /** Active and/or passive health checks. */
  healthChecks?: Layer4HealthChecks;
  /** Speak TLS to the upstreams: `true` for defaults, or TLS options. */
  tls?: boolean | Layer4UpstreamTls;
  /** Wait this long for the other side to close after one side half-closed. */
  halfCloseTimeout?: Duration;
}

/**
 * A `proxy` handler for one or more upstreams.
 *
 * @description Forward the TCP connection to one of the given `host:port` addresses
 * @param upstreams - `host:port`, or a list of them (one upstream each)
 * @param options - load balancing, health checks, upstream TLS, PROXY protocol
 * @example buildLayer4ProxyHandler("postgres:5432")
 * @example buildLayer4ProxyHandler(["db1:5432", "db2:5432"], { loadBalancing: "round_robin" })
 */
export function buildLayer4ProxyHandler(
  upstreams: string | string[],
  options: Layer4ProxyHandlerOptions = {}
): Layer4ProxyHandler {
  const tls = options.tls === true ? {} : options.tls === false ? undefined : options.tls;
  const selection =
    typeof options.loadBalancing === "string"
      ? { policy: options.loadBalancing }
      : options.loadBalancing;
  const loadBalancing =
    selection || options.tryDuration !== undefined || options.tryInterval !== undefined
      ? compact({
          selection,
          try_duration: options.tryDuration,
          try_interval: options.tryInterval,
        })
      : undefined;
  return Layer4ProxyHandlerSchema.parse(
    compact({
      handler: "proxy",
      upstreams: list(upstreams).map((dial) => compact({ dial: [dial], tls })),
      proxy_protocol: options.proxyProtocol,
      load_balancing: loadBalancing,
      health_checks: options.healthChecks,
      half_close_timeout: options.halfCloseTimeout,
    })
  );
}

/** Options for {@link buildLayer4TlsHandler}. */
export interface Layer4TlsHandlerOptions {
  /** TLS connection policies; none means Caddy's defaults (certificates from the TLS app). */
  connectionPolicies?: Layer4TlsConnectionPolicy[];
  /** Fail the handshake after this long. Default: 60s. */
  handshakeTimeout?: Duration;
}

/**
 * A `tls` handler: terminates TLS, so the handlers after it see plaintext.
 *
 * @description Terminate TLS with Caddy's certificates, then continue with the decrypted stream
 * @example buildLayer4TlsHandler()
 * @example buildLayer4TlsHandler({ connectionPolicies: [{ alpn: ["http/1.1"] }] })
 */
export function buildLayer4TlsHandler(options: Layer4TlsHandlerOptions = {}): Layer4TlsHandler {
  return Layer4TlsHandlerSchema.parse(
    compact({
      handler: "tls",
      connection_policies: options.connectionPolicies,
      handshake_timeout: options.handshakeTimeout,
    })
  );
}

/** Options for {@link buildLayer4SubrouteHandler}. */
export interface Layer4SubrouteHandlerOptions {
  /** Routes tried in order; the first that matches handles the connection. */
  routes: Layer4Route[];
  /** How long the subroute's matchers may wait for data. Default: 3s. */
  matchingTimeout?: Duration;
}

/**
 * A `subroute` handler: a nested list of routes, e.g. after `tls` terminated
 * TLS, route the decrypted stream by its protocol.
 *
 * @description Nested layer 4 routes, tried in order (e.g. after terminating TLS)
 * @example buildLayer4SubrouteHandler({ routes: [buildLayer4ProxyRoute({ upstream: "localhost:8080", match: "http" })] })
 */
export function buildLayer4SubrouteHandler(
  options: Layer4SubrouteHandlerOptions
): Layer4SubrouteHandler {
  return Layer4SubrouteHandlerSchema.parse(
    compact({
      handler: "subroute",
      routes: options.routes,
      matching_timeout: options.matchingTimeout,
    })
  );
}

/** Options for {@link buildLayer4ThrottleHandler}. */
export interface Layer4ThrottleHandlerOptions {
  /** Read limit per connection, in bytes per second. */
  readBytesPerSecond?: number;
  /** Burst size per connection, in bytes. Default: same as the limit. */
  readBurstSize?: number;
  /** Read limit across all connections, in bytes per second. */
  totalReadBytesPerSecond?: number;
  /** Burst size across all connections, in bytes. */
  totalReadBurstSize?: number;
  /**
   * Delay added to every read.
   * @example "100ms"
   */
  latency?: Duration;
}

/**
 * A `throttle` handler: limit how fast a connection is read, or add latency
 * (to test how a client copes with a slow link).
 *
 * @description Limit read bandwidth per connection and/or overall, or add latency
 * @example buildLayer4ThrottleHandler({ readBytesPerSecond: 1048576 })
 * @example buildLayer4ThrottleHandler({ latency: "200ms" })
 */
export function buildLayer4ThrottleHandler(
  options: Layer4ThrottleHandlerOptions
): Layer4ThrottleHandler {
  return Layer4ThrottleHandlerSchema.parse(
    compact({
      handler: "throttle",
      read_bytes_per_second: options.readBytesPerSecond,
      read_burst_size: options.readBurstSize,
      total_read_bytes_per_second: options.totalReadBytesPerSecond,
      total_read_burst_size: options.totalReadBurstSize,
      latency: options.latency,
    })
  );
}

/** Options for {@link buildLayer4ProxyProtocolHandler}. */
export interface Layer4ProxyProtocolHandlerOptions {
  /** How long to wait for the PROXY header. Default: 5s. */
  timeout?: Duration;
  /** Only accept PROXY headers from these IPs/CIDR ranges. */
  allow?: string[];
  /** Never accept PROXY headers from these IPs/CIDR ranges. */
  deny?: string[];
  /** What to do with connections from addresses not in `allow`. Default: IGNORE. */
  fallbackPolicy?: "IGNORE" | "USE" | "REJECT" | "REQUIRE" | "SKIP";
}

/**
 * A `proxy_protocol` handler: read the PROXY protocol header a load balancer
 * puts in front of the connection, so later handlers see the real client.
 *
 * @description Accept a PROXY protocol (v1/v2) header from a trusted load balancer
 * @example buildLayer4ProxyProtocolHandler({ allow: ["10.0.0.0/8"] })
 */
export function buildLayer4ProxyProtocolHandler(
  options: Layer4ProxyProtocolHandlerOptions = {}
): Layer4ProxyProtocolHandler {
  return Layer4ProxyProtocolHandlerSchema.parse(
    compact({
      handler: "proxy_protocol",
      timeout: options.timeout,
      allow: options.allow,
      deny: options.deny,
      fallback_policy: options.fallbackPolicy,
    })
  );
}

/** Options for {@link buildLayer4Socks5Handler}. */
export interface Layer4Socks5HandlerOptions {
  /** Allowed SOCKS commands. Default: CONNECT and ASSOCIATE. */
  commands?: ("CONNECT" | "ASSOCIATE" | "BIND")[];
  /** Local IP to bind outgoing connections to. */
  bindIp?: string;
  /** Username → password; when set, clients must authenticate. */
  credentials?: Record<string, string>;
}

/**
 * A `socks5` handler: a SOCKSv5 proxy server.
 *
 * @description SOCKSv5 proxy server, optionally with username/password authentication
 * @example buildLayer4Socks5Handler({ credentials: { alice: "secret" } })
 */
export function buildLayer4Socks5Handler(
  options: Layer4Socks5HandlerOptions = {}
): Layer4Socks5Handler {
  return Layer4Socks5HandlerSchema.parse(
    compact({
      handler: "socks5",
      commands: options.commands,
      bind_ip: options.bindIp,
      credentials: options.credentials,
    })
  );
}

/**
 * A `tee` handler: also run `branch` on a copy of the connection's data, e.g.
 * to mirror traffic to a second upstream.
 *
 * @description Run extra handlers on a copy of the connection (e.g. mirror traffic)
 * @param branch - the handlers that get the copy
 * @example buildLayer4TeeHandler([buildLayer4ProxyHandler("mirror:5432")])
 */
export function buildLayer4TeeHandler(branch: Layer4Handler[]): Layer4TeeHandler {
  return Layer4TeeHandlerSchema.parse({ handler: "tee", branch });
}

/**
 * An `echo` handler: writes back everything it reads.
 *
 * @description Echo the connection's data back to the client
 * @example buildLayer4EchoHandler()
 */
export function buildLayer4EchoHandler(): Layer4EchoHandler {
  return Layer4EchoHandlerSchema.parse({ handler: "echo" });
}

/**
 * A `close` handler: closes the connection.
 *
 * @description Close the connection (e.g. as the last route, to refuse anything unmatched)
 * @example buildLayer4CloseHandler()
 */
export function buildLayer4CloseHandler(): Layer4CloseHandler {
  return Layer4CloseHandlerSchema.parse({ handler: "close" });
}

/**
 * A `postgres_tls` handler: answers a Postgres client's SSLRequest, so a `tls`
 * handler after it can terminate the TLS that follows.
 *
 * @description Accept a Postgres SSLRequest, so a following tls handler can terminate TLS
 * @example buildLayer4PostgresTlsHandler()
 */
export function buildLayer4PostgresTlsHandler(): Layer4PostgresTlsHandler {
  return Layer4PostgresTlsHandlerSchema.parse({ handler: "postgres_tls" });
}

// ============================================================================
// Matcher sets
// ============================================================================

/** Options for {@link buildLayer4TlsMatcherSet}. */
export interface Layer4TlsMatcherSetOptions {
  /**
   * Server names (SNI) to match; wildcards like `*.example.com` allowed.
   * @example "db.example.com"
   */
  sni?: string[];
  /**
   * ALPN protocols to match.
   * @example "h2"
   */
  alpn?: string[];
}

/**
 * A matcher set for TLS connections, optionally by server name (SNI) and ALPN.
 * TLS stays encrypted: route by SNI and pass the connection on as-is.
 *
 * @description Match TLS connections by server name (SNI) and/or ALPN, without decrypting
 * @example buildLayer4TlsMatcherSet({ sni: ["db.example.com"] })
 */
export function buildLayer4TlsMatcherSet(
  options: Layer4TlsMatcherSetOptions = {}
): Layer4MatcherSet {
  return Layer4MatcherSetSchema.parse({
    tls: compact({ sni: options.sni, alpn: options.alpn }),
  });
}

/** Options for {@link buildLayer4HttpMatcherSet}. */
export interface Layer4HttpMatcherSetOptions {
  /**
   * Host header values to match.
   * @example "example.com"
   */
  host?: string[];
  /**
   * Request paths to match.
   * @example "/api/*"
   */
  path?: string[];
}

/**
 * A matcher set for plain HTTP connections, optionally by host and path.
 *
 * @description Match plaintext HTTP connections, optionally by Host header and path
 * @example buildLayer4HttpMatcherSet({ host: ["example.com"] })
 */
export function buildLayer4HttpMatcherSet(
  options: Layer4HttpMatcherSetOptions = {}
): Layer4MatcherSet {
  const conditions = compact({ host: options.host, path: options.path });
  return Layer4MatcherSetSchema.parse({
    http: Object.keys(conditions).length > 0 ? [conditions] : [],
  });
}

/** Options for {@link buildLayer4PostgresMatcherSet}. */
export interface Layer4PostgresMatcherSetOptions {
  /** User name → databases it may use (`[]`: any database; key `"*"`: any other user). */
  users?: Record<string, string[]>;
  /** Accepted `application_name` values. */
  clients?: string[];
  /** `"enabled"`: the client must start with an SSLRequest; `"disabled"`: it must not. */
  tls?: "enabled" | "disabled";
}

/**
 * A matcher set for Postgres connections, optionally by user, database,
 * application name, or whether the client asks for TLS.
 *
 * @description Match Postgres connections, optionally by user/database, client name or TLS request
 * @example buildLayer4PostgresMatcherSet({ users: { app: ["shop"] } })
 */
export function buildLayer4PostgresMatcherSet(
  options: Layer4PostgresMatcherSetOptions = {}
): Layer4MatcherSet {
  return Layer4MatcherSetSchema.parse({
    postgres: compact({ user: options.users, client: options.clients, tls: options.tls }),
  });
}

/**
 * A matcher set for client addresses.
 *
 * @description Match connections whose client address is in one of these IPs/CIDR ranges
 * @param ranges - IPs or CIDR ranges
 * @example buildLayer4RemoteIpMatcherSet(["10.0.0.0/8"])
 */
export function buildLayer4RemoteIpMatcherSet(ranges: string | string[]): Layer4MatcherSet {
  return Layer4MatcherSetSchema.parse({ remote_ip: { ranges: list(ranges) } });
}

// ============================================================================
// Routes, servers, app
// ============================================================================

/** Options for {@link buildLayer4Route}. */
export interface Layer4RouteOptions {
  /** `@id`, so the route can be found and replaced later. */
  id?: string;
  /** A protocol name (`"tls"`) or full matcher sets; none matches every connection. */
  match?: Layer4Protocol | Layer4MatcherSet[];
  /** Handlers, run in order (the last one usually `proxy`). */
  handle: Layer4Handler[];
}

/**
 * A layer4 route: matcher sets (any may match) and the handlers to run.
 *
 * @description Layer 4 route with any matchers and handlers
 * @example buildLayer4Route({ match: "ssh", handle: [buildLayer4ProxyHandler("localhost:22")] })
 */
export function buildLayer4Route(options: Layer4RouteOptions): Layer4Route {
  const match = toMatcherSets(options.match);
  return Layer4RouteSchema.parse(
    compact({ "@id": options.id === "" ? undefined : options.id, match, handle: options.handle })
  );
}

/**
 * A route that proxies matching connections to an upstream.
 *
 * @description Layer 4 route: optionally match a protocol, then proxy the connection
 * @param options.id - `@id`, so the route can be found and replaced later
 * @param options.upstream - `host:port` (or a list) to proxy to
 * @param options.match - a protocol name (`"postgres"`) or full matcher sets
 * @example buildLayer4ProxyRoute({ id: "postgres", upstream: "postgres:5432", match: "postgres" })
 */
export function buildLayer4ProxyRoute(options: {
  id?: string;
  upstream: string | string[];
  match?: Layer4Protocol | Layer4MatcherSet[];
  /** Load balancing, health checks, upstream TLS, PROXY protocol. */
  proxy?: Layer4ProxyHandlerOptions;
}): Layer4Route {
  return buildLayer4Route({
    id: options.id,
    match: options.match,
    handle: [buildLayer4ProxyHandler(options.upstream, options.proxy)],
  });
}

/** Options for {@link buildLayer4SniRoute}. */
export interface Layer4SniRouteOptions {
  /** `@id`, so the route can be found and replaced later. */
  id?: string;
  /**
   * Server names (SNI) this route is for.
   * @example "db.example.com"
   */
  sni: string | string[];
  /**
   * `host:port` (or a list) to send the connections to.
   * @example "localhost:8443"
   */
  upstream: string | string[];
  /**
   * `false` (default): pass the TLS through untouched, the upstream terminates it.
   * `true`: Caddy terminates TLS with its own certificate and proxies plaintext.
   */
  terminate?: boolean;
}

/**
 * Route TLS connections by server name (SNI): pass them through to an upstream
 * that terminates TLS itself, or terminate TLS in Caddy first.
 *
 * @description Route TLS by server name (SNI) to an upstream, passthrough or terminated by Caddy
 * @example buildLayer4SniRoute({ sni: "db.example.com", upstream: "localhost:8443" })
 */
export function buildLayer4SniRoute(options: Layer4SniRouteOptions): Layer4Route {
  return buildLayer4Route({
    id: options.id,
    match: [buildLayer4TlsMatcherSet({ sni: list(options.sni) })],
    handle: [
      ...(options.terminate ? [buildLayer4TlsHandler()] : []),
      buildLayer4ProxyHandler(options.upstream),
    ],
  });
}

/**
 * A layer4 server: where it listens and its routes, tried in order.
 *
 * @description Layer 4 server for `apps.layer4.servers.<name>`
 * @example buildLayer4Server({ listen: [":5432"], routes: [route] })
 */
export function buildLayer4Server(options: {
  listen: string | string[];
  routes: Layer4Route[];
  /** Close connections idle this long. */
  idleTimeout?: Duration;
  /** How long matchers may wait for enough data. Default: 3s. */
  matchingTimeout?: Duration;
}): Layer4Server {
  return Layer4ServerSchema.parse(
    compact({
      listen: list(options.listen),
      routes: options.routes,
      idle_timeout: options.idleTimeout,
      matching_timeout: options.matchingTimeout,
    })
  );
}

/**
 * The whole `layer4` app (`apps.layer4`), for a full config load.
 *
 * @description The layer4 app with its named servers, for `apps.layer4`
 * @param servers - server name → server (from buildLayer4Server)
 * @example buildLayer4App({ db: buildLayer4Server({ listen: ":5432", routes: [route] }) })
 */
export function buildLayer4App(servers: Record<string, Layer4Server>): Layer4App {
  return Layer4AppSchema.parse({ servers });
}

/**
 * The `layer4` listener wrapper for an HTTP server's `listener_wrappers`: its
 * routes see each connection first (e.g. SSH on :443); whatever they don't
 * handle continues to the HTTP server. Put it before the `tls` wrapper.
 *
 * @description Layer 4 routes in front of an HTTP server's listener (multiplex a port)
 * @example buildLayer4ListenerWrapper({ routes: [buildLayer4ProxyRoute({ upstream: "localhost:22", match: "ssh" })] })
 */
export function buildLayer4ListenerWrapper(options: {
  routes: Layer4Route[];
  /** How long matchers may wait for enough data. Default: 3s. */
  matchingTimeout?: Duration;
}): Layer4ListenerWrapper {
  return Layer4ListenerWrapperSchema.parse(
    compact({
      wrapper: "layer4",
      routes: options.routes,
      matching_timeout: options.matchingTimeout,
    })
  );
}
