# Caddy Configuration Tools

[![Marketplace](https://vsmarketplacebadges.dev/version-short/Viaalink.vscode-caddy-tools.svg)](https://marketplace.visualstudio.com/items?itemName=Viaalink.vscode-caddy-tools)
[![Installs](https://vsmarketplacebadges.dev/installs-short/Viaalink.vscode-caddy-tools.svg)](https://marketplace.visualstudio.com/items?itemName=Viaalink.vscode-caddy-tools)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Write [Caddy](https://caddyserver.com/) JSON configs with IntelliSense that knows Caddy. The extension catches the mistakes Caddy would only reject at load time, and applies the result to a running server, all without leaving the editor. It includes first-class support for the [caddy-security](https://github.com/greenpau/caddy-security) (AuthCrunch) plugin.

[![Watch the 2:16 demo on YouTube](https://img.youtube.com/vi/IIfOw6wbDMQ/maxresdefault.jpg)](https://youtu.be/IIfOw6wbDMQ)

▶ **[Watch the demo on YouTube](https://youtu.be/IIfOw6wbDMQ)** (2:16): every feature in it is the real extension against a real Caddy.

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
| **Live Caddy**   | Finds the Caddys running on your machine (processes, Docker, Viaalink CLI projects) and lets you pick one. _Apply File to Running Caddy_ (`POST /load`, or add or replace routes by `@id`) and a read-only _Show Running Config_.                                                                                   |
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
| Choose Running Caddy                                       | Pick which running Caddy Apply and Show Running Config use (also: click it in the status bar)          |
| Apply File to Running Caddy                                | `caddy-server.json` → `POST /load`; `*.caddy.json` → add the route(s) to a server, or replace by `@id` |
| Show Running Config                                        | The live config, read-only, with hover and CodeLens                                                    |
| Show Handler Documentation                                 | Every handler, linked to caddyserver.com                                                               |
| Get Started                                                | The walkthrough                                                                                        |

### Which Caddy?

You don't have to tell the extension where Caddy runs. The first time you apply or show the running config, it looks on your machine:

- `caddy run` / `caddy start` processes: their config file names the admin address (`admin.listen` in JSON, the `admin` global option in a Caddyfile); without one, Caddy listens on `localhost:2019`. This also finds the Caddys the [Viaalink CLI](https://viaalink.com) starts per project.
- Docker containers that publish Caddy's admin port 2019.
- `CADDY_ADMIN` and `localhost:2019`.

Each one is asked whether it answers. One running Caddy is used straight away; with several you pick one, and the workspace remembers it. The status bar shows which Caddy you're on (_Caddy: name_); click it to switch.

**Override it** with `caddy.adminUrl`: when set, that Caddy is always used and nothing is looked up. Keep your own list (for example a dev and a staging Caddy) in `caddy.targets`; turn the lookup off with `caddy.autoDetect`.

**Only local Caddys, by default.** Caddy's admin API has no login: anyone who can reach it can replace your server's config. An address that isn't on this machine is refused unless you turn on `caddy.allowRemoteAdmin`. The safe way to a remote Caddy is an SSH tunnel: `ssh -L 2019:localhost:2019 your-server`, then use `http://localhost:2019`.

Every write asks for confirmation first. A full config is loaded atomically, so if Caddy rejects it, the previous config stays active. Changes made through the admin API are not written back to your config file: if Caddy is started from a file, a restart loads that file again.

Caddy 2.11+ checks the `Origin` header on admin requests; the extension sends the admin URL's own origin. If you map the admin port in Docker (for example `2020:2019`), list both ports in the Caddyfile `admin { origins … }` block.

### Caddyfile or JSON?

This extension works with Caddy's JSON config: the format Caddy itself runs, and the one its admin API takes. A Caddyfile is turned into exactly that JSON; _Show Running Config_ shows it. For writing Caddyfiles, use a Caddyfile extension such as [Caddyfile Support](https://marketplace.visualstudio.com/items?itemName=matthewpi.caddyfile-support) next to this one: it covers Caddyfile highlighting and formatting, this one covers JSON, the caddy-security plugin and the running server.

## Settings

| Setting                    | Default            |                                                                                      |
| -------------------------- | ------------------ | ------------------------------------------------------------------------------------ |
| `caddy.adminUrl`           | _(empty: find it)_ | Always use this admin API; overrides finding and choosing                            |
| `caddy.targets`            | `[]`               | Your own Caddys, e.g. `[{ "name": "staging", "adminUrl": "http://localhost:2020" }]` |
| `caddy.autoDetect`         | `true`             | Find the Caddys running on this machine                                              |
| `caddy.allowRemoteAdmin`   | `false`            | Allow an admin URL that isn't on this machine (see above)                            |
| `caddy.enableDiagnostics`  | `true`             | Caddy-specific checks (schema validation is VS Code's own and stays on)              |
| `caddy.enableHoverDocs`    | `true`             | Handler documentation on hover                                                       |
| `caddy.showCaddyDocsLinks` | `true`             | Links to caddyserver.com in hovers                                                   |
| `caddy.showCodeLens`       | `true`             | Documentation CodeLens above handlers                                                |

## Supported Caddy versions

The schemas, completions and checks come from [@viaalink/caddy-api-client](https://www.npmjs.com/package/@viaalink/caddy-api-client), which is generated from Caddy's own source. Each new Caddy release is regenerated and the extension's tests are run against it before it is listed here.

<!-- upstreams:supported-caddy:start -->

| Caddy   | Library        | VS Code extension | How it is validated                                                                                                                                                                    |
| ------- | -------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v2.11.4 | 0.9.0 – 0.10.x | 0.2.0 – 0.4.x     | Types generated from this source. CI's unit and differential fuzz tests run `caddy validate`/`caddy adapt` on this binary; the extension's tests run on the schemas generated from it. |
| v2.11.2 | 0.6.0 – 0.10.x | 0.2.0 – 0.4.x     | Known-good baseline: the maintainers' day-to-day Caddy, used against the library and the extension.                                                                                    |

<!-- upstreams:supported-caddy:end -->

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
