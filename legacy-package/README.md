# Moved to `@viaalink/caddy-api-client`

`@accelerated-software-development/caddy-api-client` is now
[`@viaalink/caddy-api-client`](https://www.npmjs.com/package/@viaalink/caddy-api-client).
Same code, same API, new name. New releases appear only there.

## Switch

```bash
npm uninstall @accelerated-software-development/caddy-api-client
npm install @viaalink/caddy-api-client
```

Then replace `@accelerated-software-development/caddy-api-client` with
`@viaalink/caddy-api-client` in your imports. Subpaths stay the same
(`/caddy`, `/mitm`, `/plugins`, `/plugins/caddy-dns`, ...).

## Until you switch

This last version (0.10.1) contains no code of its own: it re-exports
`@viaalink/caddy-api-client`, so existing imports keep working and pick up its
fixes. It is deprecated, so npm warns on install.
