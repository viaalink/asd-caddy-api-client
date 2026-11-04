/**
 * SQL inspection over TCP, end to end, driven by the library:
 *
 *   pg client → Caddy layer4 (caddy-l4) → Postgres
 *                         ↘ mitmproxy reverse:tcp + pgwire addon → Postgres
 *
 * Stack: tests/integration/docker-compose.layer4.yml
 *   just test-layer4   (brings the stack up, then runs this file with LAYER4_TEST=true)
 *
 * What is proven here:
 *   1. the library builds a layer4 server and Postgres answers through it;
 *   2. MitmproxyManager.enable() swaps the route in place and mitmproxy shows
 *      the SQL, its parameters, the result and errors, in readable form;
 *   3. a connection that was already open keeps its path (TCP is routed once);
 *   4. disable() sends new connections straight to Postgres again;
 *   5. the addon's "Postgres" content view decodes each TCP message in mitmweb
 *      (Stream Data), and a cleartext password never reaches the stored flow.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { CaddyClient } from "../../caddy/client.js";
import { buildLayer4ProxyRoute, buildLayer4Server } from "../../caddy/layer4.js";
import { MitmproxyManager } from "../../mitm/manager.js";

const ADMIN = process.env.LAYER4_ADMIN_URL ?? "http://127.0.0.1:2021";
const MITMWEB = process.env.LAYER4_MITMWEB_URL ?? "http://127.0.0.1:18081";
// mitmweb's web_password in docker-compose.layer4.yml (mitmproxy 11.1+ requires one).
const MITMWEB_TOKEN = process.env.LAYER4_MITMWEB_TOKEN ?? "layer4-test";
const PG = { host: "127.0.0.1", port: 15432, user: "demo", password: "demo", database: "shop" };
// Logs in with AuthenticationCleartextPassword (pg_hba `password`), see the compose file.
const CLEAR_PASSWORD = "Cleartext-Secret-4711";
const SERVER = "pg";
const SERVICE = "shopdb";

interface Flow {
  id: string;
  type: string;
  comment?: string;
}

/** One TCP message as mitmweb renders it with a content view. */
interface RenderedMessage {
  text: string;
  view_name: string | null;
  from_client?: boolean;
}

/**
 * mitmweb 12 answers `{ text, view_name }` per message; 10 and 11 answer
 * `{ lines: [[[style, text], …], …], description }`. Both, as one shape.
 */
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
  // ?token= works on every mitmweb with a password (11.1+); 12 also takes
  // `Authorization: Bearer`, 11.1 does not. Earlier versions ignore both.
  const url = new URL(`${MITMWEB}${path}`);
  url.searchParams.set("token", MITMWEB_TOKEN);
  return fetch(url, { ...init, headers: { Host: url.host, ...init.headers } });
}

async function flows(): Promise<Flow[]> {
  const res = await mitmweb("/flows");
  expect(res.status).toBe(200);
  return (await res.json()) as Flow[];
}

/** Every message of a TCP flow, rendered by the named content view (Stream Data). */
async function renderedMessages(flowId: string, view: string): Promise<RenderedMessage[]> {
  const res = await mitmweb(`/flows/${flowId}/messages/content/${encodeURIComponent(view)}.json`);
  expect(res.status).toBe(200);
  return ((await res.json()) as RawRenderedMessage[]).map(normalise);
}

/** The TCP flow whose transcript contains `marker`. */
async function flowWith(marker: string): Promise<Flow> {
  await new Promise((r) => setTimeout(r, 400));
  const found = (await flows()).find((f) => f.type === "tcp" && f.comment?.includes(marker));
  if (!found) throw new Error(`no TCP flow with ${JSON.stringify(marker)}`);
  return found;
}

/** The decoded transcript of every TCP flow mitmproxy has seen. */
async function transcript(): Promise<string> {
  // The addon writes after each message; give the last one a moment to land.
  await new Promise((r) => setTimeout(r, 400));
  return (await flows())
    .filter((f) => f.type === "tcp")
    .map((f) => f.comment ?? "")
    .join("\n");
}

async function clearFlows(): Promise<void> {
  const res = await mitmweb("/clear", {
    method: "POST",
    headers: { Cookie: "_xsrf=t", "X-XSRFToken": "t" },
  });
  expect(res.status).toBe(200);
}

async function connect(): Promise<pg.Client> {
  const client = new pg.Client({ ...PG, ssl: false });
  await client.connect();
  return client;
}

// Own switch: this file needs its own stack, not docker-compose.test.yml.
const enabled = process.env.LAYER4_TEST === "true";

function pgServer() {
  return buildLayer4Server({
    listen: ":5432",
    routes: [
      buildLayer4ProxyRoute({
        id: `mitm_${SERVICE}`,
        upstream: "postgres:5432",
        match: "postgres",
      }),
    ],
  });
}

