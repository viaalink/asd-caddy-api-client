/**
 * caddy-l4 schemas (composed from the generated caddy-l4 types) and builders.
 * The config shapes here follow the caddy-l4 Go source at the pinned commit;
 * tests/integration's layer4-modules test loads the builders' output into a
 * real caddy-l4 to prove Caddy accepts it.
 */
import { describe, test, expect, expectTypeOf } from "vitest";
import {
  LAYER4_HANDLERS,
  LAYER4_MATCHERS,
  Layer4AppSchema,
  Layer4HandlerSchema,
  Layer4MatcherSetSchema,
  Layer4ProxyHandlerSchema,
  Layer4RouteSchema,
  Layer4ServerSchema,
  buildLayer4App,
  buildLayer4CloseHandler,
  buildLayer4EchoHandler,
  buildLayer4HttpMatcherSet,
  buildLayer4ListenerWrapper,
  buildLayer4PostgresMatcherSet,
  buildLayer4PostgresTlsHandler,
  buildLayer4ProxyHandler,
  buildLayer4ProxyProtocolHandler,
  buildLayer4ProxyRoute,
  buildLayer4RemoteIpMatcherSet,
  buildLayer4Route,
  buildLayer4Server,
  buildLayer4SniRoute,
  buildLayer4Socks5Handler,
  buildLayer4SubrouteHandler,
  buildLayer4TeeHandler,
  buildLayer4ThrottleHandler,
  buildLayer4TlsHandler,
  buildLayer4TlsMatcherSet,
  type Layer4App,
  type Layer4Handler,
  type Layer4MatcherSet,
  type Layer4Route,
  type Layer4Server,
} from "../caddy/layer4.js";
import type { Handler as GeneratedThrottleHandler } from "../generated/plugins/caddy-l4-throttle.js";
import type { Upstream as GeneratedUpstream } from "../generated/plugins/caddy-l4-proxy.js";
import type { MatchPostgres as GeneratedMatchPostgres } from "../generated/plugins/caddy-l4-postgres.js";

// ---------------------------------------------------------------------------
// Type-level: no `any` leaks from the generated schemas into the public types
// ---------------------------------------------------------------------------

type IsAny<T> = 0 extends 1 & T ? true : false;
type Depth = [never, 0, 1, 2, 3, 4, 5, 6];
type HasAny<T, D extends number = 7> = [D] extends [never]
  ? false
  : IsAny<T> extends true
    ? true
    : T extends (infer E)[]
      ? HasAny<E, Depth[D]>
      : T extends object
        ? true extends { [K in keyof T]-?: HasAny<T[K], Depth[D]> }[keyof T]
          ? true
          : false
        : false;

describe("layer4 types", () => {
  test("no `any` in the public layer4 types", () => {
    expectTypeOf<HasAny<Layer4Server>>().toEqualTypeOf<false>();
    expectTypeOf<HasAny<Layer4Route>>().toEqualTypeOf<false>();
    expectTypeOf<HasAny<Layer4Handler>>().toEqualTypeOf<false>();
    expectTypeOf<HasAny<Layer4MatcherSet>>().toEqualTypeOf<false>();
    expectTypeOf<HasAny<Layer4App>>().toEqualTypeOf<false>();
  });

  test("composed types keep the generated Go field names", () => {
    // A field renamed or dropped upstream breaks these at compile time.
    type Throttle = Extract<Layer4Handler, { handler: "throttle" }>;
    expectTypeOf<keyof Omit<GeneratedThrottleHandler, "latency">>().toMatchTypeOf<keyof Throttle>();
    type Upstream = Extract<Layer4Handler, { handler: "proxy" }>["upstreams"][number];
    expectTypeOf<keyof GeneratedUpstream>().toMatchTypeOf<keyof Upstream>();
    expectTypeOf<keyof GeneratedMatchPostgres>().toMatchTypeOf<
      keyof NonNullable<Layer4MatcherSet["postgres"]>
    >();
  });
});

// ---------------------------------------------------------------------------
// Matchers
// ---------------------------------------------------------------------------

