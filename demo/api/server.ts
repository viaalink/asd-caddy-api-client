/**
 * Demo API Server
 *
 * Showcases @viaalink/caddy-api-client library for:
 * - Dynamic route management via Caddy Admin API
 * - Hot-swappable MITMproxy traffic interception using MitmproxyManager
 * - Multiple services with independent monitoring control
 * - Databases over TCP: Postgres, MySQL, MariaDB and Redis behind caddy-l4
 *   routes, each swapped through a mitmproxy that decodes its protocol
 *   (the package's pgwire, mysqlwire and rediswire addons)
 */

import {
  CaddyClient,
  MitmproxyManager,
  buildReverseProxyHandler,
  buildRewriteHandler,
  buildIframeProxyRoute,
  buildWebSocketProxyRoute,
  buildLayer4ProxyRoute,
  buildLayer4Server,
} from "../dist/index.js";
import pg from "pg";
import { createConnection as createMysqlConnection } from "mysql2/promise";
import { Redis } from "ioredis";
import type { CaddyRoute } from "../dist/index.js";

const CADDY_ADMIN_URL = process.env.CADDY_ADMIN_URL || "http://localhost:2019";
const SERVER_NAME = "srv0";

// mitmweb 11.1+ will not serve its UI or API without a password. The three
// mitmwebs run with this one (docker-compose.yml, DEMO_MITMWEB_PASSWORD), and
// Caddy hands it to them on every proxied request: the dashboard frames them
// all from one origin, where their auth cookies (same name, different
// secrets) would knock each other out.
const MITMWEB_PASSWORD = process.env.MITMWEB_PASSWORD ?? "demo";

/** Add `Authorization: Bearer <password>` to a route's reverse_proxy handlers that dial a mitmweb UI. */
function withMitmwebAuth(route: CaddyRoute): CaddyRoute {
  const handle = (route.handle ?? []).map((h) => {
    const handler = h as Record<string, unknown>;
    const upstreams = (handler.upstreams ?? []) as { dial?: string }[];
    if (handler.handler !== "reverse_proxy" || !upstreams.some((u) => u.dial?.endsWith(":8081"))) {
      return h;
    }
    const headers = (handler.headers ?? {}) as { request?: { set?: Record<string, string[]> } };
    return {
      ...handler,
      headers: {
        ...headers,
        request: {
          ...headers.request,
          set: { ...headers.request?.set, Authorization: [`Bearer ${MITMWEB_PASSWORD}`] },
        },
      },
    } as typeof h;
  });
  return { ...route, handle };
}

// Initialize Caddy client from the library
const caddy = new CaddyClient({ adminUrl: CADDY_ADMIN_URL });

// Initialize MitmproxyManager with two proxy instances
const mitmManager = new MitmproxyManager(caddy, {
  default: { host: "mitmproxy", port: 8080, webPort: 8081 }, // For Elasticsearch
  nodeproxy: { host: "mitmproxy-node", port: 8080, webPort: 8081 }, // For Node API
  postgres: { host: "mitmproxy-pg", port: 5432, webPort: 8081 }, // reverse:tcp → postgres:5432
  mysql: { host: "mitmproxy-mysql", port: 3306, webPort: 8081 }, // reverse:tcp → mysql:3306
  mariadb: { host: "mitmproxy-mariadb", port: 3306, webPort: 8081 }, // reverse:tcp → mariadb:3306
  redis: { host: "mitmproxy-redis", port: 6379, webPort: 8081 }, // reverse:tcp → redis:6379
});

// Register Elasticsearch service (uses default proxy)
mitmManager.register({
  id: "elasticsearch",
  serverId: SERVER_NAME,
  pathPrefix: "/es",
  backend: { host: "elasticsearch", port: 9200 },
});

// Register Node API service (uses nodeproxy)
mitmManager.register({
  id: "nodeapi",
  serverId: SERVER_NAME,
  pathPrefix: "/node",
  backend: { host: "demo-api", port: 3000 },
});

// Register Postgres: a TCP service behind Caddy's layer4 server "pg" (caddy-l4)
const PG_SERVER = "pg";
mitmManager.register({
  protocol: "tcp",
  id: "postgres",
  serverId: PG_SERVER,
  backend: { host: "postgres", port: 5432 },
  match: "postgres",
  proxy: "postgres",
});

// MySQL, MariaDB and Redis: TCP services too, each on a layer4 listener of its
// own. caddy-l4 has no matcher for them (and a MySQL server speaks first, so
// there is nothing to match before it does): a route without a matcher.
const TCP_DATABASES = [
  { id: "mysql", listen: ":3306", backend: { host: "mysql", port: 3306 } },
  { id: "mariadb", listen: ":3307", backend: { host: "mariadb", port: 3306 } },
  { id: "redis", listen: ":6379", backend: { host: "redis", port: 6379 } },
] as const;
for (const d of TCP_DATABASES) {
  mitmManager.register({
    protocol: "tcp",
    id: d.id,
    serverId: d.id,
    backend: d.backend,
    proxy: d.id,
  });
}

