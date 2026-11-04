import { describe, test, expect } from "vitest";
import {
  adminFromCaddyfile,
  adminFromJsonConfig,
  chooseTarget,
  type CaddyTarget,
  DEFAULT_ADMIN_URL,
  discoverTargets,
  type DiscoveryDeps,
  isLocalAdminUrl,
  listenToUrl,
  nameForConfig,
  parseCaddyProcesses,
  parseDockerPorts,
} from "../../vscode-extension/src/providers/caddy-targets.js";

describe("listenToUrl", () => {
  test.each([
    ["localhost:2019", "http://localhost:2019"],
    [":2019", "http://localhost:2019"],
    ["0.0.0.0:2020", "http://localhost:2020"],
    ["127.0.0.1:40385", "http://127.0.0.1:40385"],
    ["tcp/localhost:2019", "http://localhost:2019"],
    ["[::1]:2019", "http://[::1]:2019"],
  ])("%s → %s", (listen, url) => {
    expect(listenToUrl(listen)).toBe(url);
  });
  test("a unix socket is not reachable over HTTP", () => {
    expect(listenToUrl("unix//run/caddy-admin.sock")).toBeUndefined();
  });
});

describe("admin address in a config", () => {
  test("JSON: admin.listen, off, or the default", () => {
    expect(adminFromJsonConfig({ admin: { listen: "localhost:40385" } })).toBe(
      "http://localhost:40385"
    );
    expect(adminFromJsonConfig({ admin: { disabled: true } })).toBeNull();
    expect(adminFromJsonConfig({ apps: {} })).toBeUndefined();
  });
  test("Caddyfile: the admin global option", () => {
    expect(adminFromCaddyfile("{\n  admin :2020\n}\nexample.com {\n}\n")).toBe(
      "http://localhost:2020"
    );
    expect(adminFromCaddyfile("{\n  admin localhost:2019 {\n    origins localhost\n  }\n}\n")).toBe(
      "http://localhost:2019"
    );
    expect(adminFromCaddyfile("{\n  admin off\n}\n")).toBeNull();
    expect(adminFromCaddyfile("{\n  email me@example.com\n}\n")).toBeUndefined();
    expect(adminFromCaddyfile("example.com {\n  respond hi\n}\n")).toBeUndefined();
    expect(adminFromCaddyfile("{\n  # admin off\n  debug\n}\n")).toBeUndefined();
  });
});

describe("parseCaddyProcesses", () => {
  test("finds caddy run/start with their config and adapter, ignores the rest", () => {
    const ps = [
      "  5516 /home/k/.local/share/asd/bin/caddy run --watch --config /home/k/proj/.asd/workspace/caddy/config/resolved-config.json",
      "2378523 caddy run --config /etc/caddy/Caddyfile --adapter caddyfile",
      "  4242 caddy run",
      "  1111 caddy version",
      "  2222 /usr/bin/vim Caddyfile",
      "  3333 caddy run --config=./Caddyfile",
    ].join("\n");
    expect(parseCaddyProcesses(ps)).toEqual([
      { pid: 5516, config: "/home/k/proj/.asd/workspace/caddy/config/resolved-config.json" },
      { pid: 2378523, config: "/etc/caddy/Caddyfile", adapter: "caddyfile" },
      { pid: 4242 },
      { pid: 3333, config: "./Caddyfile" },
    ]);
  });
  test("Windows command lines", () => {
    expect(
      parseCaddyProcesses('812 "C:\\Tools\\caddy.exe" run --config C:\\caddy\\Caddyfile')
    ).toEqual([{ pid: 812, config: "C:\\caddy\\Caddyfile" }]);
  });
});

describe("parseDockerPorts", () => {
  test("containers publishing 2019", () => {
    const out = [
      "web-caddy\t0.0.0.0:80->80/tcp, 0.0.0.0:2020->2019/tcp, [::]:2020->2019/tcp",
      "demo-caddy\t127.0.0.1:39200->2019/tcp",
      "postgres\t0.0.0.0:5432->5432/tcp",
      "internal\t2019/tcp",
    ].join("\n");
    expect(parseDockerPorts(out)).toEqual([
      { container: "web-caddy", adminUrl: "http://localhost:2020" },
      { container: "demo-caddy", adminUrl: "http://127.0.0.1:39200" },
    ]);
  });
});

test("nameForConfig", () => {
  expect(nameForConfig("/home/k/ext/pecu/.asd/workspace/caddy/config/resolved-config.json")).toBe(
    "pecu (Viaalink CLI)"
  );
  expect(nameForConfig("/home/k/ext/MiroFish/workspace/caddy/config/resolved-config.json")).toBe(
    "MiroFish (Viaalink CLI)"
  );
  expect(
    nameForConfig(
      "/home/k/ext/onplia/C:\\\\Users\\\\k\\\\onplia\\\\.asd\\\\workspace/caddy/config/c.json"
    )
  ).toBe("onplia (Viaalink CLI)");
  expect(nameForConfig("/etc/caddy/Caddyfile")).toBe("caddy/Caddyfile");
  expect(nameForConfig(undefined)).toBe("Caddy");
});

