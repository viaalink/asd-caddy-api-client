# IntelliSense that knows Caddy

- Inside `"handler": "…"` you get all 21 handlers, with docs.
- Inside a handler you get _that handler's_ fields: `upstreams` for `reverse_proxy`, `root` for `file_server`.
- Inside `"match": [{ … }]` you get matchers: `host`, `path`, `method`, `header`, `query`, `not`, `expression`, ...
- Type `caddy-` for snippets: `caddy-route`, `caddy-route-files`, `caddy-route-redirect`, `caddy-route-lb`, `caddy-sec-config`, `caddy-server`, ...

Every snippet is validated against the same schema the editor uses, so inserting one never leaves a red squiggle.

Hover a handler name for its documentation; the CodeLens above it links to caddyserver.com.