// The demo's own database access goes through Caddy (caddy:5432), so the route
// can be swapped. A TCP connection is routed when it opens, so the pool closes
// idle connections quickly: right after inspection is switched on, the next
// search opens a new connection, and that one goes through mitmproxy.
const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://demo:demo@caddy:5432/shop",
  max: 4,
  idleTimeoutMillis: 250,
});

/**
 * Product search on Postgres. The SQL is put together from whatever the user
 * picked, the way a query builder or ORM does it: the code holds the pieces,
 * the wire shows the query.
 */
async function searchProductsSql(params: URLSearchParams) {
  const where: string[] = [];
  const values: unknown[] = [];
  const add = (clause: (n: string) => string, value: unknown) => {
    values.push(value);
    where.push(clause(`$${values.length}`));
  };
  const q = params.get("q")?.trim();
  if (q) add((n) => `(name ilike ${n} or description ilike ${n})`, `%${q}%`);
  const category = params.get("category");
  if (category) add((n) => `category = ${n}`, category);
  const maxPrice = Number(params.get("maxPrice"));
  if (maxPrice > 0) add((n) => `price <= ${n}`, maxPrice);
  // Sort options map to columns; never put user input into the SQL itself.
  // "rating" is the demo's second bug: the option shipped, the column never did.
  const SORTS: Record<string, string> = { price: "price", name: "name", rating: "rating desc" };
  const sort = SORTS[params.get("sort") ?? "price"] ?? "price";
  const sql =
    `select name, category, description, price from products` +
    (where.length ? ` where ${where.join(" and ")}` : "") +
    ` order by ${sort} limit 20`;
  const started = performance.now();
  const result = await db.query(sql, values);
  return {
    rows: result.rows,
    count: result.rowCount ?? 0,
    ms: Math.round(performance.now() - started),
  };
}

// MySQL and MariaDB through Caddy (caddy:3306, caddy:3307). One connection per
// search: a TCP connection is routed when it opens, so the next search after
// inspection is switched on goes through mitmproxy, and each flow in mitmweb
// reads from the server's greeting (MySQL or MariaDB) to the last row.
const SQL_PASSWORD = process.env.DEMO_DB_PASSWORD ?? "demo";
const SQL_DATABASES: Record<string, { port: number }> = {
  mysql: { port: 3306 },
  mariadb: { port: 3307 },
};

async function searchProductsMysql(dbId: string, params: URLSearchParams) {
  const where: string[] = [];
  const values: (string | number)[] = [];
  const q = params.get("q")?.trim();
  if (q) {
    where.push("(name like ? or description like ?)");
    values.push(`%${q}%`, `%${q}%`);
  }
  const category = params.get("category");
  if (category) {
    where.push("category = ?");
    values.push(category);
  }
  const maxPrice = Number(params.get("maxPrice"));
  if (maxPrice > 0) {
    where.push("price <= ?");
    values.push(maxPrice);
  }
  const SORTS: Record<string, string> = { price: "price", name: "name", rating: "rating desc" };
  const sort = SORTS[params.get("sort") ?? "price"] ?? "price";
  const sql =
    `select name, category, description, price from products` +
    (where.length ? ` where ${where.join(" and ")}` : "") +
    ` order by ${sort} limit 20`;
  const started = performance.now();
  const conn = await createMysqlConnection({
    host: process.env.SQL_HOST ?? "caddy",
    port: SQL_DATABASES[dbId]!.port,
    user: "shop",
    password: SQL_PASSWORD,
    database: "shop",
  });
  try {
    // execute(): a prepared statement, so the wire shows the SQL and its parameters apart
    const [rows] = await conn.execute(sql, values);
    const list = rows as Record<string, unknown>[];
    return { rows: list, count: list.length, ms: Math.round(performance.now() - started) };
  } finally {
    await conn.end();
  }
}

// Redis through Caddy (caddy:6379). The products as hashes (product:<id>), one
// set per category (category:<Category>) and a sorted set by price.
const REDIS_PASSWORD = process.env.DEMO_REDIS_PASSWORD ?? "demo";

function redisClient() {
  return new Redis({
    host: process.env.REDIS_HOST ?? "caddy",
    port: 6379,
    password: REDIS_PASSWORD,
    lazyConnect: true,
    enableReadyCheck: false,
    maxRetriesPerRequest: 1,
  });
}

