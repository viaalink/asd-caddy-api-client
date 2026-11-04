/**
 * Extension assets for VSCode extension and tooling
 *
 * AUTO-GENERATED FILE - DO NOT EDIT
 * Generated from source files by scripts/extract-metadata.ts
 * Run: npm run generate:extension
 *
 * @generated
 * @version 0.10.2
 * @generatedAt 2026-11-04T16:59:09.062Z
 */

// ============================================================================
// Metadata Types
// ============================================================================

export interface ParamMetadata {
  name: string;
  type: string;
  required: boolean;
  description: string;
  default?: string;
  example?: string;
}

export interface SnippetDefinition {
  prefix: string;
  body: string[];
  description: string;
}

export interface BuilderMetadata {
  name: string;
  description: string;
  params: ParamMetadata[];
  returnType: string;
  example?: string;
  snippet: SnippetDefinition;
}

export interface HandlerMetadata {
  name: string;
  displayName: string;
  description: string;
  discriminator: string;
  commonFields: string[];
  caddyDocsPath: string;
}

// ============================================================================
// Generated Metadata
// ============================================================================

/**
 * Library version this metadata was generated from
 */
export const METADATA_VERSION = "0.10.2";

/**
 * Timestamp when this metadata was generated
 */
export const GENERATED_AT = "2026-11-04T16:59:09.062Z";

/**
 * Builder function metadata extracted from JSDoc and type definitions
 *
 * Use this for:
 * - Generating VSCode snippets
 * - Powering wizard step generation
 * - Providing hover documentation
 */