describe("layer4 matcher sets", () => {
  test("every protocol matcher of caddy-l4 has a typed schema", () => {
    const valid: Record<(typeof LAYER4_MATCHERS)[number], unknown> = {
      clock: { after: "08:00:00", before: "18:00:00", timezone: "Europe/Amsterdam" },
      dns: { allow: [{ name: "example.com.", type: "A" }], default_deny: true },
      http: [{ host: ["example.com"] }],
      local_ip: { ranges: ["127.0.0.1"] },
      not: [{ remote_ip: { ranges: ["10.0.0.0/8"] } }],
      openvpn: { modes: ["crypt2"], ignore_timestamp: true },
      postgres: { user: { app: ["shop"] }, client: ["psql"], tls: "disabled" },
      proxy_protocol: {},
      quic: { sni: ["example.com"] },
      rdp: { cookie_hash: "alice" },
      regexp: { pattern: "^SSH-", count: 4 },
      remote_ip: { ranges: ["10.0.0.0/8"] },
      remote_ip_list: { remote_ip_file: "/etc/caddy/blocked.txt" },
      socks4: { commands: ["CONNECT"], ports: [443] },
      socks5: { auth_methods: [0, 2] },
      ssh: {},
      tls: { sni: ["db.example.com"], alpn: ["postgresql"] },
      vars: { "{l4.tls.server_name}": ["a.example.com"] },
      vars_regexp: { "{l4.tls.server_name}": { pattern: "^a\\." } },
      winbox: { modes: ["standard"], username: "admin" },
      wireguard: { zero: 0 },
      xmpp: {},
    };
    expect(Object.keys(valid).sort()).toEqual([...LAYER4_MATCHERS].sort());
    for (const [name, options] of Object.entries(valid)) {
      expect(Layer4MatcherSetSchema.safeParse({ [name]: options }).success, name).toBe(true);
    }
  });

  test("bad matcher options are rejected", () => {
    const bad: Record<string, unknown>[] = [
      { tls: { sni: "db.example.com" } }, // must be a list
      { postgres: { tls: "required" } },
      { regexp: { count: 4 } }, // pattern is required
      { remote_ip_list: {} },
      { socks4: { commands: ["ASSOCIATE"] } }, // socks4 has CONNECT/BIND only
      { http: { host: ["example.com"] } }, // a list of HTTP matcher sets
      { openvpn: { modes: ["tls"] } },
      { clock: { after: "08:00" } }, // caddy-l4 parses 15:04:05
      { not: [{ tls: { alpn: "h2" } }] }, // checked inside `not` too
    ];
    for (const set of bad) {
      expect(Layer4MatcherSetSchema.safeParse(set).success, JSON.stringify(set)).toBe(false);
    }
  });

  test("matchers of other modules pass through", () => {
    const set = { tls: { sni: ["x"] }, some_plugin: { anything: true } };
    expect(Layer4MatcherSetSchema.parse(set)).toEqual(set);
  });

  test("builders", () => {
    expect(buildLayer4TlsMatcherSet({ sni: ["db.example.com"] })).toEqual({
      tls: { sni: ["db.example.com"] },
    });
    expect(buildLayer4TlsMatcherSet()).toEqual({ tls: {} });
    expect(buildLayer4HttpMatcherSet()).toEqual({ http: [] });
    expect(buildLayer4HttpMatcherSet({ host: ["example.com"], path: ["/api/*"] })).toEqual({
      http: [{ host: ["example.com"], path: ["/api/*"] }],
    });
    expect(buildLayer4PostgresMatcherSet({ users: { app: [] }, tls: "enabled" })).toEqual({
      postgres: { user: { app: [] }, tls: "enabled" },
    });
    expect(buildLayer4RemoteIpMatcherSet("10.0.0.0/8")).toEqual({
      remote_ip: { ranges: ["10.0.0.0/8"] },
    });
  });
});

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

