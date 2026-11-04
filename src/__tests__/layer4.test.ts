import { describe, test, expect, beforeEach, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { CaddyClient } from "../caddy/client.js";
import {
  buildLayer4ProxyHandler,
  buildLayer4ProxyRoute,
  buildLayer4Server,
  Layer4RouteSchema,
} from "../caddy/layer4.js";
import { CaddyApiClientError, ValidationError } from "../errors.js";
import {
  MitmproxyManager,
  mitmproxyAddonPath,
  mitmproxyAddonSource,
  mitmproxyReverseTcpMode,
  writeMitmproxyAddon,
} from "../mitm/index.js";

const mockFetch = vi.fn();
global.fetch = mockFetch as typeof fetch;

const ok = (body: unknown = null): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
const status = (code: number, text = ""): Response => new Response(text, { status: code });

describe("layer4 builders", () => {
  test("proxy handler: one upstream per address, as caddy-l4 wants them", () => {
    expect(buildLayer4ProxyHandler("postgres:5432")).toEqual({
      handler: "proxy",
      upstreams: [{ dial: ["postgres:5432"] }],
    });
    expect(buildLayer4ProxyHandler(["a:1", "b:2"], { proxyProtocol: "v2" })).toEqual({
      handler: "proxy",
      upstreams: [{ dial: ["a:1"] }, { dial: ["b:2"] }],
      proxy_protocol: "v2",
    });
  });

  test("route: @id, a protocol matcher by name, the proxy handler", () => {
    expect(
      buildLayer4ProxyRoute({ id: "pg", upstream: "postgres:5432", match: "postgres" })
    ).toEqual({
      "@id": "pg",
      match: [{ postgres: {} }],
      handle: [{ handler: "proxy", upstreams: [{ dial: ["postgres:5432"] }] }],
    });
    const sni = [{ tls: { sni: ["db.example.com"] } }];
    expect(buildLayer4ProxyRoute({ upstream: "x:1", match: sni })).toMatchObject({ match: sni });
    expect(buildLayer4ProxyRoute({ upstream: "x:1" })).not.toHaveProperty("match");
  });

  test("server: listen is always a list", () => {
    const route = buildLayer4ProxyRoute({ id: "pg", upstream: "postgres:5432" });
    expect(buildLayer4Server({ listen: ":5432", routes: [route] })).toEqual({
      listen: [":5432"],
      routes: [route],
    });
  });

  test("invalid input is rejected", () => {
    expect(() => buildLayer4ProxyHandler([])).toThrow();
    expect(() => buildLayer4ProxyHandler("")).toThrow();
    expect(Layer4RouteSchema.safeParse({ handle: [] }).success).toBe(false);
    // Other handlers pass through, checked for their name only.
    expect(
      Layer4RouteSchema.safeParse({ handle: [{ handler: "tls", connection_policies: [] }] }).success
    ).toBe(true);
  });
});

describe("CaddyClient layer4", () => {
  beforeEach(() => mockFetch.mockReset());
  const route = buildLayer4ProxyRoute({ id: "pg", upstream: "mitm:5432", match: "postgres" });

  test("putLayer4Route replaces an existing route in place with PATCH /id/", async () => {
    mockFetch.mockResolvedValueOnce(ok());
    const result = await new CaddyClient().putLayer4Route("db", route);
    expect(result).toBe("replaced");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:2019/id/pg");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual(route);
  });

  test("putLayer4Route appends to the server when the @id is unknown (404)", async () => {
    mockFetch.mockResolvedValueOnce(status(404, '{"error":"unknown object ID \'pg\'"}'));
    mockFetch.mockResolvedValueOnce(ok());
    expect(await new CaddyClient().putLayer4Route("db", route)).toBe("added");
    const [url, init] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:2019/config/apps/layer4/servers/db/routes/...");
    expect(init.method).toBe("POST");
  });

  test("putLayer4Route passes other errors on and needs an @id", async () => {
    mockFetch.mockResolvedValueOnce(status(500, "boom"));
    await expect(new CaddyClient().putLayer4Route("db", route)).rejects.toThrow(/500/);
    const { "@id": _id, ...noId } = route;
    await expect(new CaddyClient().putLayer4Route("db", noId)).rejects.toThrow(CaddyApiClientError);
    await expect(
      new CaddyClient().putLayer4Route("db", { "@id": "x", handle: [] })
    ).rejects.toThrow(ValidationError);
  });

  test("putLayer4Route appends with routes/... so a server without a routes key works too", async () => {
    mockFetch.mockResolvedValueOnce(status(404, '{"error":"unknown object ID \'pg\'"}'));
    mockFetch.mockResolvedValueOnce(ok());
    await new CaddyClient().putLayer4Route("db", route);
    const [url, init] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:2019/config/apps/layer4/servers/db/routes/...");
    expect(JSON.parse(init.body as string)).toEqual([route]);
  });

  test("putLayer4Route on a server that does not exist says so", async () => {
    // What Caddy answers a write below a missing key: 500 + "invalid traversal path".
    mockFetch.mockResolvedValueOnce(status(404, '{"error":"unknown object ID \'pg\'"}'));
    mockFetch.mockResolvedValueOnce(
      status(500, '{"error":"invalid traversal path at: config/apps/layer4/servers/ghost/routes"}')
    );
    await expect(new CaddyClient().putLayer4Route("ghost", route)).rejects.toThrow(
      /no layer4 server "ghost"/
    );
  });

  describe("setLayer4Server writes at the deepest key that exists", () => {
    const server = buildLayer4Server({ listen: ":5432", routes: [route] });
    const cases: [string, unknown, string, unknown][] = [
      [
        "apps.layer4.servers exists",
        { apps: { layer4: { servers: {} } } },
        "/config/apps/layer4/servers/db",
        server,
      ],
      [
        "apps.layer4 without servers",
        { apps: { layer4: {} } },
        "/config/apps/layer4/servers",
        { db: server },
      ],
      [
        "apps without layer4",
        { apps: { http: {} } },
        "/config/apps/layer4",
        { servers: { db: server } },
      ],
      [
        "a config without apps",
        { admin: { listen: ":2019" } },
        "/config/apps",
        { layer4: { servers: { db: server } } },
      ],
      [
        "no config at all (null)",
        null,
        "/config/",
        { apps: { layer4: { servers: { db: server } } } },
      ],
    ];
    test.each(cases)("%s", async (_name, config, path, body) => {
      mockFetch.mockResolvedValueOnce(ok(config));
      mockFetch.mockResolvedValueOnce(ok());
      await new CaddyClient().setLayer4Server("db", server);
      const [url, init] = mockFetch.mock.calls[1] as [string, RequestInit];
      expect(url).toBe(`http://127.0.0.1:2019${path}`);
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual(body);
    });
  });

  test("getLayer4Servers: apps.layer4 missing (Caddy's 400 invalid traversal path) is {}", async () => {
    // This is what Caddy really answers: not a null body, an HTTP 400.
    mockFetch.mockResolvedValueOnce(
      status(400, '{"error":"invalid traversal path at: config/apps/layer4/servers"}')
    );
    expect(await new CaddyClient().getLayer4Servers()).toEqual({});
  });

  test("getLayer4Servers: apps.layer4 without servers (200 null) is {}", async () => {
    mockFetch.mockResolvedValueOnce(ok(null));
    expect(await new CaddyClient().getLayer4Servers()).toEqual({});
  });

  test("getLayer4Servers: other errors are still thrown", async () => {
    mockFetch.mockResolvedValueOnce(status(400, '{"error":"something else"}'));
    await expect(new CaddyClient().getLayer4Servers()).rejects.toThrow(/400/);
    mockFetch.mockResolvedValueOnce(status(500, "boom"));
    await expect(new CaddyClient().getLayer4Servers()).rejects.toThrow(/500/);
    mockFetch.mockResolvedValueOnce(
      status(403, '{"error":"client is not allowed to access from origin"}')
    );
    await expect(new CaddyClient().getLayer4Servers()).rejects.toThrow(/403/);
  });
});

describe("MitmproxyManager with a TCP service", () => {
  const caddy = () => {
    const put = vi.fn().mockResolvedValue("replaced");
    const addRoute = vi.fn();
    const removeRouteById = vi.fn();
    const client = { putLayer4Route: put, addRoute, removeRouteById } as unknown as CaddyClient;
    return { client, put, addRoute, removeRouteById };
  };

  test("enable points the layer4 route at mitmproxy, disable back at the backend", async () => {
    const { client, put, addRoute, removeRouteById } = caddy();
    const manager = new MitmproxyManager(client, {
      default: { host: "mitmproxy", port: 8080 },
      postgres: { host: "mitmproxy", port: 5432 },
    });
    manager.register({
      protocol: "tcp",
      id: "db",
      serverId: "pg",
      backend: { host: "postgres", port: 5432 },
      match: "postgres",
      proxy: "postgres",
    });

    await manager.enable("db");
    expect(put).toHaveBeenLastCalledWith("pg", {
      "@id": "mitm_db",
      match: [{ postgres: {} }],
      handle: [{ handler: "proxy", upstreams: [{ dial: ["mitmproxy:5432"] }] }],
    });
    expect(manager.getServiceStatus("db")).toMatchObject({ enabled: true, proxy: "postgres" });

    await manager.disable("db");
    expect(put).toHaveBeenLastCalledWith("pg", {
      "@id": "mitm_db",
      match: [{ postgres: {} }],
      handle: [{ handler: "proxy", upstreams: [{ dial: ["postgres:5432"] }] }],
    });
    expect(manager.isEnabled("db")).toBe(false);
    // The HTTP route methods are not touched for a TCP service.
    expect(addRoute).not.toHaveBeenCalled();
    expect(removeRouteById).not.toHaveBeenCalled();
  });

  test("enable({ proxy }) overrides the service's own proxy", async () => {
    const { client, put } = caddy();
    const manager = new MitmproxyManager(client, {
      default: { host: "mitmproxy", port: 8080 },
      other: { host: "mitm-2", port: 6543 },
    });
    manager.register({
      protocol: "tcp",
      id: "db",
      serverId: "pg",
      backend: { host: "postgres", port: 5432 },
    });
    await manager.enable("db", { proxy: "other" });
    expect(put).toHaveBeenLastCalledWith(
      "pg",
      expect.objectContaining({
        handle: [{ handler: "proxy", upstreams: [{ dial: ["mitm-2:6543"] }] }],
      })
    );
  });
});

describe("mitmproxy helpers", () => {
  test("reverse TCP mode string", () => {
    expect(mitmproxyReverseTcpMode({ host: "postgres", port: 5432 }, 6432)).toBe(
      "reverse:tcp://postgres:5432@6432"
    );
  });
  test("the pgwire addon ships with the package", () => {
    const file = mitmproxyAddonPath("pgwire");
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toContain("def tcp_message");
  });
  test("the embedded source is the file (else: bun run generate:mitmproxy-addons)", () => {
    expect(mitmproxyAddonSource("pgwire")).toBe(readFileSync(mitmproxyAddonPath("pgwire"), "utf8"));
  });
  test("writeMitmproxyAddon writes it out, for compiled programs", () => {
    const dir = mkdtempSync(join(tmpdir(), "addon-"));
    try {
      const file = writeMitmproxyAddon("pgwire", join(dir, "nested"));
      expect(file).toBe(join(dir, "nested", "pgwire.py"));
      expect(readFileSync(file, "utf8")).toBe(mitmproxyAddonSource("pgwire"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
