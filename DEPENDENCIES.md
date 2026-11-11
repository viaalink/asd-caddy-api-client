# Dependency Versions

This file tracks the upstream versions used to generate types and schemas.

## Version Compatibility Matrix

Which npm package version supports which Caddy and plugin versions:

| npm Package  | Caddy    | caddy-security | go-authcrunch | Notes                                                                                                                                                                                                                                  |
| ------------ | -------- | -------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.9.0–0.10.0 | v2.11.4  | v1.1.64        | v1.1.41       | Current — 0.9.0: security-dense dependency bump, `caddy-dns` DNS provider plugin sources (see below), first public vscode-extension release, editor schema strictness fixes. 0.10.0: no dependency changes, test-coverage-only release |
| 0.6.0–0.8.0  | v2.11.2  | v1.1.59        | v1.1.35       | —                                                                                                                                                                                                                                      |
| 0.4.0–0.5.2  | v2.10.2  | v1.1.31        | v1.1.7        | First plugin framework release                                                                                                                                                                                                         |
| 0.3.0        | v2.10.2  | —              | —             | Self-contained type generation                                                                                                                                                                                                         |
| 0.1.0–0.2.2  | external | —              | —             | Used caddy-json-types package                                                                                                                                                                                                          |

## Core Caddy

| Component | Version | Commit   | Updated    |
| --------- | ------- | -------- | ---------- |
| Caddy     | v2.11.4 | e2eee6a7 | 2026-08-11 |

**Source:** `local/caddy` (git repository)
**Generated files:** `src/generated/caddy-*.ts`, `src/generated/caddy-*.zod.ts`

**v2.11.2 → v2.11.4 notes:** additive only — no removed JSON fields. New optional
fields: `checksum` (zstd encoder), `otlp` + `stream_buffer_size` (reverse_proxy), new
`SystemCAPool`/`CombinedCAPool` TLS CA-pool types. Includes 2 upstream security fixes
(logic-only, no schema impact): `GHSA-vcc4-2c75-vc9v` (templates XSS via `stripHTML`),
`GHSA-j8px-rmrx-76h9` (rewrite handler placeholder re-expansion disclosure). A Caddy-internal
refactor moved `LoggableHTTPHeader`/`LoggableStringArray` into an unexported `internal`
package — `resolve-cross-refs.ts` can't follow it, so `caddy-http.ts` now carries an
`⚠ Unresolved` warning for those two (logging-only) types; harmless, degrades to `any`.
Tygo's known comment-merging artifact (see `CHANGELOG.md`'s `[0.6.0]` notes for the first
occurrence) recurred in 3 files this round too (`caddy-auth.ts`, `caddy-reverseproxy.ts`,
`caddy-tls.ts`) — always run
`npm run typecheck` right after regen and fix any `Property or signature expected` errors
by hand before trusting the output.

## Plugins

| Plugin         | Version           | Source               | Updated    |
| -------------- | ----------------- | -------------------- | ---------- |
| caddy-security | v1.1.64           | local/caddy-security | 2026-08-11 |
| go-authcrunch  | v1.1.41           | local/go-authcrunch  | 2026-08-11 |
| caddy-l4       | commit `e54f24a1` | local/caddy-l4       | 2026-11-11 |

**v1.1.59 → v1.1.64 notes:** caddy-security's own exported struct shape is unchanged
(zero `json:"..."` tag diffs) — `caddy-security.ts`/`.zod.ts` regenerate byte-identical.
The real work is in the go-authcrunch bump it pulled in: OAuth JWT issuer/audience
validation, signature verification before claim merge, constant-time nonce comparison,
OAuth state-manager memory bounding, session-cache race fix, authz bypass/path hardening,
cookie-domain fix, trusted-redirect hardening — adds 3 new optional fields in
`pkg/idp/oauth` (`issuer`, `pkce_disabled`, `access_token_audience`), otherwise additive
only.

**Source:** `local/caddy-security` (git repository)
**Generated files:** `src/generated/plugins/caddy-security.ts`, `src/generated/plugins/caddy-security.zod.ts`
**Hand-written builders:** `src/plugins/caddy-security/`

## caddy-l4 (Layer 4)

