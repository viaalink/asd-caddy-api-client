import { CaddyClient, buildHostRoute } from "@viaalink/caddy-api-client";

const caddy = new CaddyClient({ adminUrl: "http://127.0.0.1:2019" });

// Public site
const site = buildHostRoute({
  host: "example.com",
  dial: "localhost:8080",
});

// Admin dashboard, behind caddy-security
