# MITMproxy Traffic Inspection Demo

This demo showcases the `@viaalink/caddy-api-client` library's ability to dynamically insert MITMproxy between services **without restarts**.

## What This Demo Shows

1. **Direct routing**: `Client → Caddy → Elasticsearch`
2. **Click "Enable Monitoring"**: Library calls Caddy Admin API
3. **Proxied routing**: `Client → Caddy → MITMproxy → Elasticsearch`
4. **Watch traffic**: See requests appear in MITMproxy web UI
5. **Click "Disable Monitoring"**: Instant switch back to direct

**Zero downtime. No service restarts. Just API calls.**

## Quick Start

Needs the Viaalink CLI 3.2.6 or later (`via update`); a fresh clone starts without any setup step.

```bash
just demo start   # via run up: own ports for this checkout, routed in Caddy
just demo url     # https://caddy-mitm-<id>.localhost/dashboard
just demo share   # via run share: same, plus a public URL on your relay
just demo stop
```

Every checkout gets its own ports and container names from `tpl.env`
(`getRandomPort`, `getRandomString`), resolved once into `.env` by `via env init`.
Several clones or worktrees run the demo side by side without clashing.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  caddy-mitm-<id>.localhost/dashboard                      │
│  ┌─────────────────────────┐  ┌───────────────────────────┐ │
│  │   Demo Search App       │  │  MITMproxy Web UI         │
│  │   /app/                 │  │  /mitmproxy/              │
│  │                         │  │                           │
│  │   [Enable Monitoring]   │  │  Shows captured traffic   │
│  └─────────────────────────┘  └───────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────────────────────────┐
│  demo Caddy (DEMO_HTTP_PORT, admin on DEMO_ADMIN_PORT)    │
│                                                           │
│  /es/* route dynamically switches between:                │
│  - Direct:   elasticsearch:9200                           │
│  - Proxied:  mitmproxy:8080 → elasticsearch:9200          │
└───────────────────────────────────────────────────────────┘
```

## Library Usage

The demo uses the library to configure Caddy routes programmatically:

```typescript
import {
  CaddyClient,
  buildReverseProxyHandler,
  buildRewriteHandler,
} from "@viaalink/caddy-api-client";

const caddy = new CaddyClient({ adminUrl: "http://caddy:2019" });

// Add route with iframe-permissive headers for MITMproxy Web UI
const route = {
  "@id": "mitmproxy_ui_route",
  match: [{ path: ["/mitmproxy/*"] }],
  handle: [
    buildRewriteHandler("/mitmproxy"),
    {
      handler: "headers",
      response: {
        deferred: true,
        delete: ["X-Frame-Options", "Content-Security-Policy"],
        set: { "Access-Control-Allow-Origin": ["*"] },
      },
    },
    buildReverseProxyHandler("mitmproxy:8081"),
  ],
  terminal: true,
};

await caddy.request("/config/apps/http/servers/srv0/routes", {
  method: "POST",
  body: JSON.stringify(route),
});

// Hot-swap ES route upstream (direct ↔ proxied)
await caddy.request(`/config/apps/http/servers/srv0/routes/${index}`, {
  method: "PATCH",
  body: JSON.stringify(newRoute),
});
```

## Services

| Service       | Port (.env)          | Description                          |
| ------------- | -------------------- | ------------------------------------ |
| Caddy         | DEMO_HTTP_PORT       | Reverse proxy (HTTP)                 |
| Caddy Admin   | DEMO_ADMIN_PORT      | Admin API for dynamic config         |
| Elasticsearch | DEMO_ES_PORT         | Backend data store                   |
| MITMproxy     | DEMO_MITM_PROXY_PORT | Proxy port (reverse mode)            |
| MITMproxy UI  | DEMO_MITM_WEB_PORT   | Web interface for traffic inspection |
| Demo API      | DEMO_API_PORT        | Search app + monitoring toggle       |

## Manual Testing

```bash
source <(grep ^DEMO_ .env)   # this checkout's ports

# Check service health
curl http://localhost:$DEMO_HTTP_PORT/api/health

# Check monitoring status
curl http://localhost:$DEMO_HTTP_PORT/api/monitoring/status

# Enable monitoring
curl -X POST http://localhost:$DEMO_HTTP_PORT/api/monitoring/enable

# Disable monitoring
curl -X POST http://localhost:$DEMO_HTTP_PORT/api/monitoring/disable

# Search products (goes through Caddy /es/ route)
curl -X POST http://localhost:$DEMO_HTTP_PORT/es/products/_search \
  -H "Content-Type: application/json" \
  -d '{"query":{"match":{"name":"keyboard"}}}'
```

## Cleanup

```bash
just demo stop
```
