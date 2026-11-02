# The file name turns everything on

Caddy Tools recognises a file by its name. Pick the one that matches what goes inside:

| File name                                       | Holds                                 | Applied with                    |
| ----------------------------------------------- | ------------------------------------- | ------------------------------- |
| `caddy-server.json`, `*.caddy-server.json`      | A complete Caddy config               | `POST /load`                    |
| `*.caddy.json`, `caddy.json`                    | One route (or an array of routes)     | appended to a server's `routes` |
| `caddy-security.json`, `*.caddy-security.json`  | caddy-security `apps.security.config` | part of the full config         |
| `*.caddy-security-portal.json` / `-policy.json` | One portal / one policy               | part of the security config     |

The status bar shows which kind the open file is validated as. Click it for every Caddy command.