describe.skipIf(!enabled)("SQL over TCP: Caddy layer4 + mitmproxy + pgwire", () => {
  const caddy = new CaddyClient({ adminUrl: ADMIN });
  const manager = new MitmproxyManager(caddy, {
    default: { host: "mitmproxy", port: 8080 },
    postgres: { host: "mitmproxy", port: 5432 },
  });

  beforeAll(async () => {
    // Postgres straight behind a layer4 server, built by the library.
    await caddy.setLayer4Server(SERVER, pgServer());
    manager.register({
      protocol: "tcp",
      id: SERVICE,
      serverId: SERVER,
      backend: { host: "postgres", port: 5432 },
      match: "postgres",
      proxy: "postgres",
    });
    // Caddy needs a moment to bind the new listener.
    for (let i = 0; i < 20; i++) {
      try {
        const c = await connect();
        await c.query(
          "create table if not exists products(id serial primary key, name text, category text, price numeric)"
        );
        await c.query("truncate products");
        await c.query(
          "insert into products(name, category, price) values ('Mechanical Keyboard','Electronics',149.99), ('Wireless Mouse','Electronics',29.99), ('Cookbook','Books',19.50)"
        );
        await c.query("grant select on products to clear");
        await c.end();
        break;
      } catch (e) {
        if (i === 19) throw e;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    await clearFlows();
  }, 30000);

  afterAll(async () => {
    await manager.disable(SERVICE).catch(() => undefined);
  });

  test("no apps.layer4: getLayer4Servers() is {}, setLayer4Server() creates it again", async () => {
    // Caddy answers GET /config/apps/layer4/servers with HTTP 400 here.
    await caddy.request("/config/apps/layer4", { method: "DELETE" });
    const raw = await fetch(`${ADMIN}/config/apps/layer4/servers`, {
      headers: { Origin: ADMIN },
    });
    expect(raw.status).toBe(400);
    expect(await caddy.getLayer4Servers()).toEqual({});

    // apps.layer4 without servers: Caddy refuses a POST below the missing key.
    await caddy.request("/config/apps/layer4", { method: "POST", body: "{}" });
    expect(await caddy.getLayer4Servers()).toEqual({});
    await caddy.setLayer4Server(SERVER, pgServer());
    expect(Object.keys(await caddy.getLayer4Servers())).toEqual([SERVER]);

    // And from no apps.layer4 at all.
    await caddy.request("/config/apps/layer4", { method: "DELETE" });
    await caddy.setLayer4Server(SERVER, pgServer());
    expect(await caddy.getLayer4Servers()).toEqual({ [SERVER]: pgServer() });
    for (let i = 0; ; i++) {
      try {
        const c = await connect();
        await c.end();
        break;
      } catch (e) {
        if (i === 19) throw e;
        await new Promise((r) => setTimeout(r, 250));
      }
    }
  });

  test("putLayer4Route on a server that does not exist is a clear error", async () => {
    await expect(
      caddy.putLayer4Route(
        "ghost",
        buildLayer4ProxyRoute({ id: "it_ghost", upstream: "postgres:5432" })
      )
    ).rejects.toThrow(/no layer4 server "ghost"/);
  });

  test("putLayer4Route on a server without a routes key creates the list", async () => {
    await caddy.request("/config/apps/layer4/servers/it_noroutes", {
      method: "POST",
      body: JSON.stringify({ listen: [":6000"] }),
    });
    const route = buildLayer4ProxyRoute({ id: "it_first", upstream: "postgres:5432" });
    expect(await caddy.putLayer4Route("it_noroutes", route)).toBe("added");
    expect((await caddy.getLayer4Servers()).it_noroutes?.routes).toEqual([route]);
    await caddy.request("/config/apps/layer4/servers/it_noroutes", { method: "DELETE" });
  });

  test("direct: Postgres answers through Caddy, mitmproxy sees nothing", async () => {
    const c = await connect();
    const { rows } = await c.query("select count(*)::int as n from products");
    await c.end();
    expect(rows[0].n).toBe(3);
    expect(await transcript()).toBe("");
  });

  test("enable(): the SQL, its parameters, the result and errors, readable in mitmproxy", async () => {
    // A connection opened before inspection is switched on.
    const before = await connect();

    await manager.enable(SERVICE);
    const route = (await caddy.getLayer4Servers())[SERVER]?.routes[0];
    expect(route).toMatchObject({
      "@id": `mitm_${SERVICE}`,
      handle: [{ handler: "proxy", upstreams: [{ dial: ["mitmproxy:5432"] }] }],
    });

    const c = await connect();
    // The query a query builder makes: the bug is the lower-case category.
    const miss = await c.query(
      "select name, price from products where category = $1 and price < $2 order by price",
      ["electronics", 200]
    );
    expect(miss.rowCount).toBe(0);
    const hit = await c.query(
      "select name, price from products where category = $1 and price < $2 order by price",
      ["Electronics", 200]
    );
    expect(hit.rowCount).toBe(2);
    await expect(c.query("select nonexistent from products")).rejects.toThrow(/nonexistent/);
    await c.end();

    // The already-open connection keeps its direct path.
    await before.query("select 'opened before inspection' as marker");
    await before.end();

    const t = await transcript();
    expect(t).toContain("CONNECT  user=demo database=shop");
    expect(t).toContain(
      "PARSE  select name, price from products where category = $1 and price < $2 order by price"
    );
    expect(t).toContain("BIND  $1='electronics', $2='200'");
    expect(t).toContain("DONE  SELECT 0");
    expect(t).toContain("BIND  $1='Electronics', $2='200'");
    expect(t).toContain("ROW  'Wireless Mouse', '29.99'");
    expect(t).toContain("ROW  'Mechanical Keyboard', '149.99'");
    expect(t).toContain("DONE  SELECT 2  (2 rows returned)");
    expect(t).toContain("LOGIN  credentials sent (not shown)");
    expect(t).not.toMatch(/password=|demo:demo/);
    expect(t).toContain('ERROR  42703 column "nonexistent" does not exist');
    expect(t).not.toContain("opened before inspection");
  });

  test("Stream Data: the Postgres content view decodes each TCP message", async () => {
    const flow = await flowWith("BIND  $1='electronics'");

    const decoded = await renderedMessages(flow.id, "Postgres");
    expect(decoded.length).toBeGreaterThan(0);
    const all = decoded.map((m) => m.text).join("\n");
    for (const m of decoded) {
      expect(m.view_name).toBe("Postgres");
      // A failing view renders "Couldn't parse as …" plus a Python traceback.
      expect(m.text).not.toMatch(/Traceback|Couldn't parse|Error:|could not decode/);
    }
    expect(all).toContain(
      "→ PARSE  select name, price from products where category = $1 and price < $2 order by price"
    );
    expect(all).toContain("→ BIND  $1='electronics', $2='200'");
    expect(all).toContain("← DONE  SELECT 0");
    expect(all).toContain("← ROW  'Wireless Mouse', '29.99'");
    // The client message that carries the bind, on its own.
    expect(
      decoded.find((m) => m.from_client && m.text.includes("BIND  $1='electronics'"))
    ).toBeDefined();

    // "auto" picks the Postgres view by itself (render_priority).
    const auto = await renderedMessages(flow.id, "auto");
    expect(auto.map((m) => m.view_name)).toEqual(decoded.map(() => "Postgres"));
  });

  test("a cleartext password is not in the stored flow (Raw view, flow dump)", async () => {
    await clearFlows();
    const c = new pg.Client({
      ...PG,
      user: "clear",
      password: CLEAR_PASSWORD,
      ssl: false,
    });
    await c.connect();
    const { rows } = await c.query("select count(*)::int as n from products");
    expect(rows[0].n).toBe(3);
    await c.end();

    const flow = await flowWith("CONNECT  user=clear");
    // The server really asked for a cleartext password, and the client sent it.
    expect(flow.comment).toContain("LOGIN  password asked (clear text)");
    expect(flow.comment).toContain("LOGIN  credentials sent (not shown)");
    expect(flow.comment).toContain("LOGIN  ok");
    expect(flow.comment).not.toContain(CLEAR_PASSWORD);

    // What mitmweb's Raw view shows of each stored message.
    const raw = await renderedMessages(flow.id, "Raw");
    const rawText = raw.map((m) => m.text).join("\n");
    expect(rawText).toContain("(pgwire: login message hidden");
    expect(rawText).not.toContain(CLEAR_PASSWORD);

    // And the stored flow itself, as mitmweb saves it (File > Save).
    const dump = await mitmweb("/flows/dump");
    expect(dump.status).toBe(200);
    const bytes = Buffer.from(await dump.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes.includes(Buffer.from("CONNECT  user=clear"))).toBe(true);
    expect(bytes.includes(Buffer.from(CLEAR_PASSWORD))).toBe(false);
  });

  test("putLayer4Route adds a route with an unknown @id, and replaces it the next time", async () => {
    const extra = buildLayer4ProxyRoute({
      id: "it_extra",
      upstream: "postgres:5432",
      match: "postgres",
    });
    expect(await caddy.putLayer4Route(SERVER, extra)).toBe("added");
    expect(await caddy.putLayer4Route(SERVER, extra)).toBe("replaced");
    const ids = (await caddy.getLayer4Servers())[SERVER]?.routes.map((r) => r["@id"]);
    expect(ids).toEqual([`mitm_${SERVICE}`, "it_extra"]);
    await caddy.request("/id/it_extra", { method: "DELETE" });
  });

  test("disable(): new connections go straight to Postgres again", async () => {
    await manager.disable(SERVICE);
    await clearFlows();
    const c = await connect();
    await c.query("select 'after disable' as marker");
    await c.end();
    expect(await transcript()).not.toContain("after disable");
    const route = (await caddy.getLayer4Servers())[SERVER]?.routes[0];
    expect(route?.handle[0]).toMatchObject({ upstreams: [{ dial: ["postgres:5432"] }] });
  });
});