describe("isLocalAdminUrl", () => {
  test.each([
    ["http://localhost:2019", true],
    ["http://127.0.0.1:2020", true],
    ["http://[::1]:2019", true],
    ["http://caddy.localhost:2019", true],
    ["http://192.168.1.10:2019", false],
    ["https://admin.example.com", false],
    ["not a url", false],
  ])("%s → %s", (url, local) => {
    expect(isLocalAdminUrl(url)).toBe(local);
  });
});

describe("discoverTargets", () => {
  const deps = (over: Partial<DiscoveryDeps> = {}): DiscoveryDeps => ({
    run: async (cmd) =>
      cmd === "ps"
        ? [
            "10 caddy run --config /p/a/.asd/workspace/caddy/config/c.json",
            "11 caddy run --config /etc/caddy/Caddyfile --adapter caddyfile",
            "12 caddy run --config /p/off.json",
            "13 caddy run --config rel/Caddyfile",
            // inside a container: its config is not on this machine
            "14 caddy run --config /in/container/Caddyfile --adapter caddyfile",
          ].join("\n")
        : cmd === "docker"
          ? "edge\t0.0.0.0:2021->2019/tcp"
          : undefined,
    readFile: async (f) =>
      ({
        "/p/a/.asd/workspace/caddy/config/c.json": JSON.stringify({
          admin: { listen: "localhost:40385" },
        }),
        "/etc/caddy/Caddyfile": "example.com {\n}\n",
        "/p/off.json": JSON.stringify({ admin: { disabled: true } }),
        "/work/rel/Caddyfile": "{\n admin :2030\n}\n",
      })[f],
    cwdOf: async (pid) => (pid === 13 ? "/work" : undefined),
    probe: async (url) => url !== "http://localhost:2030",
    env: {},
    platform: "linux",
    ...over,
  });

  test("processes, Docker and the default, one per address, reachable first", async () => {
    const targets = await discoverTargets(deps());
    expect(targets.map((t) => [t.name, t.adminUrl, t.reachable])).toEqual([
      ["a (Viaalink CLI)", "http://localhost:40385", true],
      // /etc/caddy/Caddyfile has no admin option: Caddy's default address.
      ["caddy/Caddyfile", "http://localhost:2019", true],
      ["edge (Docker)", "http://localhost:2021", true],
      ["rel/Caddyfile", "http://localhost:2030", false],
    ]);
  });

  test("no ps, no docker, nothing at localhost:2019 → nothing", async () => {
    const targets = await discoverTargets(
      deps({ run: async () => undefined, probe: async () => false })
    );
    expect(targets).toEqual([]);
  });

  test("CADDY_ADMIN is a candidate", async () => {
    const targets = await discoverTargets(
      deps({ run: async () => undefined, env: { CADDY_ADMIN: "localhost:2099" } })
    );
    expect(targets[0]).toMatchObject({ name: "CADDY_ADMIN", adminUrl: "http://localhost:2099" });
  });
});

describe("chooseTarget", () => {
  const t = (adminUrl: string, reachable = true): CaddyTarget => ({
    name: adminUrl,
    adminUrl,
    source: "process",
    reachable,
  });

  test("caddy.adminUrl overrides everything", () => {
    expect(
      chooseTarget({
        explicitAdminUrl: "http://localhost:2025/",
        picked: "http://localhost:1",
        configured: [t("http://localhost:2")],
        discovered: [t("http://localhost:3")],
      })
    ).toEqual({ adminUrl: "http://localhost:2025", reason: "caddy.adminUrl setting" });
  });
  test("then the workspace's own pick", () => {
    expect(chooseTarget({ picked: "http://localhost:1", configured: [] }).adminUrl).toBe(
      "http://localhost:1"
    );
  });
  test("then a single configured target; several means ask", () => {
    expect(chooseTarget({ configured: [t("http://localhost:2")] }).adminUrl).toBe(
      "http://localhost:2"
    );
    expect(
      chooseTarget({ configured: [t("http://localhost:2"), t("http://localhost:3")] }).adminUrl
    ).toBeUndefined();
  });
  test("then discovery: one live Caddy is used, several means ask, none falls back", () => {
    expect(chooseTarget({ configured: [] }).adminUrl).toBeUndefined();
    expect(
      chooseTarget({
        configured: [],
        discovered: [t("http://localhost:4"), t("http://localhost:5", false)],
      }).adminUrl
    ).toBe("http://localhost:4");
    expect(
      chooseTarget({
        configured: [],
        discovered: [t("http://localhost:4"), t("http://localhost:5")],
      }).adminUrl
    ).toBeUndefined();
    expect(chooseTarget({ configured: [], discovered: [] }).adminUrl).toBe(DEFAULT_ADMIN_URL);
  });
});