describe("layer4 handlers", () => {
  test("every handler of caddy-l4 is known", () => {
    expect([...LAYER4_HANDLERS].sort()).toEqual(
      [
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
      ].sort()
    );
  });

  test("a known handler is checked against its own schema", () => {
    expect(Layer4HandlerSchema.safeParse({ handler: "proxy", upstreams: [] }).success).toBe(false);
    expect(
      Layer4HandlerSchema.safeParse({ handler: "throttle", read_bytes_per_second: -1 }).success
    ).toBe(false);
    expect(
      Layer4HandlerSchema.safeParse({ handler: "tls", handshake_timeout: "soon" }).success
    ).toBe(false);
    expect(
      Layer4HandlerSchema.safeParse({ handler: "proxy_protocol", fallback_policy: "MAYBE" }).success
    ).toBe(false);
    expect(Layer4HandlerSchema.safeParse({ handler: "socks5", commands: ["PING"] }).success).toBe(
      false
    );
    // recursive: a subroute's routes and a tee's branch are checked too
    expect(
      Layer4HandlerSchema.safeParse({
        handler: "subroute",
        routes: [{ handle: [{ handler: "proxy", upstreams: [{ dial: [] }] }] }],
      }).success
    ).toBe(false);
    expect(
      Layer4HandlerSchema.safeParse({ handler: "tee", branch: [{ handler: "proxy" }] }).success
    ).toBe(false);
  });

  test("the error path points into the handler", () => {
    const result = Layer4RouteSchema.safeParse({
      handle: [{ handler: "proxy", upstreams: [{ dial: [] }] }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["handle", 0, "upstreams", 0, "dial"]);
    }
  });

  test("handlers of other modules are checked for their name only", () => {
    const h = { handler: "some_plugin", option: 1 };
    expect(Layer4HandlerSchema.parse(h)).toEqual(h);
    expect(Layer4HandlerSchema.safeParse({ handler: "" }).success).toBe(false);
  });

  test("proxy: full upstream, health check and load balancing options", () => {
    const handler = {
      handler: "proxy",
      upstreams: [
        {
          dial: ["db1:5432"],
          max_connections: 100,
          weight: 3,
          resolver_preference: "ipv4_first",
          tls: { insecure_skip_verify: true, handshake_timeout: "5s" },
        },
        { dial: ["db2:5432"], local_address: ["10.0.0.5"] },
      ],
      health_checks: {
        active: { port: 5432, interval: "10s", timeout: "2s", fall: 2, rise: 1 },
        passive: { fail_duration: "30s", max_fails: 3, unhealthy_connection_count: 50 },
      },
      load_balancing: {
        selection: { policy: "random_choose", choose: 2 },
        try_duration: "5s",
        try_interval: "250ms",
      },
      proxy_protocol: "v2",
      half_close_timeout: "1m",
    };
    expect(Layer4ProxyHandlerSchema.parse(handler)).toEqual(handler);
    for (const bad of [
      { load_balancing: { selection: { policy: "cookie" } } },
      { upstreams: [{ dial: ["x:1"], resolver_preference: "ipv5" }] },
      { proxy_protocol: "v3" },
      { health_checks: { active: { interval: "often" } } },
    ]) {
      expect(Layer4ProxyHandlerSchema.safeParse({ ...handler, ...bad }).success).toBe(false);
    }
  });

  test("proxy builder: load balancing, retries, upstream TLS", () => {
    expect(
      buildLayer4ProxyHandler(["a:1", "b:2"], {
        loadBalancing: "round_robin",
        tryDuration: "5s",
        tls: true,
        healthChecks: { passive: { max_fails: 2 } },
      })
    ).toEqual({
      handler: "proxy",
      upstreams: [
        { dial: ["a:1"], tls: {} },
        { dial: ["b:2"], tls: {} },
      ],
      load_balancing: { selection: { policy: "round_robin" }, try_duration: "5s" },
      health_checks: { passive: { max_fails: 2 } },
    });
    expect(
      buildLayer4ProxyHandler("a:1", { loadBalancing: { policy: "random_choose", choose: 3 } })
    ).toMatchObject({ load_balancing: { selection: { policy: "random_choose", choose: 3 } } });
  });

  test("other handler builders", () => {
    expect(buildLayer4TlsHandler()).toEqual({ handler: "tls" });
    expect(
      buildLayer4TlsHandler({
        connectionPolicies: [{ match: { sni: ["a.example.com"] }, alpn: ["http/1.1"] }],
        handshakeTimeout: "10s",
      })
    ).toEqual({
      handler: "tls",
      connection_policies: [{ match: { sni: ["a.example.com"] }, alpn: ["http/1.1"] }],
      handshake_timeout: "10s",
    });
    const inner = buildLayer4ProxyRoute({ upstream: "localhost:8080", match: "http" });
    expect(buildLayer4SubrouteHandler({ routes: [inner], matchingTimeout: "2s" })).toEqual({
      handler: "subroute",
      routes: [inner],
      matching_timeout: "2s",
    });
    expect(buildLayer4ThrottleHandler({ readBytesPerSecond: 1024, latency: "100ms" })).toEqual({
      handler: "throttle",
      read_bytes_per_second: 1024,
      latency: "100ms",
    });
    expect(
      buildLayer4ProxyProtocolHandler({ allow: ["10.0.0.0/8"], fallbackPolicy: "REJECT" })
    ).toEqual({ handler: "proxy_protocol", allow: ["10.0.0.0/8"], fallback_policy: "REJECT" });
    expect(buildLayer4Socks5Handler({ credentials: { alice: "pw" } })).toEqual({
      handler: "socks5",
      credentials: { alice: "pw" },
    });
    expect(buildLayer4TeeHandler([buildLayer4EchoHandler()])).toEqual({
      handler: "tee",
      branch: [{ handler: "echo" }],
    });
    expect(buildLayer4CloseHandler()).toEqual({ handler: "close" });
    expect(buildLayer4PostgresTlsHandler()).toEqual({ handler: "postgres_tls" });
  });
});

// ---------------------------------------------------------------------------
// Routes, servers, app, listener wrapper
// ---------------------------------------------------------------------------

describe("layer4 routes and servers", () => {
  test("route builder: protocol shortcut, matcher sets, any handlers", () => {
    expect(buildLayer4Route({ match: "ssh", handle: [buildLayer4ProxyHandler("h:22")] })).toEqual({
      match: [{ ssh: {} }],
      handle: [{ handler: "proxy", upstreams: [{ dial: ["h:22"] }] }],
    });
    // the http matcher takes a list of HTTP matcher sets, `[]` for any request
    expect(buildLayer4ProxyRoute({ upstream: "h:80", match: "http" }).match).toEqual([
      { http: [] },
    ]);
    expect(() => buildLayer4Route({ handle: [] })).toThrow();
  });

  test("proxy route passes proxy options through", () => {
    expect(
      buildLayer4ProxyRoute({ upstream: "a:1", proxy: { proxyProtocol: "v1" } }).handle
    ).toEqual([{ handler: "proxy", upstreams: [{ dial: ["a:1"] }], proxy_protocol: "v1" }]);
  });

  test("SNI route: passthrough or terminated", () => {
    expect(buildLayer4SniRoute({ id: "db", sni: "db.example.com", upstream: "db:5432" })).toEqual({
      "@id": "db",
      match: [{ tls: { sni: ["db.example.com"] } }],
      handle: [{ handler: "proxy", upstreams: [{ dial: ["db:5432"] }] }],
    });
    expect(
      buildLayer4SniRoute({ sni: ["a.example.com"], upstream: "a:80", terminate: true }).handle
    ).toEqual([{ handler: "tls" }, { handler: "proxy", upstreams: [{ dial: ["a:80"] }] }]);
  });

  test("server with timeouts, app, listener wrapper", () => {
    const route = buildLayer4ProxyRoute({ upstream: "a:1" });
    const server = buildLayer4Server({
      listen: ":9000",
      routes: [route],
      idleTimeout: "5m",
      matchingTimeout: "1s",
    });
    expect(server).toEqual({
      listen: [":9000"],
      routes: [route],
      idle_timeout: "5m",
      matching_timeout: "1s",
    });
    expect(buildLayer4App({ main: server })).toEqual({ servers: { main: server } });
    expect(Layer4AppSchema.safeParse({ servers: { x: { listen: [], routes: [] } } }).success).toBe(
      false
    );
    expect(buildLayer4ListenerWrapper({ routes: [route] })).toEqual({
      wrapper: "layer4",
      routes: [route],
    });
  });

  test("a full config read back from Caddy (unknown fields included) parses unchanged", () => {
    const server = {
      listen: ["0.0.0.0:443"],
      idle_timeout: 300000000000,
      future_option: true,
      routes: [
        {
          "@id": "ssh-or-tls",
          match: [{ ssh: {} }, { tls: { sni: ["x.example.com"], future: 1 } }],
          handle: [
            { handler: "proxy_protocol", timeout: "2s", fallback_policy: "use" },
            {
              handler: "subroute",
              routes: [
                {
                  match: [{ not: [{ remote_ip: { ranges: ["10.0.0.0/8"] } }] }],
                  handle: [{ handler: "close" }],
                },
                { handle: [{ handler: "proxy", upstreams: [{ dial: ["localhost:22"] }] }] },
              ],
            },
          ],
        },
      ],
    };
    expect(Layer4ServerSchema.parse(server)).toEqual(server);
  });
});
