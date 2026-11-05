# Changelog

All notable changes to the Caddy Configuration Tools extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.1] - 2026-11-04

### Changed

- README: links to the two other films of the toolkit (mitmproxy, and SQL on the wire), below
  the extension's own demo.

## [0.5.0] - 2026-11-04

### Added

- Layer 4 (caddy-l4): validation, completions and hover docs for `apps.layer4` (TCP/UDP routing:
  Postgres, TLS by SNI, SSH, RDP, proxy with load balancing and health checks, subroutes, …).
  Files named `layer4.json`, `caddy-layer4.json`, `layer4-app.json` or `*.layer4.json` are
  validated against the layer4 app schema; a full Caddy config (`caddy-server.json`, …) accepts
  `apps.layer4` instead of flagging it.
- Snippets and completions for the new layer4 builders of `@viaalink/caddy-api-client` 0.11
  (`buildLayer4Server`, `buildLayer4SniRoute`, `buildLayer4ProxyHandler`, …).

### Fixed

- Builder snippets whose first parameter is a value (a string, a list) listed a string's methods
  (`toString`, `charAt`, …) as parameters; they now list the builder's real parameters.

## [0.4.0] - 2026-11-04

### Added

- The extension finds the Caddys running on your machine: `caddy run` / `caddy start` processes
  (their config names the admin address, including the Caddys the Viaalink CLI starts per project),
  Docker containers publishing port 2019, `CADDY_ADMIN` and `localhost:2019`. Each is asked whether
  it answers; one is used straight away, with several you pick one and the workspace remembers it.
- **Caddy: Choose Running Caddy**, and a status bar item showing which Caddy Apply and Show Running
  Config use; click it to switch.
- Settings: `caddy.targets` (your own list, e.g. dev and staging), `caddy.autoDetect` and
  `caddy.allowRemoteAdmin`.

### Changed

- `caddy.adminUrl` is now the override: empty by default (find Caddy), and when set it is always
  used, without looking anything up.
- An admin URL that is not on this machine is refused unless `caddy.allowRemoteAdmin` is on: the
  admin API has no login. The message explains the safe way (an SSH tunnel to localhost).
- The README says what the extension covers next to a Caddyfile extension, and that admin API
  changes are not written back to a config file.

## [0.3.1] - 2026-11-03

### Changed

