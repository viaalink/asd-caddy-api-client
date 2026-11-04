/**
 * caddy-l4 modules, end to end: configs built with the library's layer4
 * builders and schemas are accepted by a real caddy-l4 (pinned build), and
 * traffic flows through them.
 *
 * Stack (its own project and ports, see the file):
 *   docker compose -f tests/integration/docker-compose.layer4-modules.yml up -d --build
 *
 * Caddy provisions every module when a config is loaded (and rejects unknown
 * fields), so a 200 from the admin API means caddy-l4 accepted the JSON as
 * the library built it.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { connect, type Socket } from "net";
import { CaddyClient } from "../../caddy/client.js";
import {
  LAYER4_HANDLERS,
  LAYER4_MATCHERS,
  Layer4MatcherSetSchema,
  Layer4ProxyHandlerSchema,
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
  type Layer4Server,
} from "../../caddy/layer4.js";

const ADMIN = process.env.LAYER4_MODULES_ADMIN_URL ?? "http://127.0.0.1:2022";
const TCP = { host: "127.0.0.1", port: Number(process.env.LAYER4_MODULES_TCP_PORT ?? 17000) };
const PREFIX = "l4mod_";

// Needs its own caddy-l4 stack (tests/integration/docker-compose.layer4-modules.yml): `just test-layer4`.
const enabled = process.env.LAYER4_TEST === "true";

/** Raw admin API call (Origin as CaddyClient sends it, for Caddy 2.11+). */
async function admin(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${ADMIN}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Origin: ADMIN, ...init.headers },
  });
}

async function readServer(name: string): Promise<unknown> {
  const res = await admin(`/config/apps/layer4/servers/${name}`);
  expect(res.status).toBe(200);
  return res.json();
}

/** Send `data`, collect what comes back until the server closes or `ms` passes. */
function exchange(
  data: string,
  ms = 2000
): Promise<{ reply: string; elapsed: number; closed: boolean }> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    let reply = "";
    let firstByteAt = 0;
    const socket: Socket = connect(TCP, () => socket.write(data));
    const done = (closed: boolean) => {
      clearTimeout(timer);
      socket.destroy();
      resolve({ reply, elapsed: (firstByteAt || Date.now()) - started, closed });
    };
    const timer = setTimeout(() => done(false), ms);
    socket.on("data", (chunk) => {
      if (!firstByteAt) firstByteAt = Date.now();
      reply += chunk.toString();
      if (reply.length >= data.length) done(false);
    });
    socket.on("end", () => done(true));
    socket.on("close", () => done(true));
    socket.on("error", (e: NodeJS.ErrnoException) =>
      e.code === "ECONNRESET" ? done(true) : reject(e)
    );
  });
}