/** Load demo/data/products.json into Redis (the SQL databases seed themselves). */
async function seedRedis() {
  const products = (await Bun.file("../data/products.json").json()) as {
    name: string;
    category: string;
    description: string;
    price: number;
  }[];
  const r = redisClient();
  await r.connect();
  try {
    const old = await r.keys("product:*");
    const cats = await r.keys("category:*");
    if (old.length + cats.length) await r.del(...old, ...cats);
    await r.del("products:by_price");
    const tx = r.multi();
    products.forEach((p, i) => {
      const id = String(i + 1);
      tx.hset(`product:${id}`, {
        name: p.name,
        category: p.category,
        description: p.description,
        price: String(p.price),
      });
      tx.sadd(`category:${p.category}`, id);
      tx.zadd("products:by_price", p.price, id);
    });
    await tx.exec();
  } finally {
    await r.quit();
  }
}

/**
 * Product search on Redis. The same filters, as Redis commands: the category
 * set, the price index, then one HGETALL per product. The two bugs show up
 * here too: the lower-case slug reads category:electronics (empty), and
 * "rating" reads an index that was never built (products:by_rating, empty).
 */
async function searchProductsRedis(params: URLSearchParams) {
  const started = performance.now();
  const r = redisClient();
  await r.connect();
  try {
    const maxPrice = Number(params.get("maxPrice"));
    const index = params.get("sort") === "rating" ? "products:by_rating" : "products:by_price";
    let ids = await r.zrangebyscore(index, "-inf", maxPrice > 0 ? maxPrice : "+inf");
    const category = params.get("category");
    if (category) {
      const members = new Set(await r.smembers(`category:${category}`));
      ids = ids.filter((id) => members.has(id));
    }
    const pipeline = r.pipeline();
    for (const id of ids) pipeline.hgetall(`product:${id}`);
    const results = ((await pipeline.exec()) ?? []).map(([, v]) => v as Record<string, string>);
    const q = params.get("q")?.trim().toLowerCase();
    let rows = results.filter(
      (p) => !q || p.name?.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q)
    );
    if (params.get("sort") === "name") rows = rows.sort((a, b) => a.name!.localeCompare(b.name!));
    rows = rows.slice(0, 20);
    return { rows, count: rows.length, ms: Math.round(performance.now() - started) };
  } finally {
    await r.quit();
  }
}

/**
 * Setup initial routes using the library
 * This configures Caddy with proper routes for the demo
 */
