# Apply to a running Caddy

**Caddy: Apply File to Running Caddy** sends the open file to Caddy's admin API:

- `caddy-server.json`: `POST /load` swaps the whole config atomically. If Caddy rejects it, the old config stays.
- `*.caddy.json`: adds the route(s) to an HTTP server you pick, or replaces a route in place when its `@id` already exists.

**Caddy: Show Running Config** opens the live config read-only, with the same hover and CodeLens.

The admin URL defaults to `http://localhost:2019` (setting `caddy.adminUrl`). Caddy 2.11+ checks the request `Origin`; the extension sends one that matches the admin URL. If you map the admin port in Docker (e.g. `2020:2019`), list both ports under `admin.origins`.

Every write asks you to confirm first.