export const BUILDER_METADATA: Record<string, BuilderMetadata> = {
  buildLocalIdentityStore: {
    name: "buildLocalIdentityStore",
    description:
      "Build a local identity store configuration\n\nCreates a local JSON file-based identity store for user credentials.\nUses the authcrunch wrapper structure: name, kind, params",
    params: [
      {
        name: "name",
        type: "string",
        required: false,
        description: "Name of the identity store (used to reference it in portals)",
        default: "local",
      },
      {
        name: "path",
        type: "string",
        required: true,
        description: "Path to the JSON file containing user credentials",
      },
      {
        name: "realm",
        type: "string",
        required: false,
        description: "Realm name for this identity store",
        default: "local",
      },
    ],
    returnType: "LocalIdentityStore",
    example:
      'import { buildLocalIdentityStore } from "@.../caddy-api-client/plugins/caddy-security";\n\nconst store = buildLocalIdentityStore({\n  name: "localdb",\n  path: "/etc/caddy/users.json",\n  realm: "local",\n});',
    snippet: {
      prefix: "caddy-local-identity-store",
      body: [
        "buildLocalIdentityStore({",
        '  path: "${1:/etc/caddy/users.json}",',
        "  // optional: name, realm",
        "})$0",
      ],
      description: "Build Local Identity Store",
    },
  },
  buildLdapIdentityStore: {
    name: "buildLdapIdentityStore",
    description:
      "Build an LDAP identity store configuration\n\nCreates an LDAP-based identity store for user authentication.\nUses the authcrunch wrapper structure: name, kind, params",
    params: [
      {
        name: "name",
        type: "string",
        required: false,
        description: "Name of the identity store (used to reference it in portals)",
        default: "ldapdb",
      },
      {
        name: "realm",
        type: "string",
        required: false,
        description: "Realm name for this identity store",
        default: "ldap",
      },
      {
        name: "servers",
        type: "LdapServerConfig[]",
        required: true,
        description: "LDAP server(s) to connect to",
      },
      {
        name: "bindUsername",
        type: "string",
        required: true,
        description: "Bind username for LDAP queries (full DN)",
        example: "cn=admin,dc=example,dc=com",
      },
      {
        name: "bindPassword",
        type: "string",
        required: true,
        description: "Bind password for LDAP authentication",
      },
      {
        name: "searchBaseDn",
        type: "string",
        required: true,
        description: "Base DN for user searches",
        example: "ou=users,dc=example,dc=com",
      },
      {
        name: "searchUserFilter",
        type: "string",
        required: false,
        description: "LDAP search filter template for users",
        default: "(uid={username})",
      },
      {
        name: "groups",
        type: "LdapGroupConfig[]",
        required: false,
        description: "Group to role mappings",
        default: "[]",
      },
    ],
    returnType: "LdapIdentityStore",
    example:
      'import { buildLdapIdentityStore } from "@.../caddy-api-client/plugins/caddy-security";\n\nconst store = buildLdapIdentityStore({\n  name: "ldapdb",\n  servers: [{ address: "ldap.example.com", port: 389 }],\n  bindUsername: "cn=admin,dc=example,dc=com",\n  bindPassword: "secret",\n  searchBaseDn: "ou=users,dc=example,dc=com",\n  searchUserFilter: "(uid={username})",\n});',
    snippet: {
      prefix: "caddy-ldap-identity-store",
      body: [
        "buildLdapIdentityStore({",
        '  servers: [{ address: "${1:ldap.example.com}" }],',
        '  bindUsername: "${2:cn=admin,dc=example,dc=com}",',
        '  bindPassword: "${3:change-me}",',
        '  searchBaseDn: "${4:ou=users,dc=example,dc=com}",',
        "  // optional: name, realm, searchUserFilter, groups",
        "})$0",
      ],
      description: "Build LDAP Identity Store",
    },
  },
  buildOAuth2Provider: {
    name: "buildOAuth2Provider",
    description:
      "Build an OAuth2 identity provider configuration\n\nUses the authcrunch wrapper structure: name, kind, params",
    params: [
      {
        name: "name",
        type: "string",
        required: false,
        description: "Name of the identity provider (used to reference it in portals)",
      },
      {
        name: "realm",
        type: "string",
        required: false,
        description: "Realm name for this provider",
      },
      {
        name: "provider",
        type: "string",
        required: true,
        description: "Provider name/driver (github, google, facebook, etc.)",
      },
      {
        name: "clientId",
        type: "string",
        required: true,
        description: "OAuth client ID",
      },
      {
        name: "clientSecret",
        type: "string",
        required: true,
        description: "OAuth client secret",
      },
      {
        name: "scopes",
        type: "string[]",
        required: false,
        description: "OAuth scopes to request",
        default: '["openid", "email", "profile"]',
      },
      {
        name: "authorizationUrl",
        type: "string",
        required: false,
        description: "Authorization URL (for non-standard providers)",
      },
      {
        name: "tokenUrl",
        type: "string",
        required: false,
        description: "Token URL (for non-standard providers)",
      },
    ],
    returnType: "OAuth2IdentityProvider",
    example:
      'import { buildOAuth2Provider } from "@.../caddy-api-client/plugins/caddy-security";\n\nconst provider = buildOAuth2Provider({\n  name: "github",\n  provider: "github",\n  clientId: "your-client-id",\n  clientSecret: "your-client-secret",\n  scopes: ["user:email", "read:user"],\n});',
    snippet: {
      prefix: "caddy-oauth2-provider",
      body: [
        "buildOAuth2Provider({",
        '  provider: "${1:github}",',
        '  clientId: "${2:your-client-id}",',
        '  clientSecret: "${3:your-client-secret}",',
        "  // optional: name, realm, scopes, authorizationUrl, tokenUrl",
        "})$0",
      ],
      description: "Build OAuth2 Provider",
    },
  },
  buildOidcProvider: {
    name: "buildOidcProvider",
    description:
      "Build an OIDC identity provider configuration\n\nUses the authcrunch wrapper structure: name, kind, params",
    params: [
      {
        name: "name",
        type: "string",
        required: false,
        description: "Name of the identity provider (used to reference it in portals)",
      },
      {
        name: "realm",
        type: "string",
        required: false,
        description: "Realm name for this provider",
      },
      {
        name: "provider",
        type: "string",
        required: true,
        description: "OIDC provider name (keycloak, okta, auth0, etc.)",
      },
      {
        name: "clientId",
        type: "string",
        required: true,
        description: "Client ID",
      },
      {
        name: "clientSecret",
        type: "string",
        required: true,
        description: "Client secret",
      },
      {
        name: "metadataUrl",
        type: "string",
        required: true,
        description: "OIDC metadata/discovery URL (.well-known/openid-configuration)",
        example: "https://keycloak.example.com/realms/myrealm/.well-known/openid-configuration",
      },
      {
        name: "scopes",
        type: "string[]",
        required: false,
        description: "Scopes to request",
        default: '["openid", "email", "profile"]',
      },
    ],
    returnType: "OidcIdentityProvider",
    example:
      'import { buildOidcProvider } from "@.../caddy-api-client/plugins/caddy-security";\n\nconst provider = buildOidcProvider({\n  name: "keycloak",\n  provider: "keycloak",\n  clientId: "my-app",\n  clientSecret: "secret",\n  metadataUrl: "https://keycloak.example.com/realms/myrealm/.well-known/openid-configuration",\n});',
    snippet: {
      prefix: "caddy-oidc-provider",
      body: [
        "buildOidcProvider({",
        '  provider: "${1:github}",',
        '  clientId: "${2:your-client-id}",',
        '  clientSecret: "${3:your-client-secret}",',
        '  metadataUrl: "${4:https://idp.example.com}",',
        "  // optional: name, realm, scopes",
        "})$0",
      ],
      description: "Build OIDC Provider",
    },
  },
  buildAuthenticationPortal: {
    name: "buildAuthenticationPortal",
    description: "Build an authentication portal configuration",
    params: [
      {
        name: "name",
        type: "string",
        required: true,
        description: "Portal name (referenced by portal_name in handlers)",
      },
      {
        name: "ui",
        type: "PortalUiOptions",
        required: false,
        description: "UI customization settings",
      },
      {
        name: "cookie",
        type: "CookieOptions",
        required: false,
        description: "Cookie settings",
      },
      {
        name: "identityStores",
        type: "string[]",
        required: false,
        description: "Identity store names enabled for this portal",
      },
      {
        name: "identityProviders",
        type: "string[]",
        required: false,
        description: "Identity provider names enabled for this portal",
      },
      {
        name: "transformUser",
        type: "Record<string, unknown>",
        required: false,
        description: "Transform rules for user claims",
      },
    ],
    returnType: "AuthenticationPortal",
    example:
      'import { buildAuthenticationPortal } from "@.../caddy-api-client/plugins/caddy-security";\n\nconst portal = buildAuthenticationPortal({\n  name: "myportal",\n  identityStores: ["localdb"],\n  identityProviders: ["keycloak"],\n  cookie: { domain: ".example.com", lifetime: "24h" },\n});',
    snippet: {
      prefix: "caddy-authentication-portal",
      body: [
        "buildAuthenticationPortal({",
        '  name: "${1:myportal}",',
        "  // optional: ui, cookie, identityStores, identityProviders, transformUser",
        "})$0",
      ],
      description: "Build Authentication Portal",
    },
  },
  buildAuthorizationPolicy: {
    name: "buildAuthorizationPolicy",
    description: "Build an authorization policy (gatekeeper) configuration",
    params: [
      {
        name: "name",
        type: "string",
        required: true,
        description: "Policy name (referenced by gatekeeper_name in handlers)",
      },
      {
        name: "accessLists",
        type: "AccessListEntry[]",
        required: false,
        description: "Access control lists",
      },
      {
        name: "cryptoKey",
        type: "CryptoKeyConfig",
        required: false,
        description: "Crypto key configuration for JWT validation",
      },
      {
        name: "bypass",
        type: "string[]",
        required: false,
        description: "Bypass paths (no auth required)",
      },
    ],
    returnType: "AuthorizationPolicy",
    example:
      'import { buildAuthorizationPolicy } from "@.../caddy-api-client/plugins/caddy-security";\n\nconst policy = buildAuthorizationPolicy({\n  name: "admin-policy",\n  accessLists: [\n    { claim: "roles", values: ["admin", "editor"], action: "allow" },\n  ],\n  bypass: ["/health", "/metrics"],\n});',
    snippet: {
      prefix: "caddy-authorization-policy",
      body: [
        "buildAuthorizationPolicy({",
        '  name: "${1:mypolicy}",',
        "  // optional: accessLists, cryptoKey, bypass",
        "})$0",
      ],
      description: "Build Authorization Policy",
    },
  },
  buildSecurityConfig: {
    name: "buildSecurityConfig",
    description: "Build a security configuration",
    params: [
      {
        name: "portals",
        type: "AuthenticationPortal[]",
        required: false,
        description: "Authentication portals",
      },
      {
        name: "policies",
        type: "AuthorizationPolicy[]",
        required: false,
        description: "Authorization policies (gatekeepers)",
      },
      {
        name: "identityStores",
        type: "(LocalIdentityStore | LdapIdentityStore)[]",
        required: false,
        description: "Identity stores",
      },
      {
        name: "identityProviders",
        type: "(OAuth2IdentityProvider | OidcIdentityProvider)[]",
        required: false,
        description: "Identity providers",
      },
    ],
    returnType: "SecurityConfig",
    example:
      'import {\n  buildSecurityConfig,\n  buildLocalIdentityStore,\n  buildAuthenticationPortal,\n  buildAuthorizationPolicy,\n} from "@.../caddy-api-client/plugins/caddy-security";\n\nconst config = buildSecurityConfig({\n  identityStores: [\n    buildLocalIdentityStore({ path: "/etc/caddy/users.json" }),\n  ],\n  portals: [\n    buildAuthenticationPortal({\n      name: "myportal",\n      identityStores: ["local"],\n    }),\n  ],\n  policies: [\n    buildAuthorizationPolicy({\n      name: "mypolicy",\n      accessLists: [{ claim: "roles", values: ["user"] }],\n    }),\n  ],\n});',
    snippet: {
      prefix: "caddy-security-config",
      body: [
        "buildSecurityConfig({",
        '  portals: [{ name: "${1:myportal}" }],',
        '  policies: [{ name: "${2:mypolicy}" }],',
        '  identityStores: [{ name: "${3:local}", params: { path: "${4:/etc/caddy/users.json}" }, kind: "local" }],',
        "  // optional: identityProviders",
        "})$0",
      ],
      description: "Build Security Config",
    },
  },
  buildSecurityApp: {
    name: "buildSecurityApp",
    description:
      "Build a complete security app configuration\n\nCreates the full security app configuration for `/config/apps/security`.",
    params: [
      {
        name: "config",
        type: "SecurityConfig",
        required: true,
        description: "Security configuration",
      },
    ],
    returnType: "SecurityApp",
    example:
      'import { buildSecurityApp, buildSecurityConfig } from "@.../caddy-api-client/plugins/caddy-security";\n\nconst app = buildSecurityApp({\n  config: buildSecurityConfig({\n    // ... config options\n  }),\n});\n\n// Apply to Caddy\nawait client.request("/config/apps/security", {\n  method: "PUT",\n  body: JSON.stringify(app),\n});',
    snippet: {
      prefix: "caddy-security-app",
      body: ["buildSecurityApp({", "  config: {},", "})$0"],
      description: "Build Security App",
    },
  },
  buildAuthenticatorHandler: {
    name: "buildAuthenticatorHandler",
    description:
      "Build an authenticator portal handler\n\nCreates a caddy-security authenticator handler that serves the login portal\nand handles credential validation.",
    params: [
      {
        name: "portalName",
        type: "string",
        required: true,
        description: "Name of the authentication portal defined in security app config",
      },
      {
        name: "routeMatcher",
        type: "string",
        required: false,
        description: "Optional route matcher pattern",
      },
    ],
    returnType: "SecurityAuthenticatorHandler",
    example:
      'import { buildAuthenticatorHandler } from "@.../caddy-api-client/plugins/caddy-security";\n\nconst handler = buildAuthenticatorHandler({\n  portalName: "myportal",\n});\n\n// Use in a route\nconst route: CaddyRoute = {\n  match: [{ host: ["auth.example.com"] }],\n  handle: [handler],\n  terminal: true,\n};',
    snippet: {
      prefix: "caddy-authenticator-handler",
      body: [
        "buildAuthenticatorHandler({",
        '  portalName: "${1:myportal}",',
        "  // optional: routeMatcher",
        "})$0",
      ],
      description: "Build Authenticator Handler",
    },
  },
  buildAuthorizationHandler: {
    name: "buildAuthorizationHandler",
    description:
      "Build an authorization handler\n\nCreates a caddy-security authorization handler that validates JWT/PASETO\ntokens and enforces access control policies.\n\nThis uses Caddy's built-in `authentication` handler with the caddy-security\n`authorizer` provider.",
    params: [
      {
        name: "gatekeeperName",
        type: "string",
        required: true,
        description: "Name of the gatekeeper/policy defined in security app config",
      },
      {
        name: "routeMatcher",
        type: "string",
        required: false,
        description: "Optional route matcher pattern",
      },
    ],
    returnType: "SecurityAuthorizationHandler",
    example:
      'import { buildAuthorizationHandler } from "@.../caddy-api-client/plugins/caddy-security";\n\nconst handler = buildAuthorizationHandler({\n  gatekeeperName: "mygatekeeper",\n});\n\n// Protect a route\nconst route: CaddyRoute = {\n  match: [{ host: ["api.example.com"] }],\n  handle: [\n    handler,  // Check auth first\n    { handler: "reverse_proxy", upstreams: [{ dial: "localhost:3000" }] },\n  ],\n  terminal: true,\n};',
    snippet: {
      prefix: "caddy-authorization-handler",
      body: [
        "buildAuthorizationHandler({",
        '  gatekeeperName: "${1:mypolicy}",',
        "  // optional: routeMatcher",
        "})$0",
      ],
      description: "Build Authorization Handler",
    },
  },
  buildAuthenticatorRoute: {
    name: "buildAuthenticatorRoute",
    description:
      "Build a complete authentication portal route\n\nCreates a Caddy route that serves the authentication portal on specified hosts.",
    params: [
      {
        name: "hosts",
        type: "string[]",
        required: true,
        description: "Host(s) to match for the authentication portal",
      },
      {
        name: "portalName",
        type: "string",
        required: true,
        description: "Name of the authentication portal",
      },
      {
        name: "routeId",
        type: "string",
        required: false,
        description: "Route ID for tracking",
      },
    ],
    returnType: "CaddyRoute",
    example:
      'import { buildAuthenticatorRoute } from "@.../caddy-api-client/plugins/caddy-security";\n\nconst route = buildAuthenticatorRoute({\n  hosts: ["auth.example.com"],\n  portalName: "myportal",\n  routeId: "auth-portal",\n});\n\nawait client.addRoute("https_server", route);',
    snippet: {
      prefix: "caddy-authenticator-route",
      body: [
        "buildAuthenticatorRoute({",
        '  hosts: ["${1:example.com}"],',
        '  portalName: "${2:myportal}",',
        "  // optional: routeId",
        "})$0",
      ],
      description: "Build Authenticator Route",
    },
  },
  buildProtectedRoute: {
    name: "buildProtectedRoute",
    description:
      "Build a protected route with authorization\n\nCreates a Caddy route that requires valid JWT/PASETO tokens before\nproxying to the upstream service.",
    params: [
      {
        name: "hosts",
        type: "string[]",
        required: true,
        description: "Host(s) to match",
      },
      {
        name: "paths",
        type: "string[]",
        required: false,
        description: "Path(s) to match (optional)",
      },
      {
        name: "gatekeeperName",
        type: "string",
        required: true,
        description: "Name of the gatekeeper/policy for authorization",
      },
      {
        name: "dial",
        type: "string",
        required: true,
        description: "Upstream dial address (host:port)",
      },
      {
        name: "routeId",
        type: "string",
        required: false,
        description: "Route ID for tracking",
      },
    ],
    returnType: "CaddyRoute",
    example:
      'import { buildProtectedRoute } from "@.../caddy-api-client/plugins/caddy-security";\n\nconst route = buildProtectedRoute({\n  hosts: ["api.example.com"],\n  paths: ["/admin/*"],\n  gatekeeperName: "admin-policy",\n  dial: "localhost:3000",\n  routeId: "protected-admin-api",\n});\n\nawait client.addRoute("https_server", route);',
    snippet: {
      prefix: "caddy-protected-route",
      body: [
        "buildProtectedRoute({",
        '  hosts: ["${1:example.com}"],',
        '  gatekeeperName: "${2:mypolicy}",',
        '  dial: "${3:localhost:3000}",',
        "  // optional: paths, routeId",
        "})$0",
      ],
      description: "Build Protected Route",
    },
  },
  buildServiceRoutes: {
    name: "buildServiceRoutes",
    description: "Build routes for a service (host-based and/or path-based)",
    params: [
      {
        name: "host",
        type: "string",
        required: false,
        description: "Host for host-based route",
      },
      {
        name: "path",
        type: "string",
        required: false,
        description: "Path for path-based route",
      },
      {
        name: "pathRouteHost",
        type: "string",
        required: false,
        description: "Host for path-based route",
        default: "asd.localhost",
      },
      {
        name: "dial",
        type: "string",
        required: true,
        description: "Dial address (host:port)",
      },
      {
        name: "serviceId",
        type: "string",
        required: false,
        description: "Service identifier for health checks",
      },
      {
        name: "enableHostRoute",
        type: "boolean",
        required: false,
        description: "Enable host-based route",
        default: "true",
      },
      {
        name: "enablePathRoute",
        type: "boolean",
        required: false,
        description: "Enable path-based route",
        default: "true",
      },
      {
        name: "stripPrefix",
        type: "boolean",
        required: false,
        description: "Strip path prefix",
        default: "true",
      },
      {
        name: "priority",
        type: "number",
        required: false,
        description: "Route priority (higher = matches first)",
        default: "50",
      },
      {
        name: "securityHeaders",
        type: "SecurityHeaders",
        required: false,
        description: "Security headers configuration",
      },
      {
        name: "basicAuth",
        type: "BasicAuthOptions",
        required: false,
        description: "Basic authentication configuration",
      },
      {
        name: "ingressTag",
        type: "string",
        required: false,
        description:
          "Ingress tag value for X-ASD-Ingress header\nSet to null to explicitly disable",
      },
      {
        name: "iframeOrigin",
        type: "string",
        required: false,
        description:
          "Origin for iframe embedding headers (CORS + CSP)\nSet to null to explicitly disable",
      },
      {
        name: "deleteResponseHeaders",
        type: "string[]",
        required: false,
        description:
          'Response headers to delete from reverse proxy response\n(e.g., ["Content-Security-Policy"] for iframe support)',
      },
      {
        name: "serviceType",
        type: "string",
        required: false,
        description: "Service type for X-ASD-Service-Type header",
      },
      {
        name: "isTunnelDomain",
        type: "boolean",
        required: false,
        description:
          "Whether this is a tunnel domain route\nUsed for selective auth (tunnel vs host route type)",
      },
      {
        name: "flushInterval",
        type: "number",
        required: false,
        description:
          "Flush interval for reverse proxy streaming support.\nSet to -1 to disable buffering (required for WebSocket/SSE).",
      },
      {
        name: "projectId",
        type: "string",
        required: false,
        description:
          "Project identifier for X-ASD-Project header.\nUsed to identify which project's Caddy handled the request.",
      },
    ],
    returnType: "CaddyRoute[]",
    snippet: {
      prefix: "caddy-service-routes",
      body: [
        "buildServiceRoutes({",
        '  dial: "${1:localhost:3000}",',
        "  // optional: host, path, pathRouteHost, serviceId, enableHostRoute, enablePathRoute, ...",
        "})$0",
      ],
      description: "Build Service Routes",
    },
  },
  buildHealthCheckRoute: {
    name: "buildHealthCheckRoute",
    description: "Build a health check route",
    params: [
      {
        name: "host",
        type: "string",
        required: true,
        description: "",
      },
      {
        name: "serviceId",
        type: "string",
        required: true,
        description: "",
      },
      {
        name: "priority",
        type: "number",
        required: false,
        description: "",
      },
      {
        name: "ingressTag",
        type: "string",
        required: false,
        description: "Ingress tag value for X-ASD-Ingress header",
      },
      {
        name: "dial",
        type: "string",
        required: false,
        description:
          "Upstream dial address. When set, health check uses reverse_proxy instead of static_response",
      },
      {
        name: "projectId",
        type: "string",
        required: false,
        description: "Project identifier for X-ASD-Project header",
      },
    ],
    returnType: "CaddyRoute",
    snippet: {
      prefix: "caddy-health-check-route",
      body: [
        "buildHealthCheckRoute({",
        '  host: "${1:example.com}",',
        '  serviceId: "${2:my-id}",',
        "  // optional: priority, ingressTag, dial, projectId",
        "})$0",
      ],
      description: "Build Health Check Route",
    },
  },
  buildHostRoute: {
    name: "buildHostRoute",
    description: "Build a host-based route",
    params: [
      {
        name: "host",
        type: "string",
        required: true,
        description: "",
      },
      {
        name: "dial",
        type: "string",
        required: true,
        description: "",
      },
      {
        name: "securityHeaders",
        type: "SecurityHeaders",
        required: false,
        description: "",
      },
      {
        name: "basicAuth",
        type: "BasicAuthOptions",
        required: false,
        description: "",
      },
      {
        name: "priority",
        type: "number",
        required: false,
        description: "",
      },
      {
        name: "ingressTag",
        type: "string",
        required: false,
        description: "Ingress tag value for X-ASD-Ingress header",
      },
      {
        name: "iframeOrigin",
        type: "string",
        required: false,
        description: "Origin for iframe embedding headers",
      },
      {
        name: "deleteResponseHeaders",
        type: "string[]",
        required: false,
        description: "Response headers to delete from reverse proxy",
      },
      {
        name: "serviceId",
        type: "string",
        required: false,
        description: "Service ID for X-ASD-Service-ID header",
      },
      {
        name: "serviceType",
        type: "string",
        required: false,
        description: "Service type for X-ASD-Service-Type header",
      },
      {
        name: "flushInterval",
        type: "number",
        required: false,
        description: "Flush interval for reverse proxy streaming (-1 disables buffering)",
      },
      {
        name: "projectId",
        type: "string",
        required: false,
        description: "Project identifier for X-ASD-Project header",
      },
    ],
    returnType: "CaddyRoute",
    snippet: {
      prefix: "caddy-host-route",
      body: [
        "buildHostRoute({",
        '  host: "${1:example.com}",',
        '  dial: "${2:localhost:3000}",',
        "  // optional: securityHeaders, basicAuth, priority, ingressTag, iframeOrigin, deleteResponseHeaders, ...",
        "})$0",
      ],
      description: "Build Host Route",
    },
  },
  buildPathRoute: {
    name: "buildPathRoute",
    description: "Build a path-based route",
    params: [
      {
        name: "path",
        type: "string",
        required: true,
        description: "",
      },
      {
        name: "host",
        type: "string",
        required: true,
        description: "",
      },
      {
        name: "dial",
        type: "string",
        required: true,
        description: "",
      },
      {
        name: "stripPrefix",
        type: "boolean",
        required: false,
        description: "",
      },
      {
        name: "securityHeaders",
        type: "SecurityHeaders",
        required: false,
        description: "",
      },
      {
        name: "basicAuth",
        type: "BasicAuthOptions",
        required: false,
        description: "",
      },
      {
        name: "priority",
        type: "number",
        required: false,
        description: "",
      },
      {
        name: "ingressTag",
        type: "string",
        required: false,
        description: "Ingress tag value for X-ASD-Ingress header",
      },
      {
        name: "iframeOrigin",
        type: "string",
        required: false,
        description: "Origin for iframe embedding headers",
      },
      {
        name: "deleteResponseHeaders",
        type: "string[]",
        required: false,
        description: "Response headers to delete from reverse proxy",
      },
      {
        name: "serviceId",
        type: "string",
        required: false,
        description: "Service ID for X-ASD-Service-ID header",
      },
      {
        name: "serviceType",
        type: "string",
        required: false,
        description: "Service type for X-ASD-Service-Type header",
      },
      {
        name: "flushInterval",
        type: "number",
        required: false,
        description: "Flush interval for reverse proxy streaming (-1 disables buffering)",
      },
      {
        name: "projectId",
        type: "string",
        required: false,
        description: "Project identifier for X-ASD-Project header",
      },
    ],
    returnType: "CaddyRoute",
    snippet: {
      prefix: "caddy-path-route",
      body: [
        "buildPathRoute({",
        '  path: "${1:/api/*}",',
        '  host: "${2:example.com}",',
        '  dial: "${3:localhost:3000}",',
        "  // optional: stripPrefix, securityHeaders, basicAuth, priority, ingressTag, iframeOrigin, ...",
        "})$0",
      ],
      description: "Build Path Route",
    },
  },
  buildLoadBalancerRoute: {
    name: "buildLoadBalancerRoute",
    description: "Build a load balancer route",
    params: [
      {
        name: "host",
        type: "string",
        required: true,
        description: "",
      },
      {
        name: "upstreams",
        type: "string[]",
        required: true,
        description: "",
      },
      {
        name: "healthCheckPath",
        type: "string",
        required: false,
        description: "",
      },
      {
        name: "healthCheckInterval",
        type: "string",
        required: false,
        description: "",
      },
      {
        name: "policy",
        type: '"first" | "random" | "least_conn" | "round_robin"',
        required: false,
        description: "",
      },
      {
        name: "priority",
        type: "number",
        required: false,
        description: "",
      },
    ],
    returnType: "CaddyRoute",
    snippet: {
      prefix: "caddy-load-balancer-route",
      body: [
        "buildLoadBalancerRoute({",
        '  host: "${1:example.com}",',
        '  upstreams: ["${2:localhost:3000}"],',
        "  // optional: healthCheckPath, healthCheckInterval, policy, priority",
        "})$0",
      ],
      description: "Build Load Balancer Route",
    },
  },
  buildReverseProxyHandler: {
    name: "buildReverseProxyHandler",
    description: "Build a reverse proxy handler",
    params: [
      {
        name: "dial",
        type: "string",
        required: true,
        description: "Dial address (host:port or https://host:port)",
      },
      {
        name: "options",
        type: "{ tls?: boolean | undefined; tlsServerName?: string | undefined; tlsInsecureSkipVerify?: boolean | undefined; tlsTrustedCACerts?: string | undefined; deleteResponseHeaders?: string[] | undefined; flushInterval?: number | undefined; } | undefined",
        required: false,
        description: "Optional transport configuration",
      },
    ],
    returnType: "CaddyRouteHandler",
    example: '// HTTP backend (default)\nbuildReverseProxyHandler("nginx:80")',
    snippet: {
      prefix: "caddy-reverse-proxy-handler",
      body: ['buildReverseProxyHandler("${1:localhost:3000}")$0'],
      description: "Build Reverse Proxy Handler",
    },
  },
  buildSecurityHeadersHandler: {
    name: "buildSecurityHeadersHandler",
    description: "Build a security headers handler",
    params: [
      {
        name: "enableHsts",
        type: "boolean",
        required: false,
        description: "Enable HSTS (HTTP Strict Transport Security)",
        default: "false",
      },
      {
        name: "hstsMaxAge",
        type: "number",
        required: false,
        description: "HSTS max-age in seconds",
        default: "31536000 (1 year)",
      },
      {
        name: "frameOptions",
        type: "FrameOptions",
        required: false,
        description: "X-Frame-Options header value",
        default: "DENY",
      },
      {
        name: "enableCompression",
        type: "boolean",
        required: false,
        description: "Enable gzip/brotli compression",
        default: "true",
      },
    ],
    returnType: "CaddyRouteHandler",
    snippet: {
      prefix: "caddy-security-headers-handler",
      body: [
        "buildSecurityHeadersHandler({",
        "  enableHsts: ${1|false,true|},",
        "  hstsMaxAge: ${2:1},",
        '  frameOptions: "${3|DENY,SAMEORIGIN|}",',
        "  // optional: enableCompression",
        "})$0",
      ],
      description: "Build Security Headers Handler",
    },
  },
  buildBasicAuthHandler: {
    name: "buildBasicAuthHandler",
    description:
      "Build a basic auth handler\nSupports both single account (legacy) and multiple accounts",
    params: [
      {
        name: "enabled",
        type: "boolean",
        required: true,
        description: "",
      },
      {
        name: "username",
        type: "string",
        required: false,
        description: "Single username (legacy - use accounts instead)",
      },
      {
        name: "passwordHash",
        type: "string",
        required: false,
        description: "Single password hash (legacy - use accounts instead)",
      },
      {
        name: "accounts",
        type: "BasicAuthAccount[]",
        required: false,
        description: "Multiple accounts (recommended)",
      },
      {
        name: "realm",
        type: "string",
        required: false,
        description: "Authentication realm",
      },
      {
        name: "hash",
        type: '{ algorithm?: "bcrypt" | undefined; cost?: number | undefined; }',
        required: false,
        description: "Hash algorithm (default: bcrypt)",
      },
      {
        name: "routes",
        type: '("path" | "host" | "tunnel")[]',
        required: false,
        description: "Which route types should have auth applied (default: all)",
      },
    ],
    returnType: "CaddyRouteHandler",
    example:
      '// Single account (legacy)\nbuildBasicAuthHandler({\n  enabled: true,\n  username: "admin",\n  passwordHash: "$2a$10$...",\n  realm: "Admin Area"\n})',
    snippet: {
      prefix: "caddy-basic-auth-handler",
      body: [
        "buildBasicAuthHandler({",
        "  enabled: ${1|true,false|},",
        "  // optional: username, passwordHash, accounts, realm, hash, routes",
        "})$0",
      ],
      description: "Build Basic Auth Handler",
    },
  },
  buildRewriteHandler: {
    name: "buildRewriteHandler",
    description: "Build a rewrite handler (strip path prefix)",
    params: [
      {
        name: "prefix",
        type: "string",
        required: true,
        description: "Path prefix to strip",
      },
    ],
    returnType: "CaddyRouteHandler",
    snippet: {
      prefix: "caddy-rewrite-handler",
      body: ['buildRewriteHandler("${1:/api}")$0'],
      description: "Build Rewrite Handler",
    },
  },
  buildIngressTagHeadersHandler: {
    name: "buildIngressTagHeadersHandler",
    description: "Build an ingress tag header handler",
    params: [
      {
        name: "tag",
        type: "string",
        required: true,
        description: "Ingress tag value",
      },
    ],
    returnType: "CaddyRouteHandler",
    snippet: {
      prefix: "caddy-ingress-tag-headers-handler",
      body: ['buildIngressTagHeadersHandler("${1:production}")$0'],
      description: "Build Ingress Tag Headers Handler",
    },
  },
  buildProjectIdHeadersHandler: {
    name: "buildProjectIdHeadersHandler",
    description: "Build a project identity header handler",
    params: [
      {
        name: "projectId",
        type: "string",
        required: true,
        description: "Project identifier value",
      },
    ],
    returnType: "CaddyRouteHandler",
    snippet: {
      prefix: "caddy-project-id-headers-handler",
      body: ['buildProjectIdHeadersHandler("${1:my-project}")$0'],
      description: "Build Project Id Headers Handler",
    },
  },
  buildIframeHeadersHandler: {
    name: "buildIframeHeadersHandler",
    description:
      "Build CORS/CSP headers for iframe embedding\n\n`allowedOrigin` is a CSP `frame-ancestors` source list: one source or\nseveral, space-separated, wildcards allowed. CORS headers are added only\nwhen it is `*` or one exact origin, because `Access-Control-Allow-Origin`\ntakes nothing else; a list there is invalid, and a browser rejects it.",
    params: [
      {
        name: "allowedOrigin",
        type: "string",
        required: false,
        description: 'Allowed origin or frame-ancestors source list (optional, defaults to "*")',
      },
    ],
    returnType: "CaddyRouteHandler",
    snippet: {
      prefix: "caddy-iframe-headers-handler",
      body: ['buildIframeHeadersHandler("${1:*}")$0'],
      description: "Build Iframe Headers Handler",
    },
  },
  buildRedirectRoute: {
    name: "buildRedirectRoute",
    description: "Build a redirect route for domain redirects (www <-> non-www)",
    params: [
      {
        name: "fromHost",
        type: "string",
        required: true,
        description: "",
      },
      {
        name: "toHost",
        type: "string",
        required: true,
        description: "",
      },
      {
        name: "permanent",
        type: "boolean",
        required: false,
        description: "",
      },
      {
        name: "statusCode",
        type: "301 | 302 | 307 | 308",
        required: false,
        description: "",
      },
      {
        name: "id",
        type: "string",
        required: false,
        description: "",
      },
    ],
    returnType: "CaddyRoute",
    snippet: {
      prefix: "caddy-redirect-route",
      body: [
        "buildRedirectRoute({",
        '  fromHost: "${1:example.com}",',
        '  toHost: "${2:example.com}",',
        "  // optional: permanent, statusCode, id",
        "})$0",
      ],
      description: "Build Redirect Route",
    },
  },
  buildCompressionHandler: {
    name: "buildCompressionHandler",
    description:
      "Build a compression (encode) handler\nSupports gzip, zstd, and brotli compression",
    params: [
      {
        name: "gzip",
        type: "boolean",
        required: false,
        description: "",
      },
      {
        name: "zstd",
        type: "boolean",
        required: false,
        description: "",
      },
      {
        name: "brotli",
        type: "boolean",
        required: false,
        description: "",
      },
    ],
    returnType: "CaddyRouteHandler",
    snippet: {
      prefix: "caddy-compression-handler",
      body: [
        "buildCompressionHandler({",
        "  gzip: ${1|true,false|},",
        "  zstd: ${2|true,false|},",
        "  brotli: ${3|true,false|},",
        "})$0",
      ],
      description: "Build Compression Handler",
    },
  },
  buildWwwRedirect: {
    name: "buildWwwRedirect",
    description:
      'Build a WWW redirect route (www.example.com ↔ example.com)\n\nCommon patterns:\n- "www-to-domain": www.example.com → example.com\n- "domain-to-www": example.com → www.example.com',
    params: [
      {
        name: "domain",
        type: "string",
        required: true,
        description: "",
      },
      {
        name: "mode",
        type: '"www-to-domain" | "domain-to-www"',
        required: true,
        description: "",
      },
      {
        name: "permanent",
        type: "boolean",
        required: false,
        description: "",
      },
      {
        name: "priority",
        type: "number",
        required: false,
        description: "",
      },
    ],
    returnType: "CaddyRoute",
    example:
      '// Redirect www.example.com → example.com\nconst route = buildWwwRedirect({\n  domain: "example.com",\n  mode: "www-to-domain",\n  permanent: true\n});',
    snippet: {
      prefix: "caddy-www-redirect",
      body: [
        "buildWwwRedirect({",
        '  domain: "${1:example.com}",',
        '  mode: "${2|www-to-domain,domain-to-www|}",',
        "  // optional: permanent, priority",
        "})$0",
      ],
      description: "Build Www Redirect",
    },
  },
  buildMitmproxyRoute: {
    name: "buildMitmproxyRoute",
    description:
      "Build a route that forwards traffic through MITMproxy for inspection\n\nThis is a convenience function that creates a route pointing to a MITMproxy\ninstance running in reverse proxy mode. Use this to transparently intercept\nand inspect HTTP traffic for debugging without modifying client or backend code.",
    params: [
      {
        name: "host",
        type: "string",
        required: true,
        description: 'Host pattern to match (e.g., "api.example.com")',
      },
      {
        name: "mitmproxyHost",
        type: "string",
        required: true,
        description: 'MITMproxy host (e.g., "localhost" or "mitmproxy-container")',
      },
      {
        name: "mitmproxyPort",
        type: "number",
        required: false,
        description: "MITMproxy proxy port (default: 8080)",
      },
      {
        name: "backendHost",
        type: "string",
        required: false,
        description: "Backend host that MITMproxy should forward to (optional, for documentation)",
      },
      {
        name: "backendPort",
        type: "number",
        required: false,
        description: "Backend port that MITMproxy should forward to (optional, for documentation)",
      },
      {
        name: "id",
        type: "string",
        required: false,
        description: "Route ID for Caddy (optional)",
      },
      {
        name: "priority",
        type: "number",
        required: false,
        description: "Route priority (optional)",
      },
    ],
    returnType: "CaddyRoute",
    example:
      '// Route traffic for api.example.com through MITMproxy\nconst route = buildMitmproxyRoute({\n  host: "api.example.com",\n  mitmproxyHost: "localhost",\n  mitmproxyPort: 8080,\n});\nawait client.addRoute("https_server", route, "api_debug");',
    snippet: {
      prefix: "caddy-mitmproxy-route",
      body: [
        "buildMitmproxyRoute({",
        '  host: "${1:example.com}",',
        '  mitmproxyHost: "${2:example.com}",',
        "  // optional: mitmproxyPort, backendHost, backendPort, id, priority",
        "})$0",
      ],
      description: "Build Mitmproxy Route",
    },
  },
  buildMitmproxyRoutePair: {
    name: "buildMitmproxyRoutePair",
    description:
      "Create a hot-swappable route pair for enabling/disabling MITMproxy interception\n\nReturns both a direct route and a MITMproxy-intercepted route with the same ID.\nUse this to easily toggle between direct and intercepted traffic at runtime.",
    params: [
      {
        name: "host",
        type: "string",
        required: true,
        description: "Host pattern to match",
      },
      {
        name: "backendHost",
        type: "string",
        required: true,
        description: "Backend service host",
      },
      {
        name: "backendPort",
        type: "number",
        required: true,
        description: "Backend service port",
      },
      {
        name: "mitmproxyHost",
        type: "string",
        required: true,
        description: "MITMproxy host",
      },
      {
        name: "mitmproxyPort",
        type: "number",
        required: false,
        description: "MITMproxy proxy port (default: 8080)",
      },
      {
        name: "routeId",
        type: "string",
        required: true,
        description: "Route ID (used for both routes)",
      },
      {
        name: "priority",
        type: "number",
        required: false,
        description: "Route priority (optional)",
      },
    ],
    returnType:
      "{\n  /** Direct route (Client → Caddy → Backend) */\n  direct: CaddyRoute;\n  /** Proxied route (Client → Caddy → MITMproxy → Backend) */\n  proxied: CaddyRoute;\n}",
    example:
      'const routes = buildMitmproxyRoutePair({\n  host: "api.example.com",\n  backendHost: "backend-service",\n  backendPort: 3000,\n  mitmproxyHost: "mitmproxy",\n  routeId: "api_route",\n});\n\n// Start with direct routing\nawait client.addRoute("https_server", routes.direct, routes.direct["@id"]);\n\n// Hot-swap to enable interception (no downtime)\nawait client.removeRouteById("https_server", routes.direct["@id"]);\nawait client.addRoute("https_server", routes.proxied, routes.proxied["@id"]);\n\n// Hot-swap back to direct (disable interception)\nawait client.removeRouteById("https_server", routes.proxied["@id"]);\nawait client.addRoute("https_server", routes.direct, routes.direct["@id"]);',
    snippet: {
      prefix: "caddy-mitmproxy-route-pair",
      body: [
        "buildMitmproxyRoutePair({",
        '  host: "${1:example.com}",',
        '  backendHost: "${2:example.com}",',
        "  backendPort: ${3:3000},",
        '  mitmproxyHost: "${4:example.com}",',
        '  routeId: "${5:my-id}",',
        "  // optional: mitmproxyPort, priority",
        "})$0",
      ],
      description: "Build Mitmproxy Route Pair",
    },
  },
  buildIframeProxyRoute: {
    name: "buildIframeProxyRoute",
    description:
      "Build a route for proxying a web UI with iframe embedding support\n\nThis creates a route that proxies a web interface and optionally adds\nheaders to allow embedding in iframes. Can also override Host/Origin\nheaders for services with DNS rebinding protection.",
    params: [
      {
        name: "pathPrefix",
        type: "string",
        required: true,
        description: 'Path prefix for the route (e.g., "/panel")',
      },
      {
        name: "upstreamHost",
        type: "string",
        required: true,
        description: "Upstream host to proxy to",
      },
      {
        name: "upstreamPort",
        type: "number",
        required: true,
        description: "Upstream port to proxy to",
      },
      {
        name: "routeId",
        type: "string",
        required: false,
        description: "Route ID (optional, auto-generated from pathPrefix if not provided)",
      },
      {
        name: "iframeEmbed",
        type: "boolean",
        required: false,
        description: "Whether to enable iframe embedding headers (default: true)",
      },
      {
        name: "overrideHost",
        type: "string",
        required: false,
        description: "Custom Host header to send to upstream (for DNS rebinding bypass)",
      },
    ],
    returnType: "CaddyRoute",
    example:
      '// Proxy a web panel at /panel/* to panel-service:8080\nconst route = buildIframeProxyRoute({\n  pathPrefix: "/panel",\n  upstreamHost: "panel-service",\n  upstreamPort: 8080,\n  iframeEmbed: true,\n});\n\n// Proxy with DNS rebinding bypass (e.g., for mitmweb)\nconst mitmRoute = buildIframeProxyRoute({\n  pathPrefix: "/mitmproxy",\n  upstreamHost: "mitmproxy",\n  upstreamPort: 8081,\n  overrideHost: "127.0.0.1:8081",\n});',
    snippet: {
      prefix: "caddy-iframe-proxy-route",
      body: [
        "buildIframeProxyRoute({",
        '  pathPrefix: "${1:/app}",',
        '  upstreamHost: "${2:localhost}",',
        "  upstreamPort: ${3:3000},",
        "  // optional: routeId, iframeEmbed, overrideHost",
        "})$0",
      ],
      description: "Build Iframe Proxy Route",
    },
  },
  buildMitmproxyWebUiRoute: {
    name: "buildMitmproxyWebUiRoute",
    description: "",
    params: [
      {
        name: "pathPrefix",
        type: "string",
        required: true,
        description: "",
      },
      {
        name: "mitmproxyHost",
        type: "string",
        required: true,
        description: "",
      },
      {
        name: "mitmproxyWebPort",
        type: "number",
        required: false,
        description: "",
      },
      {
        name: "routeId",
        type: "string",
        required: false,
        description: "",
      },
      {
        name: "iframeEmbed",
        type: "boolean",
        required: false,
        description: "",
      },
    ],
    returnType: "CaddyRoute",
    snippet: {
      prefix: "caddy-mitmproxy-web-ui-route",
      body: [
        "buildMitmproxyWebUiRoute({",
        '  pathPrefix: "${1:/app}",',
        '  mitmproxyHost: "${2:example.com}",',
        "  // optional: mitmproxyWebPort, routeId, iframeEmbed",
        "})$0",
      ],
      description: "Build Mitmproxy Web Ui Route",
    },
  },
  buildWebSocketProxyRoute: {
    name: "buildWebSocketProxyRoute",
    description:
      "Build a route for WebSocket proxy\n\nThis creates a route that proxies WebSocket connections to an upstream\nservice. Can optionally override Host/Origin headers for services\nwith DNS rebinding protection.",
    params: [
      {
        name: "path",
        type: "string",
        required: true,
        description: 'WebSocket path to match (e.g., "/ws", "/updates")',
      },
      {
        name: "upstreamHost",
        type: "string",
        required: true,
        description: "Upstream host to proxy to",
      },
      {
        name: "upstreamPort",
        type: "number",
        required: true,
        description: "Upstream port to proxy to",
      },
      {
        name: "routeId",
        type: "string",
        required: false,
        description: "Route ID (optional)",
      },
      {
        name: "overrideHost",
        type: "string",
        required: false,
        description: "Custom Host header to send to upstream (for DNS rebinding bypass)",
      },
    ],
    returnType: "CaddyRoute",
    example:
      '// Simple WebSocket proxy\nconst route = buildWebSocketProxyRoute({\n  path: "/ws",\n  upstreamHost: "ws-server",\n  upstreamPort: 8080,\n});\n\n// WebSocket with DNS rebinding bypass\nconst mitmRoute = buildWebSocketProxyRoute({\n  path: "/updates",\n  upstreamHost: "mitmproxy",\n  upstreamPort: 8081,\n  overrideHost: "127.0.0.1:8081",\n});',
    snippet: {
      prefix: "caddy-web-socket-proxy-route",
      body: [
        "buildWebSocketProxyRoute({",
        '  path: "${1:/api/*}",',
        '  upstreamHost: "${2:localhost}",',
        "  upstreamPort: ${3:3000},",
        "  // optional: routeId, overrideHost",
        "})$0",
      ],
      description: "Build Web Socket Proxy Route",
    },
  },
  buildMitmproxyWebSocketRoute: {
    name: "buildMitmproxyWebSocketRoute",
    description: "",
    params: [
      {
        name: "path",
        type: "string",
        required: false,
        description: "",
      },
      {
        name: "mitmproxyHost",
        type: "string",
        required: true,
        description: "",
      },
      {
        name: "mitmproxyWebPort",
        type: "number",
        required: false,
        description: "",
      },
      {
        name: "routeId",
        type: "string",
        required: false,
        description: "",
      },
    ],
    returnType: "CaddyRoute",
    snippet: {
      prefix: "caddy-mitmproxy-web-socket-route",
      body: [
        "buildMitmproxyWebSocketRoute({",
        '  mitmproxyHost: "${1:example.com}",',
        "  // optional: path, mitmproxyWebPort, routeId",
        "})$0",
      ],
      description: "Build Mitmproxy Web Socket Route",
    },
  },
  buildIframePermissiveHandler: {
    name: "buildIframePermissiveHandler",
    description:
      "Build a header handler that removes restrictive headers for iframe embedding\n\nRemoves X-Frame-Options, Content-Security-Policy, and X-Xss-Protection\nheaders while adding permissive CORS and frame-ancestors headers.",
    params: [
      {
        name: "deleteHeaders",
        type: "string[]",
        required: false,
        description:
          'Headers to delete (default: ["X-Frame-Options", "Content-Security-Policy", "X-Xss-Protection"])',
      },
      {
        name: "corsOrigin",
        type: "string",
        required: false,
        description: 'CORS origin (default: "*")',
      },
    ],
    returnType: "CaddyRouteHandler",
    example: "const handler = buildIframePermissiveHandler();\n// Use in a route's handle array",
    snippet: {
      prefix: "caddy-iframe-permissive-handler",
      body: [
        "buildIframePermissiveHandler({",
        '  deleteHeaders: ["${1:deleteHeader}"],',
        '  corsOrigin: "${2:corsOrigin}",',
        "})$0",
      ],
      description: "Build Iframe Permissive Handler",
    },
  },
  buildDnsRebindingBypassHandler: {
    name: "buildDnsRebindingBypassHandler",
    description:
      "Build a header handler for DNS rebinding bypass\n\nSets Host and Origin headers to bypass MITMproxy's DNS rebinding protection.\nUse this when proxying to MITMproxy from a different hostname.",
    params: [
      {
        name: "targetHost",
        type: "string",
        required: true,
        description: 'Target host:port (e.g., "127.0.0.1:8081")',
      },
    ],
    returnType: "CaddyRouteHandler",
    example:
      'const handler = buildDnsRebindingBypassHandler({\n  targetHost: "127.0.0.1:8081",\n});',
    snippet: {
      prefix: "caddy-dns-rebinding-bypass-handler",
      body: ["buildDnsRebindingBypassHandler({", '  targetHost: "${1:example.com}",', "})$0"],
      description: "Build Dns Rebinding Bypass Handler",
    },
  },
  buildFileServerRoute: {
    name: "buildFileServerRoute",
    description: "Build a file server route for serving static files",
    params: [
      {
        name: "path",
        type: "string",
        required: true,
        description: 'Path prefix to match (e.g., "/static/*")',
      },
      {
        name: "root",
        type: "string",
        required: true,
        description: "Root directory to serve files from",
      },
      {
        name: "browse",
        type: "boolean",
        required: false,
        description: "Enable directory browsing",
      },
      {
        name: "browseTemplate",
        type: "string",
        required: false,
        description: "Custom browse template file path",
      },
      {
        name: "hidePatterns",
        type: "string[]",
        required: false,
        description: 'File patterns to hide (e.g., [".git", ".env"])',
      },
      {
        name: "indexNames",
        type: "string[]",
        required: false,
        description: 'Index file names (default: ["index.html"])',
      },
      {
        name: "precompressed",
        type: "boolean",
        required: false,
        description: "Enable precompressed file support (gzip, brotli)",
      },
      {
        name: "id",
        type: "string",
        required: false,
        description: "Route ID",
      },
      {
        name: "priority",
        type: "number",
        required: false,
        description: "Route priority",
      },
    ],
    returnType: "CaddyRoute",
    example:
      '// Basic static file serving\nconst route = buildFileServerRoute({\n  path: "/static/*",\n  root: "/var/www/static",\n});\n\n// With directory browsing and hidden files\nconst route = buildFileServerRoute({\n  path: "/files/*",\n  root: "/var/www/files",\n  browse: true,\n  hidePatterns: [".git", ".env", "*.secret"],\n  precompressed: true,\n});',
    snippet: {
      prefix: "caddy-file-server-route",
      body: [
        "buildFileServerRoute({",
        '  path: "${1:/api/*}",',
        '  root: "${2:/var/www/html}",',
        "  // optional: browse, browseTemplate, hidePatterns, indexNames, precompressed, id, ...",
        "})$0",
      ],
      description: "Build File Server Route",
    },
  },
  buildTemplatesRoute: {
    name: "buildTemplatesRoute",
    description: "Build a templates route for server-side template rendering",
    params: [
      {
        name: "path",
        type: "string",
        required: true,
        description: 'Path prefix to match (e.g., "/*.html")',
      },
      {
        name: "fileRoot",
        type: "string",
        required: true,
        description: "Root directory for template files",
      },
      {
        name: "mimeTypes",
        type: "string[]",
        required: false,
        description: "MIME types to process as templates",
      },
      {
        name: "delimiters",
        type: "[string, string]",
        required: false,
        description: 'Custom delimiters (default: ["{{", "}}"])',
      },
      {
        name: "id",
        type: "string",
        required: false,
        description: "Route ID",
      },
      {
        name: "priority",
        type: "number",
        required: false,
        description: "Route priority",
      },
    ],
    returnType: "CaddyRoute",
    example:
      '// Process HTML files as templates\nconst route = buildTemplatesRoute({\n  path: "/*.html",\n  fileRoot: "/var/www/templates",\n  mimeTypes: ["text/html"],\n});\n\n// With custom delimiters\nconst route = buildTemplatesRoute({\n  path: "/*.tmpl",\n  fileRoot: "/templates",\n  delimiters: ["<%", "%>"],\n});',
    snippet: {
      prefix: "caddy-templates-route",
      body: [
        "buildTemplatesRoute({",
        '  path: "${1:/api/*}",',
        '  fileRoot: "${2:/var/www/html}",',
        "  // optional: mimeTypes, delimiters, id, priority",
        "})$0",
      ],
      description: "Build Templates Route",
    },
  },
  buildErrorRoute: {
    name: "buildErrorRoute",
    description: "Build an error route that returns a static error response",
    params: [
      {
        name: "match",
        type: "{ path?: string[]; host?: string[] }",
        required: false,
        description: "Route matchers (optional, applies to all requests if not specified)",
      },
      {
        name: "statusCode",
        type: "number",
        required: true,
        description: "HTTP status code",
      },
      {
        name: "message",
        type: "string",
        required: false,
        description: "Error message body",
      },
      {
        name: "headers",
        type: "Record<string, string[]>",
        required: false,
        description: "Custom headers to include",
      },
      {
        name: "id",
        type: "string",
        required: false,
        description: "Route ID",
      },
      {
        name: "priority",
        type: "number",
        required: false,
        description: "Route priority",
      },
    ],
    returnType: "CaddyRoute",
    example:
      '// Simple 404 handler\nconst route = buildErrorRoute({\n  statusCode: 404,\n  message: "Page not found",\n});\n\n// JSON error response for API\nconst route = buildErrorRoute({\n  match: { path: ["/api/*"] },\n  statusCode: 500,\n  message: \'{"error":"Internal server error"}\',\n  headers: { "Content-Type": ["application/json"] },\n});',
    snippet: {
      prefix: "caddy-error-route",
      body: [
        "buildErrorRoute({",
        "  statusCode: ${1:404},",
        "  // optional: match, message, headers, id, priority",
        "})$0",
      ],
      description: "Build Error Route",
    },
  },
  buildRequestBodyHandler: {
    name: "buildRequestBodyHandler",
    description: "Build a request body handler for limiting request body size",
    params: [
      {
        name: "maxSize",
        type: "number",
        required: true,
        description: "Maximum request body size in bytes",
      },
    ],
    returnType: "CaddyRouteHandler",
    example:
      "// Limit request body to 10MB\nconst handler = buildRequestBodyHandler({ maxSize: 10 * 1024 * 1024 });",
    snippet: {
      prefix: "caddy-request-body-handler",
      body: ["buildRequestBodyHandler({", "  maxSize: ${1:10485760},", "})$0"],
      description: "Build Request Body Handler",
    },
  },
  buildVarsHandler: {
    name: "buildVarsHandler",
    description: "Build a vars handler for setting request variables",
    params: [
      {
        name: "vars",
        type: "Record<string, string>",
        required: true,
        description: "Variables to set (key-value pairs)",
      },
    ],
    returnType: "CaddyRouteHandler",
    example:
      '// Set custom variables for downstream handlers\nconst handler = buildVarsHandler({\n  vars: {\n    root: "/var/www",\n    backend: "api-server",\n    environment: "production",\n  }\n});',
    snippet: {
      prefix: "caddy-vars-handler",
      body: ["buildVarsHandler({", "  vars: {},", "})$0"],
      description: "Build Vars Handler",
    },
  },
  buildTracingHandler: {
    name: "buildTracingHandler",
    description: "Build a tracing handler for distributed tracing",
    params: [
      {
        name: "span",
        type: "string",
        required: false,
        description: "Span name for tracing",
      },
    ],
    returnType: "CaddyRouteHandler",
    example: 'const handler = buildTracingHandler({ span: "http.request" });',
    snippet: {
      prefix: "caddy-tracing-handler",
      body: ["buildTracingHandler({", '  span: "${1:span}",', "})$0"],
      description: "Build Tracing Handler",
    },
  },
  buildMapHandler: {
    name: "buildMapHandler",
    description: "Build a map handler for variable mapping",
    params: [
      {
        name: "source",
        type: "string",
        required: true,
        description: 'Source placeholder (e.g., "{http.request.uri.path}")',
      },
      {
        name: "destinations",
        type: "string[]",
        required: true,
        description: 'Destination placeholder names (e.g., ["{my_var}"])',
      },
      {
        name: "mappings",
        type: "{ input: string; outputs: string[] }[]",
        required: true,
        description: "Mappings from input patterns to outputs",
      },
      {
        name: "defaults",
        type: "string[]",
        required: false,
        description: "Default outputs if no mappings match",
      },
    ],
    returnType: "CaddyRouteHandler",
    example:
      '// Map request paths to backend names\nconst handler = buildMapHandler({\n  source: "{http.request.uri.path}",\n  destinations: ["{backend}"],\n  mappings: [\n    { input: "/api/*", outputs: ["api-server"] },\n    { input: "/admin/*", outputs: ["admin-server"] },\n  ],\n  defaults: ["default-server"],\n});',
    snippet: {
      prefix: "caddy-map-handler",
      body: [
        "buildMapHandler({",
        '  source: "${1:{http.request.host\\}}",',
        '  destinations: ["${2:destination}"],',
        '  mappings: [{ input: "${3:input}", outputs: ["${4:output}"] }],',
        "  // optional: defaults",
        "})$0",
      ],
      description: "Build Map Handler",
    },
  },
  buildLayer4ProxyHandler: {
    name: "buildLayer4ProxyHandler",
    description: "A `proxy` handler for one or more upstreams.",
    params: [
      {
        name: "upstreams",
        type: "string | string[]",
        required: true,
        description: "`host:port`, or a list of them (one upstream each)",
      },
      {
        name: "options",
        type: "Layer4ProxyHandlerOptions",
        required: false,
        description: "load balancing, health checks, upstream TLS, PROXY protocol",
      },
    ],
    returnType: "Layer4ProxyHandler",
    example: 'buildLayer4ProxyHandler("postgres:5432")',
    snippet: {
      prefix: "caddy-layer4-proxy-handler",
      body: ['buildLayer4ProxyHandler("${1:localhost:3000}")$0'],
      description: "Build Layer4 Proxy Handler",
    },
  },
  buildLayer4TlsHandler: {
    name: "buildLayer4TlsHandler",
    description: "A `tls` handler: terminates TLS, so the handlers after it see plaintext.",
    params: [
      {
        name: "connectionPolicies",
        type: "Layer4TlsConnectionPolicy[]",
        required: false,
        description:
          "TLS connection policies; none means Caddy's defaults (certificates from the TLS app).",
      },
      {
        name: "handshakeTimeout",
        type: "Duration",
        required: false,
        description: "Fail the handshake after this long. Default: 60s.",
      },
    ],
    returnType: "Layer4TlsHandler",
    example: "buildLayer4TlsHandler()",
    snippet: {
      prefix: "caddy-layer4-tls-handler",
      body: [
        "buildLayer4TlsHandler({",
        "  connectionPolicies: [{}],",
        '  handshakeTimeout: "${1:handshakeTimeout}",',
        "})$0",
      ],
      description: "Build Layer4 Tls Handler",
    },
  },
  buildLayer4SubrouteHandler: {
    name: "buildLayer4SubrouteHandler",
    description:
      "A `subroute` handler: a nested list of routes, e.g. after `tls` terminated\nTLS, route the decrypted stream by its protocol.",
    params: [
      {
        name: "routes",
        type: "Layer4Route[]",
        required: true,
        description: "Routes tried in order; the first that matches handles the connection.",
      },
      {
        name: "matchingTimeout",
        type: "Duration",
        required: false,
        description: "How long the subroute's matchers may wait for data. Default: 3s.",
      },
    ],
    returnType: "Layer4SubrouteHandler",
    example:
      'buildLayer4SubrouteHandler({ routes: [buildLayer4ProxyRoute({ upstream: "localhost:8080", match: "http" })] })',
    snippet: {
      prefix: "caddy-layer4-subroute-handler",
      body: [
        "buildLayer4SubrouteHandler({",
        '  routes: [{ handle: [{ handler: "subroute" }] }],',
        "  // optional: matchingTimeout",
        "})$0",
      ],
      description: "Build Layer4 Subroute Handler",
    },
  },
  buildLayer4ThrottleHandler: {
    name: "buildLayer4ThrottleHandler",
    description:
      "A `throttle` handler: limit how fast a connection is read, or add latency\n(to test how a client copes with a slow link).",
    params: [
      {
        name: "readBytesPerSecond",
        type: "number",
        required: false,
        description: "Read limit per connection, in bytes per second.",
      },
      {
        name: "readBurstSize",
        type: "number",
        required: false,
        description: "Burst size per connection, in bytes. Default: same as the limit.",
      },
      {
        name: "totalReadBytesPerSecond",
        type: "number",
        required: false,
        description: "Read limit across all connections, in bytes per second.",
      },
      {
        name: "totalReadBurstSize",
        type: "number",
        required: false,
        description: "Burst size across all connections, in bytes.",
      },
      {
        name: "latency",
        type: "Duration",
        required: false,
        description: "Delay added to every read.",
        example: "100ms",
      },
    ],
    returnType: "Layer4ThrottleHandler",
    example: "buildLayer4ThrottleHandler({ readBytesPerSecond: 1048576 })",
    snippet: {
      prefix: "caddy-layer4-throttle-handler",
      body: [
        "buildLayer4ThrottleHandler({",
        "  readBytesPerSecond: ${1:1},",
        "  readBurstSize: ${2:1},",
        "  totalReadBytesPerSecond: ${3:1},",
        "  // optional: totalReadBurstSize, latency",
        "})$0",
      ],
      description: "Build Layer4 Throttle Handler",
    },
  },
  buildLayer4ProxyProtocolHandler: {
    name: "buildLayer4ProxyProtocolHandler",
    description:
      "A `proxy_protocol` handler: read the PROXY protocol header a load balancer\nputs in front of the connection, so later handlers see the real client.",
    params: [
      {
        name: "timeout",
        type: "Duration",
        required: false,
        description: "How long to wait for the PROXY header. Default: 5s.",
      },
      {
        name: "allow",
        type: "string[]",
        required: false,
        description: "Only accept PROXY headers from these IPs/CIDR ranges.",
      },
      {
        name: "deny",
        type: "string[]",
        required: false,
        description: "Never accept PROXY headers from these IPs/CIDR ranges.",
      },
      {
        name: "fallbackPolicy",
        type: '"IGNORE" | "USE" | "REJECT" | "REQUIRE" | "SKIP"',
        required: false,
        description: "What to do with connections from addresses not in `allow`. Default: IGNORE.",
      },
    ],
    returnType: "Layer4ProxyProtocolHandler",
    example: 'buildLayer4ProxyProtocolHandler({ allow: ["10.0.0.0/8"] })',
    snippet: {
      prefix: "caddy-layer4-proxy-protocol-handler",
      body: [
        "buildLayer4ProxyProtocolHandler({",
        '  timeout: "${1:timeout}",',
        '  allow: ["${2:allow}"],',
        '  deny: ["${3:deny}"],',
        "  // optional: fallbackPolicy",
        "})$0",
      ],
      description: "Build Layer4 Proxy Protocol Handler",
    },
  },
  buildLayer4Socks5Handler: {
    name: "buildLayer4Socks5Handler",
    description: "A `socks5` handler: a SOCKSv5 proxy server.",
    params: [
      {
        name: "commands",
        type: '("CONNECT" | "ASSOCIATE" | "BIND")[]',
        required: false,
        description: "Allowed SOCKS commands. Default: CONNECT and ASSOCIATE.",
      },
      {
        name: "bindIp",
        type: "string",
        required: false,
        description: "Local IP to bind outgoing connections to.",
      },
      {
        name: "credentials",
        type: "Record<string, string>",
        required: false,
        description: "Username → password; when set, clients must authenticate.",
      },
    ],
    returnType: "Layer4Socks5Handler",
    example: 'buildLayer4Socks5Handler({ credentials: { alice: "secret" } })',
    snippet: {
      prefix: "caddy-layer4-socks5-handler",
      body: [
        "buildLayer4Socks5Handler({",
        '  commands: ["${1|CONNECT,ASSOCIATE,BIND|}"],',
        '  bindIp: "${2:bindIp}",',
        "  credentials: {},",
        "})$0",
      ],
      description: "Build Layer4 Socks5 Handler",
    },
  },
  buildLayer4TeeHandler: {
    name: "buildLayer4TeeHandler",
    description:
      "A `tee` handler: also run `branch` on a copy of the connection's data, e.g.\nto mirror traffic to a second upstream.",
    params: [
      {
        name: "branch",
        type: "Layer4Handler[]",
        required: true,
        description: "the handlers that get the copy",
      },
    ],
    returnType: "Layer4TeeHandler",
    example: 'buildLayer4TeeHandler([buildLayer4ProxyHandler("mirror:5432")])',
    snippet: {
      prefix: "caddy-layer4-tee-handler",
      body: ['buildLayer4TeeHandler([{ handler: "subroute" }])$0'],
      description: "Build Layer4 Tee Handler",
    },
  },
  buildLayer4EchoHandler: {
    name: "buildLayer4EchoHandler",
    description: "An `echo` handler: writes back everything it reads.",
    params: [],
    returnType: "Layer4EchoHandler",
    example: "buildLayer4EchoHandler()",
    snippet: {
      prefix: "caddy-layer4-echo-handler",
      body: ["buildLayer4EchoHandler()$0"],
      description: "Build Layer4 Echo Handler",
    },
  },
  buildLayer4CloseHandler: {
    name: "buildLayer4CloseHandler",
    description: "A `close` handler: closes the connection.",
    params: [],
    returnType: "Layer4CloseHandler",
    example: "buildLayer4CloseHandler()",
    snippet: {
      prefix: "caddy-layer4-close-handler",
      body: ["buildLayer4CloseHandler()$0"],
      description: "Build Layer4 Close Handler",
    },
  },
  buildLayer4PostgresTlsHandler: {
    name: "buildLayer4PostgresTlsHandler",
    description:
      "A `postgres_tls` handler: answers a Postgres client's SSLRequest, so a `tls`\nhandler after it can terminate the TLS that follows.",
    params: [],
    returnType: "Layer4PostgresTlsHandler",
    example: "buildLayer4PostgresTlsHandler()",
    snippet: {
      prefix: "caddy-layer4-postgres-tls-handler",
      body: ["buildLayer4PostgresTlsHandler()$0"],
      description: "Build Layer4 Postgres Tls Handler",
    },
  },
  buildLayer4TlsMatcherSet: {
    name: "buildLayer4TlsMatcherSet",
    description:
      "A matcher set for TLS connections, optionally by server name (SNI) and ALPN.\nTLS stays encrypted: route by SNI and pass the connection on as-is.",
    params: [
      {
        name: "sni",
        type: "string[]",
        required: false,
        description: "Server names (SNI) to match; wildcards like `*.example.com` allowed.",
        example: "db.example.com",
      },
      {
        name: "alpn",
        type: "string[]",
        required: false,
        description: "ALPN protocols to match.",
        example: "h2",
      },
    ],
    returnType: "Layer4MatcherSet",
    example: 'buildLayer4TlsMatcherSet({ sni: ["db.example.com"] })',
    snippet: {
      prefix: "caddy-layer4-tls-matcher-set",
      body: [
        "buildLayer4TlsMatcherSet({",
        '  sni: ["${1:db.example.com}"],',
        '  alpn: ["${2:alpn}"],',
        "})$0",
      ],
      description: "Build Layer4 Tls Matcher Set",
    },
  },
  buildLayer4HttpMatcherSet: {
    name: "buildLayer4HttpMatcherSet",
    description: "A matcher set for plain HTTP connections, optionally by host and path.",
    params: [
      {
        name: "host",
        type: "string[]",
        required: false,
        description: "Host header values to match.",
        example: "example.com",
      },
      {
        name: "path",
        type: "string[]",
        required: false,
        description: "Request paths to match.",
        example: "/api/*",
      },
    ],
    returnType: "Layer4MatcherSet",
    example: 'buildLayer4HttpMatcherSet({ host: ["example.com"] })',
    snippet: {
      prefix: "caddy-layer4-http-matcher-set",
      body: [
        "buildLayer4HttpMatcherSet({",
        '  host: ["${1:example.com}"],',
        '  path: ["${2:/api/*}"],',
        "})$0",
      ],
      description: "Build Layer4 Http Matcher Set",
    },
  },
  buildLayer4PostgresMatcherSet: {
    name: "buildLayer4PostgresMatcherSet",
    description:
      "A matcher set for Postgres connections, optionally by user, database,\napplication name, or whether the client asks for TLS.",
    params: [
      {
        name: "users",
        type: "Record<string, string[]>",
        required: false,
        description:
          'User name → databases it may use (`[]`: any database; key `"*"`: any other user).',
      },
      {
        name: "clients",
        type: "string[]",
        required: false,
        description: "Accepted `application_name` values.",
      },
      {
        name: "tls",
        type: '"enabled" | "disabled"',
        required: false,
        description:
          '`"enabled"`: the client must start with an SSLRequest; `"disabled"`: it must not.',
      },
    ],
    returnType: "Layer4MatcherSet",
    example: 'buildLayer4PostgresMatcherSet({ users: { app: ["shop"] } })',
    snippet: {
      prefix: "caddy-layer4-postgres-matcher-set",
      body: [
        "buildLayer4PostgresMatcherSet({",
        "  users: {},",
        '  clients: ["${1:client}"],',
        '  tls: "${2|enabled,disabled|}",',
        "})$0",
      ],
      description: "Build Layer4 Postgres Matcher Set",
    },
  },
  buildLayer4RemoteIpMatcherSet: {
    name: "buildLayer4RemoteIpMatcherSet",
    description: "A matcher set for client addresses.",
    params: [
      {
        name: "ranges",
        type: "string | string[]",
        required: true,
        description: "IPs or CIDR ranges",
      },
    ],
    returnType: "Layer4MatcherSet",
    example: 'buildLayer4RemoteIpMatcherSet(["10.0.0.0/8"])',
    snippet: {
      prefix: "caddy-layer4-remote-ip-matcher-set",
      body: ['buildLayer4RemoteIpMatcherSet("${1:10.0.0.0/8}")$0'],
      description: "Build Layer4 Remote Ip Matcher Set",
    },
  },
  buildLayer4Route: {
    name: "buildLayer4Route",
    description: "A layer4 route: matcher sets (any may match) and the handlers to run.",
    params: [
      {
        name: "id",
        type: "string",
        required: false,
        description: "`@id`, so the route can be found and replaced later.",
      },
      {
        name: "match",
        type: "Layer4Protocol | Layer4MatcherSet[]",
        required: false,
        description:
          'A protocol name (`"tls"`) or full matcher sets; none matches every connection.',
      },
      {
        name: "handle",
        type: "Layer4Handler[]",
        required: true,
        description: "Handlers, run in order (the last one usually `proxy`).",
      },
    ],
    returnType: "Layer4Route",
    example:
      'buildLayer4Route({ match: "ssh", handle: [buildLayer4ProxyHandler("localhost:22")] })',
    snippet: {
      prefix: "caddy-layer4-route",
      body: [
        "buildLayer4Route({",
        '  handle: [{ handler: "subroute" }],',
        "  // optional: id, match",
        "})$0",
      ],
      description: "Build Layer4 Route",
    },
  },
  buildLayer4ProxyRoute: {
    name: "buildLayer4ProxyRoute",
    description: "A route that proxies matching connections to an upstream.",
    params: [
      {
        name: "id",
        type: "string",
        required: false,
        description: "",
      },
      {
        name: "upstream",
        type: "string | string[]",
        required: true,
        description: "",
      },
      {
        name: "match",
        type: "Layer4Protocol | Layer4MatcherSet[]",
        required: false,
        description: "",
      },
      {
        name: "proxy",
        type: "Layer4ProxyHandlerOptions",
        required: false,
        description: "Load balancing, health checks, upstream TLS, PROXY protocol.",
      },
    ],
    returnType: "Layer4Route",
    example:
      'buildLayer4ProxyRoute({ id: "postgres", upstream: "postgres:5432", match: "postgres" })',
    snippet: {
      prefix: "caddy-layer4-proxy-route",
      body: [
        "buildLayer4ProxyRoute({",
        '  upstream: "${1:localhost:3000}",',
        "  // optional: id, match, proxy",
        "})$0",
      ],
      description: "Build Layer4 Proxy Route",
    },
  },
  buildLayer4SniRoute: {
    name: "buildLayer4SniRoute",
    description:
      "Route TLS connections by server name (SNI): pass them through to an upstream\nthat terminates TLS itself, or terminate TLS in Caddy first.",
    params: [
      {
        name: "id",
        type: "string",
        required: false,
        description: "`@id`, so the route can be found and replaced later.",
      },
      {
        name: "sni",
        type: "string | string[]",
        required: true,
        description: "Server names (SNI) this route is for.",
        example: "db.example.com",
      },
      {
        name: "upstream",
        type: "string | string[]",
        required: true,
        description: "`host:port` (or a list) to send the connections to.",
        example: "localhost:8443",
      },
      {
        name: "terminate",
        type: "boolean",
        required: false,
        description:
          "`false` (default): pass the TLS through untouched, the upstream terminates it.\n`true`: Caddy terminates TLS with its own certificate and proxies plaintext.",
      },
    ],
    returnType: "Layer4Route",
    example: 'buildLayer4SniRoute({ sni: "db.example.com", upstream: "localhost:8443" })',
    snippet: {
      prefix: "caddy-layer4-sni-route",
      body: [
        "buildLayer4SniRoute({",
        '  sni: "${1:db.example.com}",',
        '  upstream: "${2:localhost:3000}",',
        "  // optional: id, terminate",
        "})$0",
      ],
      description: "Build Layer4 Sni Route",
    },
  },
  buildLayer4Server: {
    name: "buildLayer4Server",
    description: "A layer4 server: where it listens and its routes, tried in order.",
    params: [
      {
        name: "listen",
        type: "string | string[]",
        required: true,
        description: "",
      },
      {
        name: "routes",
        type: "Layer4Route[]",
        required: true,
        description: "",
      },
      {
        name: "idleTimeout",
        type: "string | number",
        required: false,
        description: "Close connections idle this long.",
      },
      {
        name: "matchingTimeout",
        type: "string | number",
        required: false,
        description: "How long matchers may wait for enough data. Default: 3s.",
      },
    ],
    returnType: "Layer4Server",
    example: 'buildLayer4Server({ listen: [":5432"], routes: [route] })',
    snippet: {
      prefix: "caddy-layer4-server",
      body: [
        "buildLayer4Server({",
        '  listen: "${1::5432}",',
        '  routes: [{ handle: [{ handler: "subroute" }] }],',
        "  // optional: idleTimeout, matchingTimeout",
        "})$0",
      ],
      description: "Build Layer4 Server",
    },
  },
  buildLayer4App: {
    name: "buildLayer4App",
    description: "The whole `layer4` app (`apps.layer4`), for a full config load.",
    params: [],
    returnType: "Layer4App",
    example: 'buildLayer4App({ db: buildLayer4Server({ listen: ":5432", routes: [route] }) })',
    snippet: {
      prefix: "caddy-layer4-app",
      body: ["buildLayer4App({", "})$0"],
      description: "Build Layer4 App",
    },
  },
  buildLayer4ListenerWrapper: {
    name: "buildLayer4ListenerWrapper",
    description:
      "The `layer4` listener wrapper for an HTTP server's `listener_wrappers`: its\nroutes see each connection first (e.g. SSH on :443); whatever they don't\nhandle continues to the HTTP server. Put it before the `tls` wrapper.",
    params: [
      {
        name: "routes",
        type: "Layer4Route[]",
        required: true,
        description: "",
      },
      {
        name: "matchingTimeout",
        type: "string | number",
        required: false,
        description: "How long matchers may wait for enough data. Default: 3s.",
      },
    ],
    returnType: "Layer4ListenerWrapper",
    example:
      'buildLayer4ListenerWrapper({ routes: [buildLayer4ProxyRoute({ upstream: "localhost:22", match: "ssh" })] })',
    snippet: {
      prefix: "caddy-layer4-listener-wrapper",
      body: [
        "buildLayer4ListenerWrapper({",
        '  routes: [{ handle: [{ handler: "subroute" }] }],',
        "  // optional: matchingTimeout",
        "})$0",
      ],
      description: "Build Layer4 Listener Wrapper",
    },
  },
};