describe.skipIf(!enabled)("caddy-l4 modules accept the library's configs", () => {
  const caddy = new CaddyClient({ adminUrl: ADMIN });
  const created: string[] = [];

  async function load(name: string, server: Layer4Server): Promise<void> {
    await caddy.setLayer4Server(`${PREFIX}${name}`, server);
    created.push(`${PREFIX}${name}`);
    expect(await readServer(`${PREFIX}${name}`)).toEqual(server);
  }

  beforeAll(async () => {
    const res = await admin("/config/");
    expect(res.ok).toBe(true);
  });

  afterAll(async () => {
    for (const name of created) {
      await admin(`/config/apps/layer4/servers/${name}`, { method: "DELETE" });
    }
    await admin("/config/apps/http/servers/l4mod_wrapped", { method: "DELETE" });
  });

  test("TLS by SNI: passthrough and terminated routes", async () => {
    await load(
      "sni",
      buildLayer4Server({
        listen: ":7101",
        routes: [
          buildLayer4SniRoute({ id: "l4mod-db", sni: "db.example.com", upstream: "db:5432" }),
          buildLayer4SniRoute({ sni: ["*.internal.test"], upstream: "app:80", terminate: true }),
          buildLayer4Route({
            match: [buildLayer4TlsMatcherSet({ alpn: ["h2", "http/1.1"] })],
            handle: [
              buildLayer4TlsHandler({
                connectionPolicies: [{ match: { sni: ["web.internal.test"] }, alpn: ["h2"] }],
                handshakeTimeout: "10s",
              }),
              buildLayer4ProxyHandler("web:443", { tls: { insecure_skip_verify: true } }),
            ],
          }),
        ],
      })
    );
  });

  test("vars, proxy_protocol, subroute, postgres_tls, tls, socks5, throttle, tee, proxy", async () => {
    await load(
      "handlers",
      buildLayer4Server({
        listen: [":7102"],
        idleTimeout: "5m",
        matchingTimeout: "2s",
        routes: [
          buildLayer4Route({
            handle: [
              { handler: "vars", tier: "gold" },
              buildLayer4ProxyProtocolHandler({
                allow: ["10.0.0.0/8"],
                timeout: "2s",
                fallbackPolicy: "USE",
              }),
              buildLayer4SubrouteHandler({
                matchingTimeout: "1s",
                routes: [
                  buildLayer4Route({
                    match: [buildLayer4PostgresMatcherSet({ tls: "enabled" })],
                    handle: [
                      buildLayer4PostgresTlsHandler(),
                      buildLayer4TlsHandler(),
                      buildLayer4ProxyHandler("postgres:5432"),
                    ],
                  }),
                  buildLayer4Route({
                    match: "socks5",
                    handle: [buildLayer4Socks5Handler({ credentials: { alice: "secret" } })],
                  }),
                  buildLayer4Route({
                    match: [buildLayer4HttpMatcherSet({ host: ["example.com"] })],
                    handle: [
                      buildLayer4ThrottleHandler({ readBytesPerSecond: 1048576, latency: "50ms" }),
                      buildLayer4TeeHandler([buildLayer4ProxyHandler("mirror:80")]),
                      buildLayer4ProxyHandler(["web1:80", "web2:80"], {
                        loadBalancing: { policy: "random_choose", choose: 2 },
                        tryDuration: "2s",
                        healthChecks: {
                          active: { interval: "10s", timeout: "1s" },
                          passive: { fail_duration: "30s", max_fails: 2 },
                        },
                        proxyProtocol: "v2",
                      }),
                    ],
                  }),
                  buildLayer4Route({
                    match: [buildLayer4RemoteIpMatcherSet(["192.0.2.0/24"])],
                    handle: [buildLayer4CloseHandler()],
                  }),
                ],
              }),
            ],
          }),
        ],
      })
    );
  });

  test("every load balancing policy", async () => {
    const policies = [
      "first",
      "ip_hash",
      "least_conn",
      "random",
      "round_robin",
      "weighted_round_robin",
    ] as const;
    await load(
      "policies",
      buildLayer4Server({
        listen: ":7103",
        routes: policies.map((policy, i) =>
          buildLayer4Route({
            match: [buildLayer4RemoteIpMatcherSet(`192.0.2.${i}`)],
            handle: [buildLayer4ProxyHandler(["a:1", "b:2"], { loadBalancing: policy })],
          })
        ),
      })
    );
  });

  test("every matcher module, one route each", async () => {
    // One valid matcher set per caddy-l4 matcher module (TCP ones here, UDP below).
    const tcp: Partial<Record<(typeof LAYER4_MATCHERS)[number], unknown>> = {
      clock: { after: "00:00:00", before: "23:59:59", timezone: "UTC" },
      http: [{ host: ["example.com"], path: ["/api/*"] }],
      local_ip: { ranges: ["0.0.0.0/0"] },
      not: [{ remote_ip: { ranges: ["192.0.2.0/24"] } }],
      openvpn: { modes: ["plain", "auth"] },
      postgres: { user: { app: ["shop"], "*": [] }, client: ["psql"] },
      proxy_protocol: {},
      rdp: { cookie_hash: "alice" },
      regexp: { pattern: "^SSH-", count: 4 },
      remote_ip: { ranges: ["10.0.0.0/8"] },
      socks4: { commands: ["CONNECT"], ports: [443] },
      socks5: { auth_methods: [0, 2] },
      ssh: {},
      tls: { sni: ["db.example.com"], alpn: ["postgresql"] },
      vars: { "{l4.conn.remote_addr}": ["192.0.2.1:1"] },
      vars_regexp: { "{l4.conn.remote_addr}": { pattern: "^10\\." } },
      winbox: { modes: ["standard"], username: "admin" },
      xmpp: {},
      // the IP file may be missing (an empty list), its directory must exist. Every
      // later load replaces this config, which hung Caddy before the caddy-l4 fork's
      // fix (DEPENDENCIES.md, caddy-l4).
      remote_ip_list: { remote_ip_file: "/tmp/l4mod-remote-ips.txt" },
    };
    const udp: Partial<Record<(typeof LAYER4_MATCHERS)[number], unknown>> = {
      dns: { allow: [{ name: "example.com.", type: "A" }], default_deny: true },
      quic: { sni: ["example.com"], alpn: ["h3"] },
      wireguard: {},
    };
    expect(Object.keys({ ...tcp, ...udp }).sort()).toEqual([...LAYER4_MATCHERS].sort());

    const routesFor = (sets: Partial<Record<string, unknown>>) =>
      Object.entries(sets).map(([name, options]) =>
        buildLayer4Route({
          id: `l4mod-${name}`,
          match: [Layer4MatcherSetSchema.parse({ [name]: options })],
          handle: [buildLayer4CloseHandler()],
        })
      );
    await load("matchers_tcp", buildLayer4Server({ listen: ":7104", routes: routesFor(tcp) }));
    await load("matchers_udp", buildLayer4Server({ listen: "udp/:7105", routes: routesFor(udp) }));
  });

  test("the layer4 listener wrapper in front of an HTTP server", async () => {
    const wrapper = buildLayer4ListenerWrapper({
      routes: [buildLayer4ProxyRoute({ upstream: "localhost:22", match: "ssh" })],
    });
    const res = await admin("/config/apps/http/servers/l4mod_wrapped", {
      method: "PUT",
      body: JSON.stringify({
        listen: [":7106"],
        listener_wrappers: [wrapper, { wrapper: "tls" }],
        routes: [],
      }),
    });
    expect(res.status, await res.text()).toBe(200);
  });

  test("what the schemas reject, Caddy rejects too", async () => {
    const bad = { handler: "proxy", upstreams: [{ dial: ["a:1"] }], proxy_protocol: "v3" };
    expect(Layer4ProxyHandlerSchema.safeParse(bad).success).toBe(false);
    const res = await admin(`/config/apps/layer4/servers/${PREFIX}bad`, {
      method: "PUT",
      body: JSON.stringify({ listen: [":7107"], routes: [{ handle: [bad] }] }),
    });
    // (this Caddy answers a failed config load with 500, older ones with 400)
    expect(res.status).toBeGreaterThanOrEqual(400);
    // a matcher of no known module: Caddy has no such module either
    const unknown = await admin(`/config/apps/layer4/servers/${PREFIX}bad`, {
      method: "PUT",
      body: JSON.stringify({
        listen: [":7107"],
        routes: [{ match: [{ mysql: {} }], handle: [{ handler: "close" }] }],
      }),
    });
    expect(unknown.status).toBeGreaterThanOrEqual(400);
  });

  test("traffic: throttle + echo in a subroute, regexp + close", async () => {
    await load(
      "traffic",
      buildLayer4Server({
        listen: ":7000",
        matchingTimeout: "1s",
        routes: [
          buildLayer4Route({
            match: [{ regexp: { pattern: "^QUIT", count: 4 } }],
            handle: [buildLayer4CloseHandler()],
          }),
          buildLayer4Route({
            handle: [
              buildLayer4SubrouteHandler({
                routes: [
                  buildLayer4Route({
                    handle: [
                      buildLayer4ThrottleHandler({ latency: "300ms" }),
                      buildLayer4EchoHandler(),
                    ],
                  }),
                ],
              }),
            ],
          }),
        ],
      })
    );

    let echoed = { reply: "", elapsed: 0, closed: false };
    for (let i = 0; i < 20 && echoed.reply === ""; i++) {
      // Caddy needs a moment to bind the new listener.
      echoed = await exchange("hello layer4\n").catch(() => echoed);
      if (echoed.reply === "") await new Promise((r) => setTimeout(r, 250));
    }
    expect(echoed.reply).toBe("hello layer4\n");
    expect(echoed.elapsed).toBeGreaterThanOrEqual(250);

    const quit = await exchange("QUIT now\n");
    expect(quit.reply).toBe("");
    expect(quit.closed).toBe(true);
  });

  test("every handler module was exercised above", () => {
    // Keeps this file honest when LAYER4_HANDLERS grows.
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
});
