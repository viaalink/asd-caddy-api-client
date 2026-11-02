# Prefer code? Use the builders

In TypeScript or JavaScript, type `build` for the builder functions of [`@viaalink/caddy-api-client`](https://www.npmjs.com/package/@viaalink/caddy-api-client). Accepting one fills in its required options and adds the import:

```ts
import { buildProtectedRoute } from "@viaalink/caddy-api-client";

const route = buildProtectedRoute({
  hosts: ["app.example.com"],
  gatekeeperName: "mypolicy",
  dial: "localhost:3000",
});
```

Every builder snippet type-checks against the library. The `caddy-sec-*` snippets set up a whole caddy-security configuration in a few lines.