- The README links the demo film (https://youtu.be/IIfOw6wbDMQ), and the retired shields.io
  Marketplace badges are replaced by vsmarketplacebadges.dev.

### Fixed

- The `dial` check accepts every unix socket network: `unix+h2c//run/app.sock` no longer gets a false
  "has no port" error, whose "Add port" quick fix would have broken the address. A unix dial without
  a socket path (`"unix/"`) is now reported as `dial-unix-path`. The networks match the library's
  `DialAddressSchema`.

## [0.3.0] - 2026-11-02

### Added

- **Caddy-specific checks with quick fixes.** Things a JSON schema can't see, which Caddy only rejects when it loads the config: `dial` written as a URL or without a port, `host` matchers with a scheme, port or path, duplicate `@id`s, a 3xx `static_response` without `Location`, the LDAP `{username}` placeholder that the JSON admin API never replaces (`%s`), and `gatekeeper_name` / `portal_name` / identity-store names that the config doesn't define.
- **"Did you mean …?" quick fix** for unknown properties (`upstream` → `upstreams`), also on VS Code's own _Property … is not allowed_ errors.
- **Apply File to Running Caddy**: a full `caddy-server.json` goes through `POST /load`; routes are added to a chosen server, or replaced in place by `@id`. Every write asks for confirmation. **Show Running Config** opens the live config read-only. Both use the `caddy.adminUrl` setting and send the `Origin` header that Caddy 2.11+ requires.
- **Status bar item** that shows which kind of Caddy config the open file is validated as, plus its finding count. Click it for every Caddy command.
- **Caddy: New Config File…** creates a correctly named file with a starter config.
- **Get Started walkthrough** with six steps.
- **10 new JSON snippets**: `caddy-route-files`, `caddy-route-redirect`, `caddy-route-path`, `caddy-route-lb`, `caddy-sec-route-protected`, `caddy-sec-route-portal`, `caddy-handler-encode`, `caddy-handler-rewrite`, `caddy-sec-config` and `caddy-server`.
- TypeScript builder completions add the `import { … } from "@viaalink/caddy-api-client"`.

### Fixed

- **caddy-security snippets, Insert Security Configuration and the Security Wizard produced invalid config.** They emitted `driver` / `search_filter` / `cookie` / `access_lists`, which neither caddy-security nor this extension's own schema accepts. They now produce `kind`/`params` stores, `cookie_config`, `access_list_rules` and the `%s` LDAP filter. The wizard builds its output with the library's builders. Cancelling a wizard step no longer inserts a half-built config, and OIDC asks for the issuer URL.
- **TypeScript builder snippets weren't valid TypeScript.** They had unquoted strings, `servers: ""` for an array, and empty `({})` for builders with required options or positional arguments. Every builder and template snippet is now type-checked against the library in CI.
- **The extension's own schema validator checked nothing.** It didn't follow `$ref`, and every generated schema is rooted in one. It now does, and also supports `allOf`, `additionalProperties` schemas, exclusive bounds and integers.
- Protected routes (`authentication` + caddy-security `authorizer`) no longer show schema errors in `*.caddy.json` / `caddy-server.json`.
- `caddy-server.json` / `caddy-full.json` are recognised everywhere, not only by VS Code's schema contribution. Hover and CodeLens no longer trigger on any file whose name merely contains "security".
- The `caddy-route` snippet no longer offers a handler choice that left `upstreams` on a `file_server`.
- **Property names are no longer offered twice in schema-backed files.** VS Code's schema-driven list (precise per handler) is now the only one there. The bundled schemas give its items the same useful skeletons as before (`"upstreams": [{ "dial": "localhost:3000" }]`, `"host": ["example.com"]`, …) and list the most-used fields first, so `upstreams` no longer sits below `circuit_breaker`. The extension still supplies handler names (with docs), methods and enum values.

### Changed

- Activation is lighter: live-apply and the security wizard are loaded on first use, so `extension.js` is about 170 KB instead of 437 KB (most of it is builder documentation for hovers and completions).
- Logging goes to a _Caddy Tools_ log channel at debug level, instead of a "Caddy Tools Debug" channel that logged every keystroke.
- Commands are grouped under the **Caddy** category.

## [0.2.0] - 2026-08-11

### Added

- **First published release** — this and all prior versions (`0.1.0`–`0.1.5`) were built and packaged locally only (`.vsix` files checked into this directory) and never actually published to the Visual Studio Marketplace or Open VSX. This release adds the publish pipeline (`.github/workflows/release-vscode.yml`) and is the first version publicly installable from either registry.
- Autocomplete for `path_regexp`, `header_regexp`, `client_ip`, `remote_ip`, `tls`, `not`, and `expression` matcher fields, and for the `CONNECT`/`TRACE` HTTP methods — previously offered no completions at all.

### Fixed

- **Completion provider rewritten** to use `jsonc-parser` (the same library VS Code's own JSON language service uses) for exact JSON-path tracking, replacing whole-document bracket/brace counting. That counting approach stayed "inside match"/"inside handler" for the rest of the document once any array anywhere was still open — nearly always true past the first few lines — so it regularly offered wrong-context suggestions (e.g. matcher fields inside an unrelated handler's nested object) and produced malformed double-quoted inserts.
- `caddy-server.json` no longer rejects `@id` — it's a Caddy-wide admin-API addressing convention stripped before Go struct decoding, so it never appeared in any generated schema; now declared explicitly at every level (root, `apps.http`, each server, nested routes).
- Typo'd handler fields (e.g. `upstream` instead of `upstreams`) are now flagged instead of silently accepted, since `handle` items validate against the strict per-handler schema rather than a permissive passthrough one.
- The `method` matcher no longer rejects non-standard HTTP methods (e.g. `CONNECT`, `TRACE`, or a custom verb) — real Caddy accepts any string there.

## [0.1.5] - 2025-01-21

### Added

- **Context-aware IntelliSense** - Completions now understand where you are in your configuration:
  - Route properties (`@id`, `match`, `handle`, `terminal`, `priority`) inside route objects
  - Match fields (`host`, `path`, `method`, `header`, `query`, `protocol`) inside match arrays
  - HTTP methods (`GET`, `POST`, `PUT`, etc.) inside method arrays
  - Handler-specific fields based on the current handler type (e.g., `upstreams` for `reverse_proxy`)
  - Enum values for `selection_policy`, `encodings`, and `protocol` fields

- **17 caddy-security templates** backed by validated tests:
  - Identity stores: Local, LDAP
  - Identity providers: GitHub, Google, Keycloak, Okta, Auth0
  - Portals: Basic, with cookie config, with SSO
  - Policies: Basic, admin-only, with bypass paths
  - Routes: Auth portal, protected routes
  - Full setups: Complete local auth, complete OIDC auth

- **58 TypeScript/JavaScript snippets** (41 builder functions + 17 templates)

- **Professional documentation** with feature tables, snippets reference, and examples

### Changed

- Snippet generation now uses templates as single source of truth
- All security snippets are validated by tests before shipping

## [0.1.0] - 2025-01-15

### Added

- Initial release
- JSON Schema validation for Caddy configuration files:
  - `*.caddy.json` - Route configurations
  - `*.caddy-server.json` - Full server configurations
  - `*.caddy-security.json` - Security plugin configurations
  - `*.caddy-security-portal.json` - Authentication portals
  - `*.caddy-security-policy.json` - Authorization policies
- Handler type completions (`reverse_proxy`, `file_server`, `static_response`, etc.)
- Hover documentation with links to official Caddy docs
- CodeLens for quick documentation access
- 11 JSON snippets for common configurations
- 41 TypeScript/JavaScript builder snippets
- Configuration wizards:
  - Route Configuration Wizard
  - Security Configuration Wizard
- Diagnostics for real-time validation errors

[0.1.5]: https://github.com/asd-engineering/asd-caddy-api-client/compare/v0.1.0...v0.1.5
[0.1.0]: https://github.com/asd-engineering/asd-caddy-api-client/releases/tag/v0.1.0