| Component | Upstream                    | Pinned                                                                    | Updated    |
| --------- | --------------------------- | ------------------------------------------------------------------------- | ---------- |
| caddy-l4  | `github.com/mholt/caddy-l4` | commit `e54f24a1a59b099d22778ed423935cde56d83d4b` (master, merge of #492) | 2026-11-11 |

Pinned to a commit, not a tag: the latest tag (`v0.1.2`, 2026-07-15) is months behind what
everyone builds (`xcaddy build --with github.com/mholt/caddy-l4` takes the default branch). The
same commit is pinned in `tests/integration/Dockerfile.caddy-l4` and `demo/Dockerfile.caddy`
(`xcaddy build --with github.com/mholt/caddy-l4@<commit>`).

From 2026-11-04 to 2026-11-11 this was built from our fork `viaalink/caddy-l4` to get the
`remote_ip_list` reload fix below; upstream merged it as
[mholt/caddy-l4#492](https://github.com/mholt/caddy-l4/pull/492) (merge commit `e54f24a1`, which is
`96e1a6bf` plus only that fix, so the generated types did not change). caddy-l4's `go.mod` asks for Go
1.26.9; tygo parses through `go list`, and with `GOTOOLCHAIN=auto` (the default) a Go 1.22
install fetches that toolchain on its own.

**Source:** `local/caddy-l4` (git clone, checked out at the pinned commit)
**tygo config:** `scripts/upstreams/tygo/caddy-l4.yaml`, tracked in the repo (unlike the other plugins'
`local/*/tygo.yaml`); one output file per Go package, since modules reuse names (`Handler`,
`MatchRegexp`). Wire-protocol/runtime-only files (`connection.go`, `handlers.go`,
`caddyfile.go`, openvpn `crypto.go`/`messages.go`, tls `clienthello.go`/`parsehello.go`,
`iplist.go`, `metrics.go`) are excluded, and the generator drops Go runtime constants for this
plugin (`stripConstants`) and repairs tygo's comment-merging artifact itself.
**Regenerate only caddy-l4:** `npx tsx scripts/generate-plugin-types.ts --only caddy-l4`, then
`npx prettier --write src/generated/plugins/caddy-l4-*.ts` and `npm run typecheck`.
**Generated files:** `src/generated/plugins/caddy-l4-{core,clock,close,dns,echo,http,openvpn,postgres,proxy,proxyprotocol,quic,rdp,regexp,remoteiplist,socks,ssh,subroute,tee,throttle,tls,vars,winbox,wireguard,xmpp}.ts` and `.zod.ts`
**Hand-written schemas/builders:** `src/caddy/layer4-schemas.ts`, `src/caddy/layer4-builders.ts`
(re-exported by `src/caddy/layer4.ts`)

Modules covered (all of `caddy list-modules` for a build at the pinned commit): the `layer4`
app and the `caddy.listeners.layer4` wrapper; 22 matchers (`clock`, `dns`, `http`, `local_ip`,
`not`, `openvpn`, `postgres`, `proxy_protocol`, `quic`, `rdp`, `regexp`, `remote_ip`,
`remote_ip_list`, `socks4`, `socks5`, `ssh`, `tls`, `vars`, `vars_regexp`, `winbox`,
`wireguard`, `xmpp`) plus `tls.handshake_match.alpn`; 11 handlers (`close`, `echo`,
`postgres_tls`, `proxy`, `proxy_protocol`, `socks5`, `subroute`, `tee`, `throttle`, `tls`,
`vars`); 7 proxy selection policies.

**What the generator can't see, composed by hand in `layer4-schemas.ts`:** modules with custom
JSON whose Go structs only have `json:"-"` fields (`tls`/`quic` matchers = an inline map of
`tls.handshake_match.*` modules, `http` = a list of HTTP matcher sets, `not` = a list of matcher
sets); `Policy` (an `int` in Go, text in JSON); the `handler`/`policy` module-name keys; value
sets checked at provision time (e.g. `clock` times must be `HH:MM:SS`); cross-package refs that
ts-to-zod leaves as `z.any()` (`caddy.Duration`, `reverseproxy.TLSConfig`,
`caddytls.ConnectionPolicies`).

**Upstream bug, fixed in `e54f24a1`:** at upstream `96e1a6bf`, the config reload after a config
with `remote_ip_list` hangs, and the admin API with it. Caddy cancels a config's context before
it calls `Cleanup`; the monitor goroutine returns on `ctx.Done()`, and `IPList.StopMonitoring`
then sends on an unbuffered channel nobody reads any more. The fix
([mholt/caddy-l4#492](https://github.com/mholt/caddy-l4/pull/492)) closes the channel (once) instead, with a regression test
(`TestCleanupAfterContextCancel`). The integration test
loads `remote_ip_list` live again.

**Integration test:** `src/__tests__/integration/layer4-modules.integration.test.ts` against
`tests/integration/docker-compose.layer4-modules.yml` (own compose project, admin
`127.0.0.1:2022`).

## Handler Name Mapping

The caddy-security plugin registers the following Caddy modules:

| Module ID                                  | Handler/Provider                     | Description                     |
| ------------------------------------------ | ------------------------------------ | ------------------------------- |
| `http.handlers.authenticator`              | `handler: "authenticator"`           | Portal handler serving login UI |
| `http.authentication.providers.authorizer` | Provider in `authentication` handler | Token validation provider       |

Note: The `authorize` directive creates a standard Caddy `authentication` handler with the caddy-security `authorizer` provider configured.

## DNS Provider Plugins

`src/plugins/caddy-dns/` builds typed `providerConfig` for the `caddy-dns/*` ACME-DNS
challenge modules. The real JSON-tagged struct each `caddy-dns/*` wrapper uses lives in
the `libdns/*` package it embeds (`type Provider struct{ *libdns.Provider }`) — the
wrapper repos themselves are not vendored except `caddy-dns/route53`, whose wrapper adds
one extra field (`debug_logging`) of its own on top of the embedded `libdns/route53`
fields.

| Package                     | Upstream module                  | Version/commit                       | Updated    |
| --------------------------- | -------------------------------- | ------------------------------------ | ---------- |
| `local/libdns-porkbun`      | `github.com/libdns/porkbun`      | `v1.1.0`                             | 2026-08-11 |
| `local/libdns-cloudflare`   | `github.com/libdns/cloudflare`   | `v0.2.2`                             | 2026-08-11 |
| `local/libdns-route53`      | `github.com/libdns/route53`      | `v1.6.2`                             | 2026-08-11 |
| `local/libdns-digitalocean` | `github.com/libdns/digitalocean` | no tags — pinned to commit `dfa7af5` | 2026-08-11 |
| `local/libdns-godaddy`      | `github.com/libdns/godaddy`      | `v1.1.0`                             | 2026-08-11 |
| `local/caddy-dns-route53`   | `github.com/caddy-dns/route53`   | `v1.6.2`                             | 2026-08-11 |

**Generated files:** `src/generated/plugins/caddy-dns-{porkbun,cloudflare,digitalocean,godaddy}.ts`/`.zod.ts`, `caddy-dns-route53-libdns.ts`/`.zod.ts`, `caddy-dns-route53-wrapper.ts`/`.zod.ts`
**Hand-written builders:** `src/plugins/caddy-dns/`

**Known tygo artifacts, hand-excluded in `src/plugins/caddy-dns/{types,schemas}.ts`:**
`caddy-dns-digitalocean.ts`'s generated `Provider` interface carries a spurious `Client`
field (an all-unexported Go embed that emits nothing in real JSON); `caddy-dns-route53-wrapper.ts`'s generated `Provider` carries a spurious `Provider` field (the
cross-module `*route53.Provider` embed, mapped to `unknown`/`any` since tygo can't follow
a pointer embed across separate Go modules — see `local/caddy-dns-route53/tygo.yaml`).

### Adding a Provider

1. Find the real struct: `caddy-dns/<provider>` on GitHub almost always just embeds
   `*libdns.Provider` — the actual JSON-tagged struct is in `github.com/libdns/<provider>`.
2. Clone it: `git clone git@github.com:libdns/<provider>.git local/libdns-<provider>`,
   checkout the target tag/commit.
3. Add `scripts/upstreams/tygo/libdns-<provider>.yaml` (versioned; `just upstreams-sync`
   copies it to `local/libdns-<provider>/tygo.yaml`):
   ```yaml
   packages:
     - path: "github.com/libdns/<provider>"
       output_path: "../../src/generated/plugins/caddy-dns-<provider>.ts"
   ```
4. Add an entry to the `plugins` array in `scripts/generate-plugin-types.ts`, and one to
   `upstreams.json` (see [The update cycle](#the-update-cycle)).
5. Run `npm run generate:plugin-types`, then `npm run typecheck` immediately — tygo has a
   known comment-merging artifact (turns a field's trailing Go doc comment into a
   malformed `//` line comment that swallows the next field's `/**` opener, causing a
   real TS syntax error) that recurs on nearly every regen; fix any
   `Property or signature expected` errors by hand (see the `[0.6.0]`/`[0.9.0]`
   `CHANGELOG.md` notes for worked examples) before trusting the output.
6. Add the config interface to `src/plugins/caddy-dns/types.ts`, schema to `schemas.ts`,
   a `build<Provider>DnsConfig()` builder, a case in `buildAcmeDnsProviderConfig`'s
   switch, and a row to `docs/plugins/caddy-dns/README.md`'s provider table.
7. Update this file with the new version info.
8. `npm run typecheck && npm run lint && npm run test` to verify.

## The update cycle

Every Go source the generated code comes from is listed in [`upstreams.json`](./upstreams.json):
repo, `local/` clone, how it is tracked, the pinned ref and commit, and its tygo config
(versioned in `scripts/upstreams/tygo/`, so a clean checkout can regenerate). Tracking:

| `track.type` | Moves to                                                  | Used by                                                    |
| ------------ | --------------------------------------------------------- | ---------------------------------------------------------- |
| `tag`        | the newest stable semver tag matching `pattern`           | Caddy, caddy-security, caddy-dns/route53, libdns/\* tagged |
| `gomod`      | the version its `parent`'s go.mod requires at its new pin | go-authcrunch (caddy-security), libdns/route53             |
| `branch`     | the branch head, pinned by commit (tags absent or stale)  | caddy-l4, libdns/digitalocean                              |

`gomod` keeps the types honest: caddy-security v1.1.64 builds against go-authcrunch
v1.1.41, not the newest go-authcrunch, so that is the one to generate from.

```bash
just upstreams-check    # report; exit 10 when a pin is behind. Read-only (git ls-remote)
just upstreams-update   # move the pins, regenerate, run the gate, write the PR body
just upstreams-sync     # put every local/ clone on its pin (clones what is missing)
```

`just upstreams-update` (options: `--only a,b`, `--target name=ref`, `--skip-vscode`,
`--no-gate`):

1. Puts every clone on its current pin and runs `generate:all` (the **baseline**).
   Where the committed file differs from the baseline, it carries a fix by hand
   (tygo's comment-merging artifact, the `queryOps` types in `caddy-rewrite.ts`).
2. Checks out the new refs and runs `generate:all` again, then three-way merges each
   hand-fix onto the new output (`git merge-file`: new output, baseline, committed).
   A fix on lines upstream also changed becomes a conflict, which fails the gate. The
   editor metadata and JSON schemas are then derived again from the merged sources.
3. Rewrites the pins in `upstreams.json`, the rows in this file's tables, the
   `install-caddy` action's default version and, for a new Caddy, adds a row to the
   supported-Caddy tables in `README.md` and `vscode-extension/README.md` (rendered
   from `upstreams.json` → `supportedCaddy`).
4. Gate: `just format-check`, `lint`, `typecheck`, `test` (that is `just check`, one
   recipe at a time) and `just build`; on a Caddy bump also `just vscode-deps` and
   `just vscode-test`.
5. Writes `local/upstreams/summary.md` (gate table, bumps with `json:"…"` tag-line
   counts and compare links, warnings, regenerated files, log tails of what failed)
   and `local/upstreams/result.json`. Exit 0 = green or nothing to do, 20 = gate failed.

It never commits. Three pieces run it unattended (decided 2026-11-11: releases follow
upstream automatically, but only through a fully green CI):

1. **`.github/workflows/upstreams.yml`** (Mondays 05:23 UTC, and on demand) runs it with
   `--release-bump` and opens or updates **one** pull request from `bot/upstreams` with the
   summary as its body. `--release-bump` makes the PR carry its own release: no version
   change when the generated code is unchanged, a **patch** when it only gains lines, a
   **minor** when a generated line of code was removed or changed (pre-1.0, minor is the
   breaking slot). It bumps `package.json`, turns `## [Unreleased]` (or a new section) into
   the release entry in `CHANGELOG.md`, and fills the version into the supported-Caddy row.
   A green gate labels the PR `auto-release`; a failing one titles it `[gate failing]` and
   labels it `gate-failing`. A PR labelled `autofix` or `hold` is left alone, so a run never
   force-pushes over a fix.
2. **The auto-fix routine** (a Claude Code cloud routine, daily) takes a `gate-failing` bot
   PR, labels it `autofix`, fixes the code (tygo artifacts, builders, schemas, tests) on
   `bot/upstreams`, raises the version to minor if its fix is breaking, and once
   `just check` and `just build` pass, swaps `gate-failing` for `auto-release`. After three
   attempts without success it labels the PR `needs-human` and stops.
3. **`.github/workflows/upstreams-release.yml`** (after every CI run on `bot/upstreams`, and
   when the PR gets `auto-release`) runs `scripts/upstreams/auto-release.sh` from main. It
   squash-merges the PR only if it is labelled `auto-release` and not `hold`/`gate-failing`,
   CI's eight checks (Lint, Type Check, Unit/Integration/Caddy Security/Differential Fuzz/
   VSCode Extension Tests, Build) all passed on its current head, it touches no workflow,
   hook, `Justfile` or lockfile, and `package.json` changes only its version (else it adds
   `hold`). Then it tags `v<version>`, and `release.yml` publishes to npm. No version change,
   no tag. A dry run: _Actions → Upstreams release → Run workflow_ (dry run is the default).

To stop all of it for one PR, label it `hold`. The VS Code extension is not released by
this: its own release stays manual.

Setup: an `UPSTREAMS_TOKEN` secret (fine-grained PAT or GitHub App token, contents +
pull-requests write). With the default `GITHUB_TOKEN`, the bot's PR starts no CI and the
merge and tag start no release. The repository setting _Allow GitHub Actions to create and
approve pull requests_ must be on.

Locally, a Go older than an upstream's `go` line fails tygo (`toolchain not available`);
run with `GOTOOLCHAIN=go1.25.0+auto`. The update reports a swallowed tygo failure in
`generate-plugin-types.ts` as a failed generation instead of leaving stale types.

## Regenerating Types

When updating Caddy types (or let `just upstreams-update` do all of this):

1. Update `local/caddy` to target version:

   ```bash
   cd local/caddy
   git fetch --tags
   git checkout v2.x.x
   ```

2. Run type generation:

   ```bash
   npm run generate:types
   ```

3. Update this file with new version info

4. Commit all changes together

## Updating Plugins

When updating caddy-security:

1. Update `local/caddy-security` to target version:

   ```bash
   cd local/caddy-security
   git fetch --tags
   git checkout v1.x.x
   ```

2. Verify module IDs match current types:

   ```bash
   grep -rn "CaddyModule()" local/caddy-security/*.go
   ```

3. Update types/schemas in `src/plugins/caddy-security/` if needed

4. Update this file with new version info

5. Run tests to verify:

   ```bash
   npm run typecheck && npm run test
   ```

## Adding a New Plugin

1. Clone plugin source to `local/<plugin-name>`
2. Create `local/<plugin-name>/tygo.yaml` configuration
3. Add plugin to `scripts/generate-plugin-types.ts`
4. Run `npm run generate:plugin-types` to generate TypeScript types
5. Analyze Go source for module IDs: `grep -rn "CaddyModule()" local/<plugin-name>/*.go`
6. Create hand-written builders in `src/plugins/<name>/` (types, schemas, builders, index)
7. Export from `src/plugins/index.ts`
8. Add entry to the Plugins table above
9. Run `npm run typecheck && npm run test` to verify
