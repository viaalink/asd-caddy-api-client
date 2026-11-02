# Caddy Configuration Tools

[![Marketplace](https://img.shields.io/visual-studio-marketplace/v/viaalink.vscode-caddy-tools?label=Marketplace)](https://marketplace.visualstudio.com/items?itemName=Viaalink.vscode-caddy-tools)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/viaalink.vscode-caddy-tools)](https://marketplace.visualstudio.com/items?itemName=Viaalink.vscode-caddy-tools)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Write [Caddy](https://caddyserver.com/) JSON configs with IntelliSense that knows Caddy. The extension catches the mistakes Caddy would only reject at load time, and applies the result to a running server, all without leaving the editor. It includes first-class support for the [caddy-security](https://github.com/greenpau/caddy-security) (AuthCrunch) plugin.

[![Watch the 1:43 demo on YouTube](https://img.youtube.com/vi/YPGhe91KaD4/maxresdefault.jpg)](https://youtu.be/YPGhe91KaD4)

▶ **[Watch the demo on YouTube](https://youtu.be/YPGhe91KaD4)** (1:43): every feature in it is the real extension against a real Caddy.

```
ext install Viaalink.vscode-caddy-tools
```

## What it does

|                  |                                                                                                                                                                                                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IntelliSense** | All 21 handlers inside `"handler": "…"`, the right fields for _that_ handler, matchers inside `"match"`, and enum values (`selection_policy`, `encodings`, …).                                                                                                                                                      |
| **Validation**   | Your file is checked against JSON Schemas generated from the [`@viaalink/caddy-api-client`](https://www.npmjs.com/package/@viaalink/caddy-api-client) Zod schemas. Typos get a _Did you mean …?_ quick fix.                                                                                                         |
| **Caddy checks** | Catches the problems a schema can't: a `dial` written as a URL or without a port, `host` matchers with a scheme or port, duplicate `@id`s, redirects with no `Location`, the LDAP `{username}` placeholder that the JSON API never replaces, and policies, portals or stores that are referenced but never defined. |
| **Quick fixes**  | `Ctrl+.` on a squiggle.                                                                                                                                                                                                                                                                                             |
| **Snippets**     | 21 JSON snippets (`caddy-…`) and 59 TypeScript snippets (42 builders + 17 caddy-security templates). Each one is validated against the schema or type-checked against the library before it ships.                                                                                                                  |
| **Wizards**      | A route wizard, and a caddy-security wizard for local/LDAP/OAuth2/OIDC logins, portals and policies.                                                                                                                                                                                                                |
| **Live Caddy**   | _Apply File to Running Caddy_ (`POST /load`, or add or replace routes by `@id`) and a read-only _Show Running Config_.                                                                                                                                                                                              |
| **Docs at hand** | Hover any handler for its documentation and an example; a CodeLens above each handler links to caddyserver.com and authcrunch.com.                                                                                                                                                                                  |

## Getting started

1. Run **Caddy: New Config File…** (or open **Caddy: Get Started**).
2. Pick a full config, a route, or a caddy-security config. The file name is what turns validation on:

   | File name                                                              | Validated as                          |
   | ---------------------------------------------------------------------- | ------------------------------------- |
   | `caddy-server.json`, `caddy-full.json`, `*.caddy-server.json`          | Complete Caddy config                 |
   | `caddy.json`, `caddy-config.json`, `*.caddy.json`                      | Route (or array of routes)            |
   | `caddy-security.json`, `security-config.json`, `*.caddy-security.json` | caddy-security `apps.security.config` |
   | `*.caddy-security-portal.json`                                         | Authentication portal                 |
   | `*.caddy-security-policy.json`                                         | Authorization policy                  |

   The status bar shows what the open file is validated as. Click it for every Caddy command.

3. Type, or type `caddy-` for snippets.

## Catching what Caddy would reject

```jsonc
{
  "@id": "app",
  "match": [{ "host": ["https://app.example.com"] }], // ✗ host matchers take bare hostnames
  "handle": [
    {
      "handler": "reverse_proxy",
      "upstream": [{ "dial": "http://localhost:3000" }], // ✗ Did you mean "upstreams"?
    },
  ], // ✗ dial takes host:port, not a URL
}
```

Every one of these has a one-keystroke fix. In a full config, a `gatekeeper_name` that doesn't match any `authorization_policies[].name` is flagged too, with the closest defined name offered as the fix.

## Snippets

### JSON (`.json` files)

| Prefix                                                                             | Inserts                                                             |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `caddy-server`                                                                     | Complete config: admin endpoint plus an HTTPS server with one route |
| `caddy-route`                                                                      | Route: host → reverse proxy                                         |
| `caddy-route-files`                                                                | Route: static files with zstd/gzip                                  |
| `caddy-route-redirect`                                                             | Route: 301/302/307/308 redirect that keeps the path                 |
| `caddy-route-path`                                                                 | Route: `/api/*` → backend, prefix stripped                          |
| `caddy-route-lb`                                                                   | Route: load-balanced upstreams with active health checks            |
| `caddy-handler-proxy` / `-files` / `-headers` / `-static` / `-encode` / `-rewrite` | Single handlers                                                     |
| `caddy-sec-config`                                                                 | caddy-security: local users, a portal and a policy                  |
| `caddy-sec-local-store` / `caddy-sec-ldap-store`                                   | Identity stores (LDAP uses the `%s` filter placeholder)             |
| `caddy-sec-portal` / `caddy-sec-policy`                                            | Portal with session cookie / policy with `access_list_rules`        |
| `caddy-sec-route-protected` / `caddy-sec-route-portal`                             | Protected app route / login portal route                            |
| `caddy-sec-authorizer` / `caddy-sec-authenticator`                                 | caddy-security handlers                                             |

### TypeScript and JavaScript

Type `build` for every builder in [`@viaalink/caddy-api-client`](https://www.npmjs.com/package/@viaalink/caddy-api-client). Accepting one fills in the required options and adds the import. You can also use the `caddy-…` prefixes directly. The 17 `caddy-sec-…` templates (GitHub/Google OAuth2, Keycloak/Okta/Auth0 OIDC, portals, policies, complete local or OIDC setups) are each built and validated in the library's test suite.

```ts
import { buildProtectedRoute } from "@viaalink/caddy-api-client";

const route = buildProtectedRoute({
  hosts: ["app.example.com"],
  gatekeeperName: "mypolicy",
  dial: "localhost:3000",
});
```

## Commands

All commands are under **Caddy:** in the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`), or one click away in the status bar.

| Command                                                    |                                                                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| New Config File…                                           | Create a correctly named file with a starter config                                                    |
| Route Configuration Wizard                                 | Matching, handler, security headers, compression: step by step                                         |
| Security Configuration Wizard                              | Local / LDAP / OAuth2 / OIDC, portal, policies                                                         |
| Insert Route Configuration / Insert Security Configuration | Pick from the validated snippets                                                                       |
| Apply File to Running Caddy                                | `caddy-server.json` → `POST /load`; `*.caddy.json` → add the route(s) to a server, or replace by `@id` |
| Show Running Config                                        | The live config, read-only, with hover and CodeLens                                                    |
| Show Handler Documentation                                 | Every handler, linked to caddyserver.com                                                               |
| Get Started                                                | The walkthrough                                                                                        |

### Apply to a running Caddy

The admin URL defaults to `http://localhost:2019`; change it with `caddy.adminUrl`. Every write asks for confirmation first. A full config is loaded atomically, so if Caddy rejects it, the previous config stays active.

Caddy 2.11+ checks the `Origin` header on admin requests. The extension sends the origin of `caddy.adminUrl`. If you map the admin port in Docker (for example `2020:2019`), list both ports in the Caddyfile `admin { origins … }` block.

## Settings

| Setting                    | Default                 |                                                                         |
| -------------------------- | ----------------------- | ----------------------------------------------------------------------- |
| `caddy.adminUrl`           | `http://localhost:2019` | Admin API used by Apply / Show Running Config                           |
| `caddy.enableDiagnostics`  | `true`                  | Caddy-specific checks (schema validation is VS Code's own and stays on) |
| `caddy.enableHoverDocs`    | `true`                  | Handler documentation on hover                                          |
| `caddy.showCaddyDocsLinks` | `true`                  | Links to caddyserver.com in hovers                                      |
| `caddy.showCodeLens`       | `true`                  | Documentation CodeLens above handlers                                   |

## Works in

VS Code 1.85+, [code-server](https://github.com/coder/code-server), VSCodium and other Open VSX editors. Every release is tested in desktop VS Code (API-level) and in code-server (UI-level, with Playwright).

## Development

```bash
just install && just build      # library (the extension bundles it)
just vscode-build               # build + package the .vsix
just vscode-test                # Playwright UI tests in code-server
just test                       # unit tests, including snippet validation and type-checks
```

Snippets live in [`src/snippets/json-snippets.json`](src/snippets/json-snippets.json) (JSON) and are generated from the library's builder JSDoc (TypeScript). Don't edit `snippets/*.json` directly.

## Related

- [Caddy JSON config reference](https://caddyserver.com/docs/json/)
- [caddy-security / AuthCrunch docs](https://docs.authcrunch.com/)
- [`@viaalink/caddy-api-client`](https://github.com/viaalink/asd-caddy-api-client): the TypeScript library this extension is built on

## License

MIT © [Viaalink](https://viaalink.com)
