/**
 * MySQL 8, MariaDB 11 and Redis 7 over TCP, end to end, driven by the library:
 *
 *   client → Caddy layer4 (caddy-l4) → database
 *                      ↘ mitmweb-tcp (reverse:tcp, one listener per database) → database
 *
 * ONE mitmweb loads pgwire, mysqlwire and rediswire together, the way the
 * Viaalink CLI can run them: each addon decodes only flows of its own protocol,
 * whatever the port. A Postgres flow goes through the same mitmweb to prove it.
 *
 * Stack: tests/integration/docker-compose.layer4.yml
 *   just test-layer4   (brings the stack up, then runs this file with LAYER4_TEST=true)
 *
 * What is proven here, per database:
 *   1. the library builds a layer4 server and the database answers through it;
 *   2. MitmproxyManager.enable() swaps the route and the transcript in mitmweb
 *      shows the server (MySQL or MariaDB), the SQL / commands, the parameters
 *      of prepared statements, the results and the errors;
 *   3. the "MySQL" / "Redis" content view decodes each TCP message (Stream
 *      Data) and is picked automatically;
 *   4. passwords are neither in the transcript, nor in the Raw view, nor in the
 *      stored flow (mitmweb's flow dump).
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { createConnection, type Connection } from "mysql2/promise";
import { Redis } from "ioredis";
import { connect as tcpConnect } from "node:net";
import pg from "pg";
import { CaddyClient } from "../../caddy/client.js";
import { buildLayer4ProxyRoute, buildLayer4Server } from "../../caddy/layer4.js";
import { MitmproxyManager } from "../../mitm/manager.js";

const ADMIN = process.env.LAYER4_ADMIN_URL ?? "http://127.0.0.1:2021";
const MITMWEB = process.env.LAYER4_MITMWEB_TCP_URL ?? "http://127.0.0.1:18082";
const MITMWEB_TOKEN = process.env.LAYER4_MITMWEB_TOKEN ?? "layer4-test";

// Test-only credentials of throwaway containers (docker-compose.layer4.yml).
const MYSQL_PASSWORD = "Mysql-Secret-4711";
const MARIADB_PASSWORD = "Mariadb-Secret-4711";
const REDIS_PASSWORD = "Redis-Secret-4711";

interface Flow {
  id: string;
  type: string;
  comment?: string;
}

interface RenderedMessage {
  text: string;
  view_name: string | null;
  from_client?: boolean;
}

interface RawRenderedMessage {
  text?: string;
  view_name?: string | null;
  lines?: [string, string][][];
  description?: string;
  from_client?: boolean;
}

function normalise(m: RawRenderedMessage): RenderedMessage {
  return {
    text: m.text ?? (m.lines ?? []).map((line) => line.map(([, t]) => t).join("")).join("\n"),
    view_name: m.view_name !== undefined ? m.view_name : (m.description ?? null),
    from_client: m.from_client,
  };
}

function mitmweb(path: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(`${MITMWEB}${path}`);
  url.searchParams.set("token", MITMWEB_TOKEN);
  return fetch(url, { ...init, headers: { Host: url.host, ...init.headers } });
}

async function flows(): Promise<Flow[]> {
  const res = await mitmweb("/flows");
  expect(res.status).toBe(200);
  return (await res.json()) as Flow[];
}

async function renderedMessages(flowId: string, view: string): Promise<RenderedMessage[]> {
  const res = await mitmweb(`/flows/${flowId}/messages/content/${encodeURIComponent(view)}.json`);
  expect(res.status).toBe(200);
  return ((await res.json()) as RawRenderedMessage[]).map(normalise);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The TCP flow whose transcript contains `marker` (the addon writes after each message). */
async function flowWith(marker: string): Promise<Flow> {
  for (let i = 0; i < 20; i++) {
    await sleep(250);
    const found = (await flows()).find((f) => f.type === "tcp" && f.comment?.includes(marker));
    if (found) return found;
  }
  throw new Error(`no TCP flow with ${JSON.stringify(marker)}`);
}

