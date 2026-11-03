import { describe, test, expect } from "vitest";
import {
  lintCaddyConfig,
  closestMatches,
  editDistance,
} from "../../vscode-extension/src/providers/caddy-lint.js";

const codes = (text: string): string[] => lintCaddyConfig(text).map((f) => f.code);

function applyFirstFix(text: string, code: string): string {
  const f = lintCaddyConfig(text).find((x) => x.code === code)!;
  return text.slice(0, f.start) + f.fixes[0].newText + text.slice(f.end);
}

const route = (handle: string, extra = ""): string =>
  `{ "@id": "app", "match": [{ "host": ["app.example.com"] }], "handle": [${handle}]${extra} }`;

describe("lintCaddyConfig", () => {
  test("a clean route has no findings", () => {
    expect(
      lintCaddyConfig(
        route('{ "handler": "reverse_proxy", "upstreams": [{ "dial": "localhost:3000" }] }')
      )
    ).toEqual([]);
  });

  test("tolerates comments, trailing commas and half-typed JSON", () => {
    expect(() => lintCaddyConfig('// c\n{ "handle": [ { "dial": "x", }, ')).not.toThrow();
  });

  describe("dial", () => {
    test("a URL is an error, fixed to host:port with the scheme's default port", () => {
      const text = route(
        '{ "handler": "reverse_proxy", "upstreams": [{ "dial": "http://localhost" }] }'
      );
      expect(codes(text)).toEqual(["dial-url"]);
      expect(applyFirstFix(text, "dial-url")).toContain('"dial": "localhost:80"');
    });

    test("https URL keeps an explicit port and mentions the TLS transport", () => {
      const text = route(
        '{ "handler": "reverse_proxy", "upstreams": [{ "dial": "https://api.internal:8443/v1" }] }'
      );
      const f = lintCaddyConfig(text)[0];
      expect(f.fixes[0].newText).toBe('"api.internal:8443"');
      expect(f.message).toContain('"tls"');
    });

    test("a missing port is an error with :80 / :443 fixes", () => {
      const text = route('{ "handler": "reverse_proxy", "upstreams": [{ "dial": "backend" }] }');
      expect(codes(text)).toEqual(["dial-port"]);
      expect(lintCaddyConfig(text)[0].fixes.map((x) => x.newText)).toEqual([
        '"backend:80"',
        '"backend:443"',
      ]);
    });

    test.each([
      "localhost:3000",
      "[::1]:8080",
      "tcp/10.0.0.1:80",
      "unix//run/app.sock",
      "unix+h2c//run/app.sock",
      "unixgram//tmp/a.sock",
      "unixpacket//tmp/a.sock",
      "tcp6/[::1]:8080",
      "{http.reverse_proxy.upstream.hostport}",
      "localhost:8000-8010",
    ])("%s is accepted", (dial) => {
      expect(
        codes(route(`{ "handler": "reverse_proxy", "upstreams": [{ "dial": "${dial}" }] }`))
      ).toEqual([]);
    });
  });

  test("a unix dial with no socket path is flagged, with no port fix", () => {
    const text = route('{ "handler": "reverse_proxy", "upstreams": [{ "dial": "unix/" }] }');
    expect(codes(text)).toEqual(["dial-unix-path"]);
    expect(lintCaddyConfig(text)[0].fixes).toEqual([]);
  });

  test("host matcher with a scheme, port or path is flagged and fixed to the bare host", () => {
    const text = '{ "match": [{ "host": ["https://app.example.com:8443/x", "ok.example.com"] }] }';
    expect(codes(text)).toEqual(["host-format"]);
    expect(applyFirstFix(text, "host-format")).toContain('["app.example.com", "ok.example.com"]');
  });

  test("LDAP {username} placeholder is flagged and fixed to %s", () => {
    const text =
      '{ "params": { "search_user_filter": "(&(uid={username})(objectClass=person))" } }';
    expect(codes(text)).toEqual(["ldap-filter-placeholder"]);
    expect(applyFirstFix(text, "ldap-filter-placeholder")).toContain(
      '"(&(uid=%s)(objectClass=person))"'
    );
  });

  test("a 3xx static_response without Location warns", () => {
    expect(codes(route('{ "handler": "static_response", "status_code": 301 }'))).toEqual([
      "redirect-no-location",
    ]);
    expect(
      codes(
        route(
          '{ "handler": "static_response", "status_code": 301, "headers": { "Location": ["https://x"] } }'
        )
      )
    ).toEqual([]);
    expect(codes(route('{ "handler": "static_response", "status_code": 200 }'))).toEqual([]);
  });

  test("duplicate @id is an error on every occurrence after the first", () => {
    const text = '{ "routes": [{ "@id": "a" }, { "@id": "b" }, { "@id": "a" }, { "@id": "a" }] }';
    const dupes = lintCaddyConfig(text).filter((f) => f.code === "duplicate-id");
    expect(dupes).toHaveLength(2);
    expect(dupes[0].start).toBeGreaterThan(text.indexOf('"b"'));
  });

  describe("cross references", () => {
    const security = (portalStores: string, gatekeeper: string): string => `{
      "apps": {
        "security": { "config": {
          "identity_stores": [{ "name": "localdb", "kind": "local", "params": { "path": "/u.json" } }],
          "authentication_portals": [{ "name": "myportal", "identity_stores": ${portalStores} }],
          "authorization_policies": [{ "name": "admins" }, { "name": "users" }]
        } },
        "http": { "servers": { "srv0": { "routes": [{
          "handle": [{ "handler": "authentication", "providers": { "authorizer": { "gatekeeper_name": ${gatekeeper} } } }]
        }] } } }
      }
    }`;

    test("valid references are clean", () => {
      expect(codes(security('["localdb"]', '"admins"'))).toEqual([]);
    });

    test("unknown policy name suggests the closest defined one", () => {
      const text = security('["localdb"]', '"admin"');
      const f = lintCaddyConfig(text).find((x) => x.code === "unknown-reference")!;
      expect(f.message).toContain('No policy named "admin"');
      expect(f.fixes[0].newText).toBe('"admins"');
    });

    test("unknown identity store in a portal is flagged", () => {
      expect(codes(security('["local"]', '"admins"'))).toEqual(["unknown-reference"]);
    });

    test("references aren't checked when the document doesn't define that collection", () => {
      expect(
        codes(
          route(
            '{ "handler": "authentication", "providers": { "authorizer": { "gatekeeper_name": "elsewhere" } } }'
          )
        )
      ).toEqual([]);
    });
  });
});

describe("closestMatches / editDistance", () => {
  test("ranks by edit distance and ignores far-off candidates", () => {
    expect(editDistance("upstream", "upstreams")).toBe(1);
    expect(closestMatches("upstream", ["upstreams", "transport", "headers"])).toEqual([
      "upstreams",
    ]);
    expect(closestMatches("zzz", ["upstreams"])).toEqual([]);
  });
});
