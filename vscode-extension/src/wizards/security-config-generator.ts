/**
 * Security-config JSON generation for the Security Configuration Wizard.
 *
 * Every object is produced by the library's own caddy-security builders, so
 * the wizard can only ever emit the shape go-authcrunch actually accepts
 * (`kind`/`params` identity stores, `cookie_config`, `access_list_rules`, the
 * `%s` LDAP placeholder, ...) and that the extension's own schemas validate.
 * An earlier hand-written version emitted `driver`/`search_filter`/`cookie`/
 * `access_lists`, which the extension then flagged as invalid in its own
 * `caddy-security.json` validation.
 *
 * No vscode import: unit tested directly (src/__tests__/security-config-generator.test.ts).
 */

import {
  buildAuthenticationPortal,
  buildAuthorizationPolicy,
  buildLdapIdentityStore,
  buildLocalIdentityStore,
  buildOAuth2Provider,
  buildOidcProvider,
  buildSecurityConfig,
} from "@viaalink/caddy-api-client/plugins/caddy-security";

export interface IdentityStoreConfig {
  type: "local" | "ldap" | "oauth2" | "oidc";
  /** Store/provider name; portals reference stores by this name. */
  realm: string;
  // Local store
  path?: string;
  // LDAP store
  ldapServers?: Array<{ address: string; port: number }>;
  bindDn?: string;
  bindPassword?: string;
  searchBaseDn?: string;
  /** Either `{username}` (Caddyfile style) or `%s`; the builder normalises it. */
  searchFilter?: string;
  // OAuth2/OIDC
  provider?: string;
  clientId?: string;
  clientSecret?: string;
  metadataUrl?: string;
  scopes?: string[];
}

export interface PortalConfig {
  name: string;
  identityStores: string[];
  cookieDomain?: string;
  cookieLifetime?: string;
}

export interface PolicyConfig {
  name: string;
  accessLists: Array<{
    action: "allow" | "deny";
    claim: string;
    values: string[];
  }>;
}

export interface SecurityConfig {
  identityStores: IdentityStoreConfig[];
  portals: PortalConfig[];
  policies: PolicyConfig[];
}

// Typed from the builders themselves so this can never drift from what they return.
type BuiltStore =
  | ReturnType<typeof buildLocalIdentityStore>
  | ReturnType<typeof buildLdapIdentityStore>;
type BuiltProvider = ReturnType<typeof buildOAuth2Provider> | ReturnType<typeof buildOidcProvider>;
type AuthenticationPortal = ReturnType<typeof buildAuthenticationPortal>;
type AuthorizationPolicy = ReturnType<typeof buildAuthorizationPolicy>;
type CaddySecurityConfig = ReturnType<typeof buildSecurityConfig>;

function isProvider(store: IdentityStoreConfig): boolean {
  return store.type === "oauth2" || store.type === "oidc";
}

/**
 * Build the caddy-security `config` object (what goes in `caddy-security.json`,
 * or under `/config/apps/security/config` in a full Caddy config).
 */
export function buildWizardSecurityConfig(config: SecurityConfig): CaddySecurityConfig {
  const identityStores = config.identityStores
    .filter((s) => !isProvider(s))
    .map((s) => generateIdentityStoreConfig(s) as BuiltStore);
  const identityProviders = config.identityStores
    .filter(isProvider)
    .map((s) => generateIdentityStoreConfig(s) as BuiltProvider);
  const providerNames = new Set(config.identityStores.filter(isProvider).map((s) => s.realm));

  return buildSecurityConfig({
    ...(identityStores.length > 0 && { identityStores }),
    ...(identityProviders.length > 0 && { identityProviders }),
    portals: config.portals.map((p) => generatePortalConfig(p, providerNames)),
    policies: config.policies.map(generatePolicyConfig),
  });
}

export function generateSecurityCode(config: SecurityConfig): string {
  return JSON.stringify(buildWizardSecurityConfig(config), null, 2);
}

export function generateIdentityStoreConfig(
  store: IdentityStoreConfig
): BuiltStore | BuiltProvider {
  switch (store.type) {
    case "local":
      return buildLocalIdentityStore({
        name: store.realm,
        realm: store.realm,
        path: store.path ?? "/etc/caddy/users.json",
      });

    case "ldap":
      return buildLdapIdentityStore({
        name: store.realm,
        realm: store.realm,
        servers: store.ldapServers ?? [{ address: "ldap.example.com", port: 389 }],
        bindUsername: store.bindDn ?? "",
        bindPassword: store.bindPassword ?? "",
        searchBaseDn: store.searchBaseDn ?? "",
        ...(store.searchFilter && { searchUserFilter: store.searchFilter }),
      });

    case "oauth2":
      return buildOAuth2Provider({
        name: store.realm,
        realm: store.realm,
        provider: store.provider ?? "generic",
        clientId: store.clientId ?? "",
        clientSecret: store.clientSecret ?? "",
        ...(store.scopes && { scopes: store.scopes }),
      });

    case "oidc":
      return buildOidcProvider({
        name: store.realm,
        realm: store.realm,
        provider: store.provider ?? "generic",
        clientId: store.clientId ?? "",
        clientSecret: store.clientSecret ?? "",
        metadataUrl: store.metadataUrl ?? "https://idp.example.com",
        ...(store.scopes && { scopes: store.scopes }),
      });
  }
}

export function generatePortalConfig(
  portal: PortalConfig,
  providerNames: ReadonlySet<string> = new Set()
): AuthenticationPortal {
  const stores = portal.identityStores.filter((s) => !providerNames.has(s));
  const providers = portal.identityStores.filter((s) => providerNames.has(s));
  const cookie =
    portal.cookieDomain || portal.cookieLifetime
      ? {
          ...(portal.cookieDomain && { domain: portal.cookieDomain }),
          ...(portal.cookieLifetime && { lifetime: portal.cookieLifetime }),
        }
      : undefined;

  return buildAuthenticationPortal({
    name: portal.name,
    ...(stores.length > 0 && { identityStores: stores }),
    ...(providers.length > 0 && { identityProviders: providers }),
    ...(cookie && { cookie }),
  });
}

export function generatePolicyConfig(policy: PolicyConfig): AuthorizationPolicy {
  return buildAuthorizationPolicy({
    name: policy.name,
    accessLists: policy.accessLists,
  });
}