async function setupRoutes() {
  console.log("Setting up Caddy routes using caddy-api-client library...");

  // Get current config
  const config = await caddy.getConfig();
  const httpApp = (config.apps as Record<string, unknown>)?.http as Record<string, unknown>;
  const servers = httpApp?.servers as Record<string, unknown>;
  const server = servers?.[SERVER_NAME] as Record<string, unknown>;

  // Ensure routes array exists
  if (!server?.routes) {
    console.log("  → Creating routes array...");
    await caddy.request(`/config/apps/http/servers/${SERVER_NAME}/routes`, {
      method: "PUT",
      body: JSON.stringify([]),
    });
  }

  // Define all route IDs for cleanup
  const routeIds = [
    "mitmproxy_ws_route",
    "mitmproxy_node_ws_route",
    "api_route",
    "app_route",
    "mitmproxy_ui_route",
    "mitmproxy_node_ui_route",
    "mitmproxy_pg_ui_route",
    "mitmproxy_mysql_ui_route",
    "mitmproxy_mariadb_ui_route",
    "mitmproxy_redis_ui_route",
    "mitm_elasticsearch",
    "mitm_nodeapi",
    "dashboard_route",
    "root_redirect",
  ];

  // Remove existing routes first (idempotent setup)
  console.log("  → Cleaning up existing routes...");
  for (const id of routeIds) {
    await caddy.removeRouteById(SERVER_NAME, id);
  }

  // Build routes array
  const routes: CaddyRoute[] = [];

  // 0. MITMproxy WebSocket routes for both proxies
  routes.push(
    buildWebSocketProxyRoute({
      path: "/updates",
      upstreamHost: "mitmproxy",
      upstreamPort: 8081,
      routeId: "mitmproxy_ws_route",
      overrideHost: "127.0.0.1:8081",
    })
  );
  routes.push(
    buildWebSocketProxyRoute({
      path: "/updates-node",
      upstreamHost: "mitmproxy-node",
      upstreamPort: 8081,
      routeId: "mitmproxy_node_ws_route",
      overrideHost: "127.0.0.1:8081",
    })
  );

  // 1. API route - proxies to demo-api (internal, not intercepted)
  routes.push({
    "@id": "api_route",
    match: [{ path: ["/api/*"] }],
    handle: [buildReverseProxyHandler("demo-api:3000")],
    terminal: true,
  });

  // 2. App route - static files from demo-api
  routes.push({
    "@id": "app_route",
    match: [{ path: ["/app/*"] }],
    handle: [buildRewriteHandler("/app"), buildReverseProxyHandler("demo-api:3000")],
    terminal: true,
  });

  // 3. MITMproxy Web UI routes for both proxies
  routes.push(
    buildIframeProxyRoute({
      pathPrefix: "/mitmproxy",
      upstreamHost: "mitmproxy",
      upstreamPort: 8081,
      routeId: "mitmproxy_ui_route",
      iframeEmbed: true,
      overrideHost: "127.0.0.1:8081",
    })
  );
  routes.push(
    buildIframeProxyRoute({
      pathPrefix: "/mitmproxy-pg",
      upstreamHost: "mitmproxy-pg",
      upstreamPort: 8081,
      routeId: "mitmproxy_pg_ui_route",
      iframeEmbed: true,
      overrideHost: "127.0.0.1:8081",
    })
  );
  for (const d of TCP_DATABASES) {
    routes.push(
      buildIframeProxyRoute({
        pathPrefix: `/mitmproxy-${d.id}`,
        upstreamHost: `mitmproxy-${d.id}`,
        upstreamPort: 8081,
        routeId: `mitmproxy_${d.id}_ui_route`,
        iframeEmbed: true,
        overrideHost: "127.0.0.1:8081",
      })
    );
  }
  routes.push(
    buildIframeProxyRoute({
      pathPrefix: "/mitmproxy-node",
      upstreamHost: "mitmproxy-node",
      upstreamPort: 8081,
      routeId: "mitmproxy_node_ui_route",
      iframeEmbed: true,
      overrideHost: "127.0.0.1:8081",
    })
  );

  // 4. Dashboard route
  routes.push({
    "@id": "dashboard_route",
    match: [{ path: ["/dashboard"] }],
    handle: [buildReverseProxyHandler("demo-api:3000")],
    terminal: true,
  });

  // 5. Root redirect to dashboard
  routes.push({
    "@id": "root_redirect",
    match: [{ path: ["/"] }],
    handle: [
      {
        handler: "static_response",
        status_code: 302,
        headers: { Location: ["/dashboard"] },
      },
    ],
    terminal: true,
  });

  // Apply routes using the library's addRoute method
  for (const route of routes) {
    const routeId = route["@id"] as string;
    const added = await caddy.addRoute(SERVER_NAME, withMitmwebAuth(route));
    if (added) {
      console.log(`  ✓ Added route: ${routeId}`);
    } else {
      console.log(`  ⚠ Route already exists: ${routeId}`);
    }
  }

  // Initialize service routes via MitmproxyManager (start disabled/direct)
  await mitmManager.disable("elasticsearch");
  console.log("  ✓ Added route: mitm_elasticsearch (direct)");

  await mitmManager.disable("nodeapi");
  console.log("  ✓ Added route: mitm_nodeapi (direct)");

  // Postgres behind Caddy: a layer4 server on :5432, built with the library.
  // Its one route starts direct; MitmproxyManager swaps it in place.
  await caddy.setLayer4Server(
    PG_SERVER,
    buildLayer4Server({
      listen: ":5432",
      routes: [
        buildLayer4ProxyRoute({
          id: "mitm_postgres",
          upstream: "postgres:5432",
          match: "postgres",
        }),
      ],
    })
  );
  await mitmManager.disable("postgres");
  console.log("  ✓ Added layer4 server: pg → postgres:5432 (direct)");

  for (const d of TCP_DATABASES) {
    await caddy.setLayer4Server(
      d.id,
      buildLayer4Server({
        listen: d.listen,
        routes: [
          buildLayer4ProxyRoute({
            id: `mitm_${d.id}`,
            upstream: `${d.backend.host}:${d.backend.port}`,
          }),
        ],
      })
    );
    await mitmManager.disable(d.id);
    console.log(`  ✓ Added layer4 server: ${d.id} → ${d.backend.host}:${d.backend.port} (direct)`);
  }

  // Redis has no init scripts: load the products now, through Caddy (direct).
  for (let i = 0; ; i++) {
    try {
      await seedRedis();
      console.log("  ✓ Seeded Redis with the products");
      break;
    } catch (e) {
      if (i === 20) throw e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  console.log("Routes configured!");
}

// Setup routes on server start
setupRoutes().catch(console.error);

/**
 * Handle HTTP requests
 */
const server = Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // CORS headers for all responses
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Handle preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      // === Node API endpoints (interceptable via /node/*) ===
      if (path === "/node/echo" || path === "/echo") {
        const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
        return Response.json(
          {
            service: "node-api",
            timestamp: new Date().toISOString(),
            method: req.method,
            echo: body,
            headers: Object.fromEntries(req.headers.entries()),
          },
          { headers: corsHeaders }
        );
      }

      if (path === "/node/random" || path === "/random") {
        return Response.json(
          {
            service: "node-api",
            timestamp: new Date().toISOString(),
            random: Math.random(),
            uuid: crypto.randomUUID(),
          },
          { headers: corsHeaders }
        );
      }

      // ============================================
      // CHALLENGE ENDPOINTS - Real ES Debugging Scenarios
      // ============================================

      // Challenge 1: Bulk Indexing with broken NDJSON
      // Real symptom: _bulk returns 400 or partial failures
      if (path === "/api/challenge/bulk-broken" && req.method === "POST") {
        // Simulate sending broken NDJSON to Elasticsearch
        // Problem: Pretty-printed JSON instead of NDJSON, missing newlines
        const brokenBulkPayload = `{"index":{"_index":"products"}}
{
  "name": "Broken Product",
  "price": 99.99,
  "category": "Electronics"
}
{"index":{"_index":"products"}}{"name":"Missing Newline","price":49.99}{"index":{"_index":"products"}}
{"name": "Also Broken", "price": 29.99}`;

        // Send to ES via the /es route (which may go through MITM)
        try {
          const esResponse = await fetch(`http://caddy:80/es/_bulk`, {
            method: "POST",
            headers: { "Content-Type": "application/x-ndjson" },
            body: brokenBulkPayload,
          });
          const result = await esResponse.json();
          return Response.json(
            {
              challenge: "bulk-indexing",
              description: "Bulk request sent with formatting issues",
              hint: "In MITMproxy: Check the request body - see the pretty-printed JSON and missing newlines?",
              mitmAction:
                "Edit the request body to fix NDJSON format: each line must be compact JSON",
              esResponse: result,
            },
            { headers: corsHeaders }
          );
        } catch (e) {
          return Response.json(
            { error: "Failed to send bulk request", details: String(e) },
            { status: 500, headers: corsHeaders }
          );
        }
      }

      // Challenge 2: Search returns 0 hits - Query DSL mismatch
      // Real symptom: _search returns empty hits when you expect results
      if (path === "/api/challenge/search-zero-hits" && req.method === "POST") {
        // Send a query with common mistakes:
        // - Using 'match' on a 'keyword' field (should use 'term')
        // - Wrong field name
        const brokenQuery = {
          query: {
            bool: {
              must: [
                { match: { category: "electronics" } }, // Problem: category is keyword, needs exact match "Electronics"
                { match: { product_name: "keyboard" } }, // Problem: field is "name", not "product_name"
              ],
            },
          },
        };

        try {
          const esResponse = await fetch(`http://caddy:80/es/products/_search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(brokenQuery),
          });
          const result = await esResponse.json();
          return Response.json(
            {
              challenge: "query-dsl-mismatch",
              description: "Search returned 0 hits - but we know keyboards exist!",
              sentQuery: brokenQuery,
              hint: "In MITMproxy: Inspect the request body - the Query DSL has issues",
              problems: [
                "1. 'category' is a keyword field - needs exact case: 'Electronics' not 'electronics'",
                "2. Field name is 'name', not 'product_name'",
              ],
              mitmAction:
                "Edit request: change 'product_name' to 'name', change 'electronics' to 'Electronics'",
              esResponse: result,
            },
            { headers: corsHeaders }
          );
        } catch (e) {
          return Response.json(
            { error: "Failed to send search", details: String(e) },
            { status: 500, headers: corsHeaders }
          );
        }
      }

      // Challenge 3: 429 Rate Limiting / Rejection Storm
      // Real symptom: Under load, ES returns 429s and retries make it worse
      if (path === "/api/challenge/rate-limit-storm" && req.method === "POST") {
        const results: Array<{ request: number; status: number; time: number }> = [];
        const startTime = Date.now();

        // Fire 10 rapid requests to simulate burst traffic
        const promises = Array.from({ length: 10 }, async (_, i) => {
          const reqStart = Date.now() - startTime;
          try {
            const response = await fetch(`http://caddy:80/es/products/_search`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                query: { match_all: {} },
                size: 100,
                _source: true,
              }),
            });
            results.push({ request: i + 1, status: response.status, time: reqStart });
          } catch {
            results.push({ request: i + 1, status: 0, time: reqStart });
          }
        });

        await Promise.all(promises);

        return Response.json(
          {
            challenge: "rate-limit-burst",
            description: "Fired 10 rapid requests - watch for patterns in MITMproxy",
            hint: "In MITMproxy: Sort by timing, look for status codes and request patterns",
            mitmInsights: [
              "• See burst timing - all requests within milliseconds",
              "• In production, 429s would appear here during overload",
              "• Retries would show as duplicate requests",
              "• This is how you diagnose 'retry storm' problems",
            ],
            results: results.sort((a, b) => a.time - b.time),
            totalTime: Date.now() - startTime,
          },
          { headers: corsHeaders }
        );
      }

      // Challenge 4: Mapping Type Mismatch - mapper_parsing_exception
      // Real symptom: Document indexing fails with type errors
      if (path === "/api/challenge/type-mismatch" && req.method === "POST") {
        // Send document with wrong field types
        const brokenDoc = {
          name: "Test Product",
          price: "not-a-number", // Problem: price should be a float
          category: 12345, // Problem: category should be a string
        };

        try {
          const esResponse = await fetch(`http://caddy:80/es/products/_doc`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(brokenDoc),
          });
          const result = await esResponse.json();
          return Response.json(
            {
              challenge: "type-mismatch",
              description: "Document indexing failed due to type mismatch",
              sentDocument: brokenDoc,
              hint: "In MITMproxy: Check response for 'mapper_parsing_exception'",
              problems: [
                "1. 'price' field expects float, got string 'not-a-number'",
                "2. 'category' field expects keyword string, got number 12345",
              ],
              mitmAction: "Edit request: change price to 99.99, category to 'Electronics'",
              esResponse: result,
            },
            { headers: corsHeaders }
          );
        } catch (e) {
          return Response.json(
            { error: "Failed to index document", details: String(e) },
            { status: 500, headers: corsHeaders }
          );
        }
      }

      // Challenge 5: Aggregation on Text Field - fielddata disabled error
      // Real symptom: "Fielddata is disabled on text fields by default"
      if (path === "/api/challenge/agg-text-field" && req.method === "POST") {
        // Try to aggregate on 'name' which is a text field
        const brokenAgg = {
          size: 0,
          aggs: {
            top_names: {
              terms: {
                field: "name", // Problem: 'name' is text, need 'name.keyword'
                size: 10,
              },
            },
          },
        };

        try {
          const esResponse = await fetch(`http://caddy:80/es/products/_search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(brokenAgg),
          });
          const result = await esResponse.json();
          return Response.json(
            {
              challenge: "aggregation-text-field",
              description: "Aggregation failed - cannot aggregate on text field",
              sentQuery: brokenAgg,
              hint: "In MITMproxy: Look for 'illegal_argument_exception' about fielddata",
              problems: [
                "Text fields have fielddata disabled by default",
                "Use 'name.keyword' for aggregations, not 'name'",
              ],
              mitmAction: "Edit request: change 'name' to 'name.keyword' in the aggregation",
              esResponse: result,
            },
            { headers: corsHeaders }
          );
        } catch (e) {
          return Response.json(
            { error: "Failed to run aggregation", details: String(e) },
            { status: 500, headers: corsHeaders }
          );
        }
      }

      // Challenge 6: Slow Query / Large Result Set
      // Real symptom: Very slow or timeout responses
      if (path === "/api/challenge/slow-query" && req.method === "POST") {
        // Request a huge result set - common performance mistake
        const slowQuery = {
          query: { match_all: {} },
          size: 10000, // Problem: requesting way too many results
          track_total_hits: true,
        };

        const startTime = Date.now();
        try {
          const esResponse = await fetch(`http://caddy:80/es/products/_search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(slowQuery),
          });
          const result = await esResponse.json();
          const duration = Date.now() - startTime;

          return Response.json(
            {
              challenge: "slow-query",
              description: `Query took ${duration}ms - size=10000 is problematic`,
              sentQuery: slowQuery,
              hint: "In MITMproxy: Check request body 'size' parameter",
              problems: [
                "Requesting 10000 results at once is slow and memory-intensive",
                "Default max_result_window is 10000 - larger values fail",
                "Use pagination with search_after or scroll for large datasets",
              ],
              mitmAction: "Edit request: change 'size' to 10 or 20 for faster response",
              duration: `${duration}ms`,
              esResponse: result,
            },
            { headers: corsHeaders }
          );
        } catch (e) {
          return Response.json(
            { error: "Query failed or timed out", details: String(e) },
            { status: 500, headers: corsHeaders }
          );
        }
      }

      // Challenge 7: Index Not Found (404)
      // Real symptom: index_not_found_exception
      if (path === "/api/challenge/index-not-found" && req.method === "POST") {
        // Query a non-existent index - common typo scenario
        try {
          const esResponse = await fetch(`http://caddy:80/es/products_v2/_search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: { match_all: {} } }),
          });
          const result = await esResponse.json();
          return Response.json(
            {
              challenge: "index-not-found",
              description: "Search failed - index does not exist",
              attemptedIndex: "products_v2",
              correctIndex: "products",
              hint: "In MITMproxy: Look for 404 status and 'index_not_found_exception'",
              problems: [
                "Index 'products_v2' doesn't exist - typo in index name",
                "Correct index name is 'products'",
              ],
              mitmAction: "Edit request URL: change '/products_v2/' to '/products/'",
              esResponse: result,
            },
            { headers: corsHeaders }
          );
        } catch (e) {
          return Response.json(
            { error: "Request failed", details: String(e) },
            { status: 500, headers: corsHeaders }
          );
        }
      }

      // Challenge 8 (Node): Fix broken JSON response (original, enhanced)
      if (path === "/node/broken" || path === "/broken") {
        // Returns intentionally broken JSON - fix it in MITMproxy!
        const brokenJson = `{
  "status": "broken",
  "message": "Fix me in MITMproxy!"
  "missing_comma": true,
  "hint": "Add a comma after the message field"
  "timestamp": "${new Date().toISOString()}"
}`;
        return new Response(brokenJson, {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Challenge 5: 500 Error (original, enhanced)
      if (path === "/node/error500" || path === "/error500") {
        // Returns 500 error - change to 200 in MITMproxy!
        return Response.json(
          {
            error: "Internal Server Error",
            message: "Change my status to 200 in MITMproxy!",
            hint: "Edit the response status code",
            timestamp: new Date().toISOString(),
          },
          { status: 500, headers: corsHeaders }
        );
      }

      // Theme config - intercept and change to see visual effects!
      // This endpoint is perfect for MITMproxy manipulation challenges
      if (path === "/node/config" || path === "/config") {
        return Response.json(
          {
            // === Theme Settings (modify these to change app appearance) ===
            theme: "dark",
            primaryColor: "#3b82f6",
            accentColor: "#f59e0b",
            backgroundColor: "#0f172a",
            cardColor: "#1e293b",
            textColor: "#e2e8f0",
            borderRadius: "0.5rem",
            appName: "Product Search",

            // === Feature Flags (hidden features - activate by changing values!) ===
            showPrices: true, // Set to false to hide all prices
            showDescriptions: false, // Set to true to show product descriptions
            discountPercent: 0, // Set 1-99 to show discounted prices (e.g., 50 = 50% off)
            secretMessage: null, // Set to any string to show a secret banner!
            adminMode: false, // Set to true to show debug info panel

            // === Display Settings ===
            currency: "USD",
            currencySymbol: "$",
            maxResults: 20,

            // === Hints for MITMproxy users ===
            _manipulation_hints: {
              theme: "Try: 'light', 'dark', 'neon', or 'hacker'",
              backgroundColor: "Try: '#ff0000' (red), '#00ff00' (green)",
              secretMessage: "Try: 'You found the secret!'",
              discountPercent: "Try: 50 (shows 50% off all prices)",
              adminMode: "Try: true (shows debug panel)",
            },
          },
          { headers: corsHeaders }
        );
      }

      // === Monitoring API endpoints ===

      // Get status for all services
      if (path === "/api/monitoring/status") {
        const status = mitmManager.getStatus();
        return Response.json(
          {
            services: Object.fromEntries(
              Object.entries(status).map(([id, s]) => [
                id,
                {
                  enabled: s.enabled,
                  proxy: s.proxy,
                  backend: `${s.service.backend.host}:${s.service.backend.port}`,
                  pathPrefix: s.service.pathPrefix,
                },
              ])
            ),
          },
          { headers: corsHeaders }
        );
      }

      // Enable monitoring for a specific service
      if (path.startsWith("/api/monitoring/enable/") && req.method === "POST") {
        const serviceId = path.split("/").pop();
        if (!serviceId || !mitmManager.getServiceStatus(serviceId)) {
          return Response.json(
            { error: `Unknown service: ${serviceId}` },
            { status: 404, headers: corsHeaders }
          );
        }
        // Use correct proxy for each service
        // Node API has its own HTTP proxy; Postgres names its own (reverse TCP)
        // proxy in its registration; everything else uses the default one.
        const OWN_PROXY: Record<string, string> = {
          nodeapi: "nodeproxy",
          postgres: "postgres",
          mysql: "mysql",
          mariadb: "mariadb",
          redis: "redis",
        };
        const proxyName = OWN_PROXY[serviceId] ?? "default";
        await mitmManager.enable(serviceId, { proxy: proxyName });
        return Response.json(
          {
            success: true,
            service: serviceId,
            enabled: true,
            proxy: proxyName,
            message: `Traffic monitoring enabled for ${serviceId}`,
          },
          { headers: corsHeaders }
        );
      }

      // Disable monitoring for a specific service
      if (path.startsWith("/api/monitoring/disable/") && req.method === "POST") {
        const serviceId = path.split("/").pop();
        if (!serviceId || !mitmManager.getServiceStatus(serviceId)) {
          return Response.json(
            { error: `Unknown service: ${serviceId}` },
            { status: 404, headers: corsHeaders }
          );
        }
        await mitmManager.disable(serviceId);
        return Response.json(
          {
            success: true,
            service: serviceId,
            enabled: false,
            message: `Traffic monitoring disabled for ${serviceId}`,
          },
          { headers: corsHeaders }
        );
      }

      // Legacy endpoints for backwards compatibility
      if (path === "/api/monitoring/enable" && req.method === "POST") {
        await mitmManager.enable("elasticsearch");
        return Response.json(
          { success: true, enabled: true, message: "Traffic monitoring enabled for elasticsearch" },
          { headers: corsHeaders }
        );
      }

      if (path === "/api/monitoring/disable" && req.method === "POST") {
        await mitmManager.disable("elasticsearch");
        return Response.json(
          {
            success: true,
            enabled: false,
            message: "Traffic monitoring disabled for elasticsearch",
          },
          { headers: corsHeaders }
        );
      }

      // Product search on a database (?db=postgres|mysql|mariadb|redis), built from the filters
      if (path === "/api/db/search") {
        try {
          const dbId = url.searchParams.get("db") ?? "postgres";
          const result =
            dbId === "redis"
              ? await searchProductsRedis(url.searchParams)
              : dbId in SQL_DATABASES
                ? await searchProductsMysql(dbId, url.searchParams)
                : await searchProductsSql(url.searchParams);
          return Response.json(result, { headers: corsHeaders });
        } catch (error) {
          // What a real app tends to tell its users: not much.
          console.error("db search failed:", (error as Error).message);
          return Response.json(
            { error: "Something went wrong while searching." },
            { status: 500, headers: corsHeaders }
          );
        }
      }

      // Clear MITMproxy flows
      if (path === "/api/monitoring/clear" && req.method === "POST") {
        // mitmweb clears with POST /clear, with the password. Like every write it wants a matching
        // XSRF cookie and header (any value works, they only have to agree), and
        // its DNS-rebinding guard only accepts a localhost/IP Host header.
        const clear = async (host: string): Promise<boolean> => {
          const res = await fetch(`http://${host}:8081/clear`, {
            method: "POST",
            headers: {
              Host: "127.0.0.1:8081",
              Authorization: `Bearer ${MITMWEB_PASSWORD}`,
              Cookie: "_xsrf=demo",
              "X-XSRFToken": "demo",
            },
          }).catch(() => null);
          return res?.ok === true;
        };
        const results: Record<string, boolean> = {
          elasticsearch: await clear("mitmproxy"),
          nodeapi: await clear("mitmproxy-node"),
          postgres: await clear("mitmproxy-pg"),
          mysql: await clear("mitmproxy-mysql"),
          mariadb: await clear("mitmproxy-mariadb"),
          redis: await clear("mitmproxy-redis"),
        };

        return Response.json(
          {
            success: Object.values(results).every(Boolean),
            cleared: results,
            message: "MITMproxy flows cleared",
          },
          { headers: corsHeaders }
        );
      }

      // Health check
      if (path === "/api/health") {
        return Response.json(
          {
            status: "ok",
            library: "@viaalink/caddy-api-client",
            services: mitmManager.getRegisteredServices(),
            proxies: mitmManager.getAvailableProxies(),
          },
          { headers: corsHeaders }
        );
      }

      // Serve static files from public directory (mapped from demo/app/ in Dockerfile)
      if (path === "/" || path === "/index.html") {
        const file = Bun.file("../public/index.html");
        return new Response(file, {
          headers: { "Content-Type": "text/html", ...corsHeaders },
        });
      }

      if (path === "/dashboard" || path === "/dashboard.html") {
        const file = Bun.file("../public/dashboard.html");
        return new Response(file, {
          headers: { "Content-Type": "text/html", ...corsHeaders },
        });
      }

      if (path === "/style.css") {
        const file = Bun.file("../public/style.css");
        return new Response(file, {
          headers: { "Content-Type": "text/css", ...corsHeaders },
        });
      }

      if (path === "/db.html") {
        return new Response(Bun.file("../public/db.html"), {
          headers: { "Content-Type": "text/html", ...corsHeaders },
        });
      }

      if (path === "/db.js") {
        return new Response(Bun.file("../public/db.js"), {
          headers: { "Content-Type": "application/javascript", ...corsHeaders },
        });
      }

      if (path === "/main.js") {
        const file = Bun.file("../public/main.js");
        return new Response(file, {
          headers: { "Content-Type": "application/javascript", ...corsHeaders },
        });
      }

      // 404 for everything else
      return new Response("Not Found", { status: 404, headers: corsHeaders });
    } catch (error) {
      console.error("Request error:", error);
      return Response.json(
        { error: (error as Error).message },
        { status: 500, headers: corsHeaders }
      );
    }
  },
});

console.log(`Demo API server running on http://localhost:${server.port}`);
console.log("Using @viaalink/caddy-api-client library");
console.log("MitmproxyManager configured with services:", mitmManager.getRegisteredServices());
