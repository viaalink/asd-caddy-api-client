/**
 * Layer 4 (TCP/UDP) routing with the caddy-l4 plugin (github.com/mholt/caddy-l4).
 *
 * Stock Caddy only proxies HTTP. With caddy-l4 built in (`xcaddy build --with
 * github.com/mholt/caddy-l4`), Caddy can sit in front of anything that speaks
 * TCP or UDP: Postgres, SSH, RDP, OpenVPN, DNS, SOCKS, TLS by server name. Its
 * config lives under `apps.layer4.servers.<name>`, each with `listen`
 * addresses and `routes`; a route matches a connection (by protocol and its
 * options: `postgres`, `tls` with `sni`/`alpn`, `http`, `ssh`, `remote_ip`, …)
 * and hands it to handlers (`proxy`, `tls`, `subroute`, `throttle`, …).
 *
 * The schemas (`layer4-schemas.ts`) are composed from types generated from the
 * caddy-l4 Go source and cover every matcher and handler module of the pinned
 * caddy-l4 commit (see DEPENDENCIES.md); `layer4-builders.ts` has builders for
 * the common cases.
 *
 * @example
 * ```typescript
 * const server = buildLayer4Server({
 *   listen: [":5432"],
 *   routes: [buildLayer4ProxyRoute({ id: "postgres", upstream: "postgres:5432", match: "postgres" })],
 * });
 * await caddy.setLayer4Server("db", server);
 * ```
 */

export * from "./layer4-schemas.js";
export * from "./layer4-builders.js";