async function clearFlows(): Promise<void> {
  const res = await mitmweb("/clear", {
    method: "POST",
    headers: { Cookie: "_xsrf=t", "X-XSRFToken": "t" },
  });
  expect(res.status).toBe(200);
}

async function flowDump(): Promise<Buffer> {
  const dump = await mitmweb("/flows/dump");
  expect(dump.status).toBe(200);
  return Buffer.from(await dump.arrayBuffer());
}

/** Retry until Caddy has bound a new listener and the database accepts connections. */
async function retry<T>(fn: () => Promise<T>, attempts = 40): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= attempts - 1) throw e;
      await sleep(500);
    }
  }
}

/**
 * Check the Stream Data side of a flow: every message renders with `view`,
 * without errors, and "auto" picks that view by itself.
 */
async function expectContentView(flow: Flow, view: string, contains: string[]): Promise<void> {
  const decoded = await renderedMessages(flow.id, view);
  expect(decoded.length).toBeGreaterThan(0);
  for (const m of decoded) {
    expect(m.view_name).toBe(view);
    expect(m.text).not.toMatch(/Traceback|Couldn't parse|Error:|could not decode/);
  }
  const all = decoded.map((m) => m.text).join("\n");
  for (const line of contains) expect(all).toContain(line);
  const auto = await renderedMessages(flow.id, "auto");
  expect(auto.map((m) => m.view_name)).toEqual(decoded.map(() => view));
}

/** The password is in no transcript, not in the Raw view, not in the stored flows. */
async function expectHidden(flow: Flow, secret: string, marker: string): Promise<void> {
  expect(flow.comment).not.toContain(secret);
  const raw = (await renderedMessages(flow.id, "Raw")).map((m) => m.text).join("\n");
  expect(raw).toContain(marker);
  expect(raw).not.toContain(secret);
  const dump = await flowDump();
  expect(dump.length).toBeGreaterThan(0);
  expect(dump.includes(Buffer.from(secret))).toBe(false);
}

const enabled = process.env.LAYER4_TEST === "true";

const caddy = new CaddyClient({ adminUrl: ADMIN });
const manager = new MitmproxyManager(caddy, {
  default: { host: "mitmproxy-tcp", port: 8080 },
  mysql: { host: "mitmproxy-tcp", port: 3306 },
  mariadb: { host: "mitmproxy-tcp", port: 3307 },
  redis: { host: "mitmproxy-tcp", port: 6379 },
});

// MySQL and Redis have no caddy-l4 matcher (and a MySQL server speaks first,
// so nothing could be matched before it): each gets a listener of its own.
const SERVICES = [
  { id: "mysql", listen: ":3306", backend: { host: "mysql", port: 3306 } },
  { id: "mariadb", listen: ":3307", backend: { host: "mariadb", port: 3306 } },
  { id: "redis", listen: ":6379", backend: { host: "redis", port: 6379 } },
] as const;

// MySQL and MariaDB compare text case-insensitively by default; the category
// column is binary, so 'electronics' misses 'Electronics' as it does in Postgres.
const SEED = [
  "drop table if exists products",
  "create table products (id int auto_increment primary key, name varchar(100), category varchar(50) collate utf8mb4_bin, price decimal(10,2))",
  "create table if not exists orders (id int auto_increment primary key, product_id int)",
  "truncate products",
  "insert into products (name, category, price) values ('Mechanical Keyboard','Electronics',149.99), ('Wireless Mouse','Electronics',29.99), ('Cookbook','Books',19.50)",
];

describe.skipIf(!enabled)("MySQL, MariaDB and Redis over TCP: Caddy layer4 + one mitmweb", () => {
  beforeAll(async () => {
    for (const s of SERVICES) {
      await caddy.setLayer4Server(
        `it_${s.id}`,
        buildLayer4Server({
          listen: s.listen,
          routes: [
            buildLayer4ProxyRoute({
              id: `mitm_${s.id}`,
              upstream: `${s.backend.host}:${s.backend.port}`,
            }),
          ],
        })
      );
      manager.register({
        protocol: "tcp",
        id: s.id,
        serverId: `it_${s.id}`,
        backend: s.backend,
        proxy: s.id,
      });
    }
    // Postgres straight into the same mitmweb (its pgwire), on Caddy :5433.
    await caddy.setLayer4Server(
      "it_pg_tcp",
      buildLayer4Server({
        listen: ":5433",
        routes: [buildLayer4ProxyRoute({ id: "it_pg_tcp", upstream: "mitmproxy-tcp:5432" })],
      })
    );
    // Seed, direct (not inspected yet). This also fills MySQL's
    // caching_sha2_password cache, so the inspected logins take the fast path.
    for (const [port, password] of [
      [13306, MYSQL_PASSWORD],
      [13307, MARIADB_PASSWORD],
    ] as const) {
      const c = await retry(() =>
        createConnection({ host: "127.0.0.1", port, user: "shop", password, database: "shop" })
      );
      for (const sql of SEED) await c.query(sql);
      await c.end();
    }
    const r = new Redis({
      host: "127.0.0.1",
      port: 16379,
      password: REDIS_PASSWORD,
      lazyConnect: true,
    });
    await retry(() => r.connect());
    await r.del("product:7", "bestsellers", "cart:42");
    await r.quit();
    await clearFlows();
    for (const s of SERVICES) await manager.enable(s.id);
  }, 90000);

  afterAll(async () => {
    for (const s of SERVICES) await manager.disable(s.id).catch(() => undefined);
  });

  test("enable() points every layer4 route at the one mitmweb", async () => {
    const servers = await caddy.getLayer4Servers();
    expect(servers.it_mysql?.routes[0]?.handle[0]).toMatchObject({
      upstreams: [{ dial: ["mitmproxy-tcp:3306"] }],
    });
    expect(servers.it_mariadb?.routes[0]?.handle[0]).toMatchObject({
      upstreams: [{ dial: ["mitmproxy-tcp:3307"] }],
    });
    expect(servers.it_redis?.routes[0]?.handle[0]).toMatchObject({
      upstreams: [{ dial: ["mitmproxy-tcp:6379"] }],
    });
  });

  const SQL_DBS = [
    {
      name: "MySQL",
      port: 13306,
      password: MYSQL_PASSWORD,
      version: /← SERVER {2}MySQL 8\.\d+\.\d+ /,
      marker: "MYSQL",
    },
    {
      name: "MariaDB",
      port: 13307,
      password: MARIADB_PASSWORD,
      version: /← SERVER {2}MariaDB 11\.\d+\.\d+ /,
      marker: "MARIADB",
    },
  ] as const;

  describe.each(SQL_DBS)("$name", (db) => {
    let c: Connection;
    let transcript = "";
    let flow: Flow;

    beforeAll(async () => {
      c = await retry(() =>
        createConnection({
          host: "127.0.0.1",
          port: db.port,
          user: "shop",
          password: db.password,
          database: "shop",
        })
      );
      // The text protocol (COM_QUERY): the lower-case category finds nothing.
      const [miss] = await c.query(
        `select name, price from products where category = 'electronics' /* ${db.marker} */`
      );
      expect(miss).toHaveLength(0);
      // A prepared statement (COM_STMT_PREPARE / COM_STMT_EXECUTE) with parameters.
      const sql =
        "select name, price from products where category = ? and price < ? order by price";
      const [hit] = await c.execute(sql, ["Electronics", 200]);
      expect(hit).toHaveLength(2);
      await expect(c.query("select nonexistent from products")).rejects.toThrow(/nonexistent/);
      await c.query("insert into orders (product_id) values (2)");
      await c.end();
      flow = await flowWith(db.marker);
      transcript = flow.comment ?? "";
    }, 30000);

    test("the transcript: server, SQL, prepared statement with parameters, rows, errors", () => {
      expect(transcript).toMatch(db.version);
      expect(transcript).toMatch(
        /→ CONNECT {2}user=shop database=shop .*\(credentials not shown\)/
      );
      expect(transcript).toContain("← LOGIN  ok");
      expect(transcript).toContain(
        `→ SQL  select name, price from products where category = 'electronics' /* ${db.marker} */`
      );
      expect(transcript).toContain("← COLUMNS  name, price");
      expect(transcript).toContain("← DONE  0 rows returned");
      expect(transcript).toContain(
        "→ PREPARE  select name, price from products where category = ? and price < ? order by price"
      );
      expect(transcript).toMatch(/← PREPARED {2}stmt \d+ {2}\(2 parameters, 2 columns\)/);
      expect(transcript).toMatch(/→ EXECUTE {2}stmt \d+ {2}\?1='Electronics', \?2=200/);
      expect(transcript).toContain("← ROW  'Wireless Mouse', '29.99'");
      expect(transcript).toContain("← ROW  'Mechanical Keyboard', '149.99'");
      expect(transcript).toContain("← DONE  2 rows returned");
      expect(transcript).toContain("→ SQL  select nonexistent from products");
      expect(transcript).toMatch(
        /← ERROR {2}1054 \(42S22\) Unknown column 'nonexistent' in '(field list|SELECT)'/
      );
      expect(transcript).toMatch(/← OK {2}1 row affected, insert id \d+/);
      expect(transcript).not.toMatch(/could not decode/);
    });

    test("Stream Data: the MySQL content view decodes each TCP message", async () => {
      await expectContentView(flow, "MySQL", [
        `→ SQL  select name, price from products where category = 'electronics' /* ${db.marker} */`,
        "← ROW  'Wireless Mouse', '29.99'",
      ]);
    });

    test("the password and the auth response are not in the stored flow", async () => {
      await expectHidden(flow, db.password, "(mysqlwire: login message hidden");
    });
  });

  describe("Redis", () => {
    let transcript = "";
    let flow: Flow;
    let resp2: Flow;

    beforeAll(async () => {
      const r = new Redis({
        host: "127.0.0.1",
        port: 16379,
        password: REDIS_PASSWORD,
        connectionName: "shop-api",
      });
      await r.hset("product:7", "name", "Wireless Mouse", "price", "29.99");
      expect(await r.hgetall("product:7")).toEqual({ name: "Wireless Mouse", price: "29.99" });
      expect(await r.get("cart:42")).toBeNull();
      await r.zadd("bestsellers", 30, "keyboard", 20, "mouse", 10, "hub");
      expect(await r.zrevrange("bestsellers", 0, 1)).toEqual(["keyboard", "mouse"]);
      await expect(r.incr("product:7")).rejects.toThrow(/WRONGTYPE/);
      await r.quit();
      flow = await flowWith("HGETALL");
      transcript = flow.comment ?? "";

      // RESP2 and a plain AUTH, the way older clients (and redis-cli) talk.
      await new Promise<void>((resolve, reject) => {
        const s = tcpConnect(16379, "127.0.0.1");
        let got = "";
        s.on("data", (d) => {
          got += d.toString("latin1");
          if (got.includes("29.99")) s.end();
        });
        s.on("end", resolve);
        s.on("error", reject);
        const cmd = (...args: string[]) =>
          `*${args.length}\r\n` + args.map((a) => `$${Buffer.byteLength(a)}\r\n${a}\r\n`).join("");
        s.write(
          cmd("AUTH", REDIS_PASSWORD) +
            cmd("CLIENT", "SETNAME", "resp2-check") +
            cmd("HGETALL", "product:7")
        );
      });
      resp2 = await flowWith("SETNAME 'resp2-check'");
    }, 30000);

    test("the transcript: commands with arguments, replies summarised (RESP3)", () => {
      // ioredis 6 opens with HELLO 3 (RESP3), its password inside.
      expect(transcript).toContain("→ HELLO  3 AUTH (credentials not shown)");
      expect(transcript).toMatch(
        /← MAP {2}\d+ entries: \{'server'='redis', 'version'='7\.\d+\.\d+', 'proto'=3/
      );
      expect(transcript).toContain("← OK");
      expect(transcript).toContain("→ CLIENT  SETNAME 'shop-api'");
      expect(transcript).toContain("→ HSET  'product:7' 'name' 'Wireless Mouse' 'price' '29.99'");
      expect(transcript).toContain("← INTEGER  2");
      expect(transcript).toContain("→ HGETALL  'product:7'");
      expect(transcript).toContain("← MAP  2 entries: {'name'='Wireless Mouse', 'price'='29.99'}");
      expect(transcript).toContain("→ GET  'cart:42'");
      expect(transcript).toContain("← NIL");
      expect(transcript).toContain("→ ZREVRANGE  'bestsellers' '0' '1'");
      expect(transcript).toContain("← ARRAY  2 items: ['keyboard', 'mouse']");
      expect(transcript).toContain("→ INCR  'product:7'");
      expect(transcript).toContain(
        "← ERROR  WRONGTYPE Operation against a key holding the wrong kind of value"
      );
      expect(transcript).toContain("→ QUIT");
      expect(transcript).not.toMatch(/could not decode/);
    });

    test("RESP2: AUTH hidden, arrays decoded", () => {
      expect(resp2.comment?.split("\n")).toEqual([
        "→ AUTH  (credentials not shown)",
        "→ CLIENT  SETNAME 'resp2-check'",
        "→ HGETALL  'product:7'",
        "← OK",
        "← OK",
        "← ARRAY  4 items: ['name', 'Wireless Mouse', 'price', '29.99']",
      ]);
    });

    test("Stream Data: the Redis content view decodes each TCP message", async () => {
      await expectContentView(flow, "Redis", [
        "→ HGETALL  'product:7'",
        "← MAP  2 entries: {'name'='Wireless Mouse', 'price'='29.99'}",
      ]);
    });

    test("the password is not in the stored flow (HELLO … AUTH and AUTH)", async () => {
      await expectHidden(flow, REDIS_PASSWORD, "(rediswire: message with credentials hidden");
      await expectHidden(resp2, REDIS_PASSWORD, "(rediswire: message with credentials hidden");
    });
  });

  test("Postgres through the same mitmweb: pgwire decodes it, the others leave it alone", async () => {
    const c = await retry(async () => {
      const client = new pg.Client({
        host: "127.0.0.1",
        port: 15433,
        user: "demo",
        password: "demo",
        database: "shop",
        ssl: false,
      });
      await client.connect();
      return client;
    });
    await c.query("select 'one mitmweb, four databases' as marker");
    await c.end();
    const flow = await flowWith("one mitmweb, four databases");
    expect(flow.comment).toContain("→ CONNECT  user=demo database=shop");
    expect(flow.comment).not.toMatch(/SERVER {2}My|could not decode/);
    await expectContentView(flow, "Postgres", ["→ SQL  select 'one mitmweb, four databases'"]);
  });

  test("each flow was decoded by exactly one addon", async () => {
    for (const f of (await flows()).filter((x) => x.type === "tcp")) {
      const kinds = [
        /SERVER {2}(MySQL|MariaDB)/.test(f.comment ?? ""),
        /→ (AUTH|HELLO|HSET|PING) /.test(f.comment ?? ""),
        /→ CONNECT {2}user=demo/.test(f.comment ?? ""),
      ].filter(Boolean);
      expect(kinds.length, f.comment).toBe(1);
    }
  });

  test("disable(): new connections go straight to the databases again", async () => {
    for (const s of SERVICES) await manager.disable(s.id);
    await clearFlows();
    const c = await createConnection({
      host: "127.0.0.1",
      port: 13306,
      user: "shop",
      password: MYSQL_PASSWORD,
      database: "shop",
    });
    await c.query("select 'after disable' as marker");
    await c.end();
    await sleep(500);
    expect((await flows()).filter((f) => f.type === "tcp")).toEqual([]);
  });
});
