/**
 * Add `defaultSnippets` to the extension's copy of the JSON schemas
 * (schemas/, copied from ../src/generated/schemas at build time).
 *
 * VS Code's JSON language service completes property names for every file
 * matched by `contributes.jsonValidation`, precisely per handler. When a
 * property schema has exactly one defaultSnippet, it inserts that body as the
 * value -- so `upstreams` becomes `"upstreams": [{ "dial": "localhost:3000" }]`
 * with tabstops instead of a bare `[]`. This keeps a single completion list
 * (the extension used to add its own, showing every field twice) without
 * losing the useful skeletons.
 *
 * Body strings are JSON-stringified by the language service; `${n:...}`
 * placeholders survive. A string starting with `^` is inserted raw (for
 * non-string choices like `^${1|true,false|}`).
 *
 * The validators ignore `defaultSnippets`, so validation is unchanged.
 */
const fs = require("fs");
const path = require("path");

const MATCHER = {
  host: ["${1:example.com}"],
  path: ["${1:/api/*}"],
  method: ["${1|GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS|}"],
  header: { "${1:X-Header}": ["${2:value}"] },
  query: { "${1:key}": ["${2:value}"] },
  path_regexp: { pattern: "${1:^/api/v[0-9]+/}" },
  header_regexp: { "${1:Header}": { pattern: "${2:regex}" } },
  client_ip: { ranges: ["${1:10.0.0.0/8}"] },
  remote_ip: { ranges: ["${1:10.0.0.0/8}"] },
  not: [{}],
};

const ROUTE = {
  match: [{ host: ["${1:example.com}"] }],
  handle: [{ handler: "$1" }],
};

const HANDLER = {
  reverse_proxy: {
    upstreams: [{ dial: "${1:localhost:3000}" }],
    load_balancing: {
      selection_policy: { policy: "${1|round_robin,least_conn,random,first,ip_hash,uri_hash|}" },
    },
    health_checks: { active: { uri: "${1:/health}", interval: "${2:10s}" } },
    headers: { request: { set: { "${1:X-Forwarded-Host}": ["${2:{http.request.host\\}}"] } } },
    transport: { protocol: "http", tls: {} },
  },
  headers: {
    request: { set: { "${1:Header-Name}": ["${2:value}"] } },
    response: { set: { "${1:Strict-Transport-Security}": ["${2:max-age=31536000}"] } },
  },
  static_response: {
    status_code: "^${1:200}",
    body: "${1:Hello, World!}",
    headers: { "${1:Content-Type}": ["${2:text/plain}"] },
  },
  file_server: {
    root: "${1:/var/www/html}",
    index_names: ["${1:index.html}"],
    hide: ["${1:.git}"],
  },
  encode: {
    encodings: { zstd: {}, gzip: {} },
    prefer: ["zstd", "gzip"],
  },
  rewrite: {
    uri: "${1:/new/path}",
    strip_path_prefix: "${1:/api}",
  },
};

// Most-used fields first; VS Code's JSON service otherwise sorts
// alphabetically, burying `upstreams` under `circuit_breaker` & co and putting
// the rarely typed `@id` on top.
const PRIORITY = {
  reverse_proxy: ["upstreams", "load_balancing", "health_checks", "transport", "headers"],
  headers: ["response", "request"],
  static_response: ["status_code", "body", "headers"],
  file_server: ["root", "index_names", "browse"],
  encode: ["encodings", "prefer"],
  rewrite: ["strip_path_prefix", "uri"],
  matcher: ["host", "path", "method", "header", "query"],
  route: ["match", "handle", "terminal"],
};

function rank(props, order) {
  order.forEach((name, i) => {
    if (props[name] && typeof props[name] === "object" && !props[name].suggestSortText) {
      props[name].suggestSortText = `0${String(i).padStart(2, "0")}`;
    }
  });
  if (props["@id"] && typeof props["@id"] === "object") props["@id"].suggestSortText = "zz";
}

function addSnippet(propSchema, body) {
  if (!propSchema || typeof propSchema !== "object" || propSchema.defaultSnippets) return false;
  propSchema.defaultSnippets = [{ body }];
  return true;
}

function enrich(node, counts) {
  if (Array.isArray(node)) {
    node.forEach((n) => enrich(n, counts));
    return;
  }
  if (!node || typeof node !== "object") return;

  const props = node.properties;
  if (props && typeof props === "object") {
    const names = Object.keys(props);
    const handler = props.handler && props.handler.const;
    let table;
    if (typeof handler === "string" && HANDLER[handler]) {
      table = HANDLER[handler];
      if (PRIORITY[handler]) rank(props, PRIORITY[handler]);
    } else if (names.includes("host") && names.includes("path") && names.includes("method")) {
      table = MATCHER;
      rank(props, PRIORITY.matcher);
    } else if (names.includes("match") && names.includes("handle")) {
      table = ROUTE;
      rank(props, PRIORITY.route);
    }
    if (table) {
      for (const [name, body] of Object.entries(table)) {
        if (props[name] && addSnippet(props[name], body)) counts.n++;
      }
    }
  }
  for (const value of Object.values(node)) enrich(value, counts);
}

const dir = path.join(__dirname, "../schemas");
let total = 0;
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  const p = path.join(dir, file);
  const schema = JSON.parse(fs.readFileSync(p, "utf-8"));
  const counts = { n: 0 };
  enrich(schema, counts);
  if (counts.n > 0) {
    fs.writeFileSync(p, JSON.stringify(schema, null, 2) + "\n");
    total += counts.n;
  }
}
console.log(`✓ Added ${total} defaultSnippets to schemas/`);
