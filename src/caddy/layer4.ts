/**
 * Layer 4 (TCP/UDP) routing with the caddy-l4 plugin (github.com/mholt/caddy-l4).
 *
 * Stock Caddy only proxies HTTP. With caddy-l4 built in (`xcaddy build --with
 * github.com/mholt/caddy-l4`), Caddy can sit in front of anything that speaks
 * TCP: a Postgres or MySQL database, Redis, MQTT, SSH. Its config lives under
 * `apps.layer4.servers.<name>`, each with `listen` addresses and `routes`; a
 * route matches a connection (optionally by protocol: `postgres`, `tls`, `ssh`,
 * …) and hands it to handlers such as `proxy`.
 *
 * Only what this library builds and checks is modelled: servers, routes and the
 * `proxy` handler. Matchers and other handlers pass through as plain objects.
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

import { z } from "zod";

/** One upstream: a list of dial addresses (`host:port`), as caddy-l4 takes them. */
export const Layer4UpstreamSchema = z
  .object({
    dial: z.array(z.string().min(1)).min(1),
  })
  .passthrough();

/** The `proxy` handler: forwards the connection to one of its upstreams. */
export const Layer4ProxyHandlerSchema = z
  .object({
    handler: z.literal("proxy"),
    upstreams: z.array(Layer4UpstreamSchema).min(1),
    /** "PROXY protocol" header to send upstream: "v1" or "v2". */
    proxy_protocol: z.enum(["v1", "v2"]).optional(),
  })
  .passthrough();

/** Any other layer4 handler (`tls`, `subroute`, `echo`, …): checked for its name only. */
export const Layer4HandlerSchema = z.union([
  Layer4ProxyHandlerSchema,
  z.object({ handler: z.string().min(1) }).passthrough(),
]);

/** A matcher set, e.g. `{ "postgres": {} }` or `{ "tls": { "sni": ["db.example.com"] } }`. */
export const Layer4MatcherSetSchema = z.record(z.unknown());

export const Layer4RouteSchema = z
  .object({
    "@id": z.string().min(1).optional(),
    match: z.array(Layer4MatcherSetSchema).optional(),
    handle: z.array(Layer4HandlerSchema).min(1),
  })
  .passthrough();

export const Layer4ServerSchema = z
  .object({
    listen: z.array(z.string().min(1)).min(1),
    routes: z.array(Layer4RouteSchema),
  })
  .passthrough();

export type Layer4Upstream = z.infer<typeof Layer4UpstreamSchema>;
export type Layer4ProxyHandler = z.infer<typeof Layer4ProxyHandlerSchema>;
export type Layer4Handler = z.infer<typeof Layer4HandlerSchema>;
export type Layer4MatcherSet = z.infer<typeof Layer4MatcherSetSchema>;
export type Layer4Route = z.infer<typeof Layer4RouteSchema>;
export type Layer4Server = z.infer<typeof Layer4ServerSchema>;

/** Protocols caddy-l4 can recognise from a connection's first bytes, with no options needed. */
export type Layer4Protocol =
  | "postgres"
  | "mysql"
  | "redis"
  | "ssh"
  | "tls"
  | "http"
  | "rdp"
  | "socks5"
  | "openvpn"
  | "xmpp";

/**
 * A `proxy` handler for one or more upstreams.
 *
 * @description Forward the TCP connection to one of the given `host:port` addresses
 * @param upstreams - `host:port`, or a list of them (one upstream each)
 * @example buildLayer4ProxyHandler("postgres:5432")
 */
export function buildLayer4ProxyHandler(
  upstreams: string | string[],
  options: { proxyProtocol?: "v1" | "v2" } = {}
): Layer4ProxyHandler {
  const list = Array.isArray(upstreams) ? upstreams : [upstreams];
  return Layer4ProxyHandlerSchema.parse({
    handler: "proxy",
    upstreams: list.map((dial) => ({ dial: [dial] })),
    ...(options.proxyProtocol ? { proxy_protocol: options.proxyProtocol } : {}),
  });
}

/**
 * A route that proxies matching connections to an upstream.
 *
 * @description Layer 4 route: optionally match a protocol, then proxy the connection
 * @param options.id - `@id`, so the route can be found and replaced later
 * @param options.upstream - `host:port` (or a list) to proxy to
 * @param options.match - a protocol name (`"postgres"`) or full matcher sets
 * @example buildLayer4ProxyRoute({ id: "postgres", upstream: "postgres:5432", match: "postgres" })
 */
export function buildLayer4ProxyRoute(options: {
  id?: string;
  upstream: string | string[];
  match?: Layer4Protocol | Layer4MatcherSet[];
}): Layer4Route {
  const match =
    typeof options.match === "string" ? [{ [options.match]: {} }] : (options.match ?? undefined);
  return Layer4RouteSchema.parse({
    ...(options.id ? { "@id": options.id } : {}),
    ...(match ? { match } : {}),
    handle: [buildLayer4ProxyHandler(options.upstream)],
  });
}

/**
 * A layer4 server: where it listens and its routes, tried in order.
 *
 * @description Layer 4 server for `apps.layer4.servers.<name>`
 * @example buildLayer4Server({ listen: [":5432"], routes: [route] })
 */
export function buildLayer4Server(options: {
  listen: string | string[];
  routes: Layer4Route[];
}): Layer4Server {
  return Layer4ServerSchema.parse({
    listen: Array.isArray(options.listen) ? options.listen : [options.listen],
    routes: options.routes,
  });
}