/**
 * Handler type metadata for Caddy route handlers
 *
 * Use this for:
 * - Autocomplete for handler discriminator
 * - Hover documentation with Caddy docs links
 * - Handler-specific field suggestions
 */
export const HANDLER_METADATA: Record<string, HandlerMetadata> = {
  authenticator: {
    name: "authenticator",
    displayName: "Authenticator (caddy-security)",
    description: "Serve authentication portal for caddy-security plugin",
    discriminator: "authenticator",
    commonFields: ["portal_name", "route_matcher"],
    caddyDocsPath: "https://github.com/greenpau/caddy-security",
  },
  authentication: {
    name: "authentication",
    displayName: "Authentication",
    description: "HTTP Basic authentication or custom auth providers",
    discriminator: "authentication",
    commonFields: ["providers"],
    caddyDocsPath: "/docs/json/apps/http/servers/routes/handle/authentication/",
  },
  reverse_proxy: {
    name: "reverse_proxy",
    displayName: "Reverse Proxy",
    description: "Proxy requests to upstream backend servers with load balancing",
    discriminator: "reverse_proxy",
    commonFields: ["upstreams", "transport", "load_balancing", "health_checks", "headers"],
    caddyDocsPath: "/docs/json/apps/http/servers/routes/handle/reverse_proxy/",
  },
  headers: {
    name: "headers",
    displayName: "Headers",
    description: "Modify request and response headers",
    discriminator: "headers",
    commonFields: ["request", "response"],
    caddyDocsPath: "/docs/json/apps/http/servers/routes/handle/headers/",
  },
  static_response: {
    name: "static_response",
    displayName: "Static Response",
    description: "Return a static response without proxying",
    discriminator: "static_response",
    commonFields: ["status_code", "body", "headers", "close", "abort"],
    caddyDocsPath: "/docs/json/apps/http/servers/routes/handle/static_response/",
  },
  rewrite: {
    name: "rewrite",
    displayName: "Rewrite",
    description: "Rewrite the request URI before processing",
    discriminator: "rewrite",
    commonFields: ["uri", "strip_path_prefix", "strip_path_suffix", "uri_substring"],
    caddyDocsPath: "/docs/json/apps/http/servers/routes/handle/rewrite/",
  },
  encode: {
    name: "encode",
    displayName: "Encode",
    description: "Compress responses with gzip, zstd, or brotli",
    discriminator: "encode",
    commonFields: ["encodings", "prefer", "minimum_length"],
    caddyDocsPath: "/docs/json/apps/http/servers/routes/handle/encode/",
  },
  subroute: {
    name: "subroute",
    displayName: "Subroute",
    description: "Process requests through nested routes",
    discriminator: "subroute",
    commonFields: ["routes"],
    caddyDocsPath: "/docs/json/apps/http/servers/routes/handle/subroute/",
  },
  file_server: {
    name: "file_server",
    displayName: "File Server",
    description: "Serve static files from disk",
    discriminator: "file_server",
    commonFields: ["root", "index_names", "browse", "hide"],
    caddyDocsPath: "/docs/json/apps/http/servers/routes/handle/file_server/",
  },
  templates: {
    name: "templates",
    displayName: "Templates",
    description: "Render Go templates in responses",
    discriminator: "templates",
    commonFields: ["file_root", "mime_types", "delimiters"],
    caddyDocsPath: "/docs/json/apps/http/servers/routes/handle/templates/",
  },
  map: {
    name: "map",
    displayName: "Map",
    description: "Map input to output values for use in other handlers",
    discriminator: "map",
    commonFields: ["source", "destinations", "mappings", "defaults"],
    caddyDocsPath: "/docs/json/apps/http/servers/routes/handle/map/",
  },
  push: {
    name: "push",
    displayName: "HTTP/2 Push",
    description: "Push resources to clients over HTTP/2",
    discriminator: "push",
    commonFields: ["resources", "headers"],
    caddyDocsPath: "/docs/json/apps/http/servers/routes/handle/push/",
  },
  request_body: {
    name: "request_body",
    displayName: "Request Body",
    description: "Configure request body size limits",
    discriminator: "request_body",
    commonFields: ["max_size"],
    caddyDocsPath: "/docs/json/apps/http/servers/routes/handle/request_body/",
  },
  vars: {
    name: "vars",
    displayName: "Variables",
    description: "Set variables for use in other handlers",
    discriminator: "vars",
    commonFields: [],
    caddyDocsPath: "/docs/json/apps/http/servers/routes/handle/vars/",
  },
  intercept: {
    name: "intercept",
    displayName: "Intercept",
    description: "Intercept and modify responses from upstreams",
    discriminator: "intercept",
    commonFields: ["handle_response"],
    caddyDocsPath: "/docs/json/apps/http/servers/routes/handle/intercept/",
  },
  invoke: {
    name: "invoke",
    displayName: "Invoke",
    description: "Invoke a named route by reference",
    discriminator: "invoke",
    commonFields: ["name"],
    caddyDocsPath: "/docs/json/apps/http/servers/routes/handle/invoke/",
  },
  tracing: {
    name: "tracing",
    displayName: "Tracing",
    description: "Add distributed tracing spans",
    discriminator: "tracing",
    commonFields: ["span"],
    caddyDocsPath: "/docs/json/apps/http/servers/routes/handle/tracing/",
  },
  log_append: {
    name: "log_append",
    displayName: "Log Append",
    description: "Append custom fields to access logs",
    discriminator: "log_append",
    commonFields: ["key", "value"],
    caddyDocsPath: "/docs/json/apps/http/servers/routes/handle/log_append/",
  },
  error: {
    name: "error",
    displayName: "Error",
    description: "Trigger an error response",
    discriminator: "error",
    commonFields: ["error", "status_code"],
    caddyDocsPath: "/docs/json/apps/http/servers/routes/handle/error/",
  },
  copy_response: {
    name: "copy_response",
    displayName: "Copy Response",
    description: "Copy response from another handler",
    discriminator: "copy_response",
    commonFields: ["status_code"],
    caddyDocsPath: "/docs/json/apps/http/servers/routes/handle/copy_response/",
  },
  copy_response_headers: {
    name: "copy_response_headers",
    displayName: "Copy Response Headers",
    description: "Copy specific headers from another response",
    discriminator: "copy_response_headers",
    commonFields: ["include", "exclude"],
    caddyDocsPath: "/docs/json/apps/http/servers/routes/handle/copy_response_headers/",
  },
};

/**
 * All handler discriminator values for autocomplete
 */
export const HANDLER_NAMES = Object.keys(HANDLER_METADATA) as readonly string[];

/**
 * All builder function names for autocomplete
 */
export const BUILDER_NAMES = Object.keys(BUILDER_METADATA) as readonly string[];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get snippets in VSCode snippet format
 */
export function getVSCodeSnippets(): Record<
  string,
  { prefix: string; body: string[]; description: string }
> {
  const snippets: Record<string, { prefix: string; body: string[]; description: string }> = {};

  for (const [name, builder] of Object.entries(BUILDER_METADATA)) {
    snippets[name] = {
      prefix: builder.snippet.prefix,
      body: builder.snippet.body,
      description: builder.snippet.description,
    };
  }

  return snippets;
}

/**
 * Get handler completion items for VSCode
 */
export function getHandlerCompletions(): Array<{
  label: string;
  detail: string;
  documentation: string;
}> {
  return Object.values(HANDLER_METADATA).map((handler) => ({
    label: handler.name,
    detail: handler.displayName,
    documentation: handler.description,
  }));
}
