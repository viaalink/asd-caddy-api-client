# Catch what Caddy would reject on load

Schema validation catches typos (`upstream` → _Did you mean "upstreams"?_). On top of that, Caddy Tools checks what a schema can't:

- `"dial": "http://localhost:3000"`: a URL where Caddy wants `host:port`.
- `"dial": "backend"`: no port; Caddy fails with _missing port in address_.
- `"host": ["https://app.example.com"]`: never matches; host matchers take bare hostnames.
- Duplicate `@id`s, which the admin API refuses.
- `"search_user_filter": "(uid={username})"`: Caddyfile syntax that the JSON API never replaces (use `%s`).
- A `gatekeeper_name`, `portal_name` or identity store that the config doesn't define.

Press `Ctrl+.` (`Cmd+.`) on a squiggle for the quick fix.
