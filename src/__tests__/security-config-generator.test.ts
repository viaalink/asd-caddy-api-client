/**
 * Unit tests for vscode-extension/src/wizards/security-config-generator.ts.
 *
 * The generator delegates to the library's caddy-security builders, so these
 * tests assert the go-authcrunch shape (kind/params stores, cookie_config,
 * access_list_rules, %s LDAP placeholder) AND that the output validates
 * against the very schema the extension applies to caddy-security.json --
 * the original hand-written generator emitted driver/search_filter/cookie/
 * access_lists, which that schema rejects.
 */
import { describe, test, expect } from "vitest";
import { join } from "path";
import {
  buildWizardSecurityConfig,
  generateSecurityCode,
  generateIdentityStoreConfig,
  generatePortalConfig,
  generatePolicyConfig,
  type PortalConfig,
  type SecurityConfig,
} from "../../vscode-extension/src/wizards/security-config-generator.js";
import { SimpleSchemaValidator } from "../../vscode-extension/src/providers/schema-validator.js";

// src/generated/schemas is what vscode-extension/schemas is copied from at build time.
const validator = new SimpleSchemaValidator(join(__dirname, "../generated"));
const securitySchema = validator.getSchemaForFile("caddy-security.json");

describe("generateIdentityStoreConfig", () => {
  test("local store uses kind/params, named after the realm", () => {
    expect(
      generateIdentityStoreConfig({ type: "local", realm: "local", path: "/etc/users.json" })
    ).toEqual({
      name: "local",
      kind: "local",
      params: { realm: "local", path: "/etc/users.json" },
    });
  });

  test("ldap store converts {username} to the %s placeholder the admin API needs", () => {
    const store = generateIdentityStoreConfig({
      type: "ldap",
      realm: "corp",
      ldapServers: [{ address: "ldap.example.com", port: 389 }],
      bindDn: "cn=admin,dc=example,dc=com",
      bindPassword: "secret",
      searchBaseDn: "ou=users,dc=example,dc=com",
      searchFilter: "(uid={username})",
    });
    expect(store).toMatchObject({
      name: "corp",
      kind: "ldap",
      params: {
        realm: "corp",
        bind_username: "cn=admin,dc=example,dc=com",
        search_base_dn: "ou=users,dc=example,dc=com",
        search_user_filter: "(uid=%s)",
      },
    });
    expect(JSON.stringify(store)).not.toContain("{username}");
  });

  test("oidc provider appends the well-known metadata path", () => {
    const provider = generateIdentityStoreConfig({
      type: "oidc",
      realm: "sso",
      provider: "keycloak",
      clientId: "abc",
      clientSecret: "xyz",
      metadataUrl: "https://idp.example.com/realms/main",
    });
    expect(JSON.stringify(provider)).toContain(
      "https://idp.example.com/realms/main/.well-known/openid-configuration"
    );
  });
});

describe("generatePortalConfig", () => {
  test("references identity stores by name and omits cookie_config when unset", () => {
    const portal = generatePortalConfig({ name: "myportal", identityStores: ["local"] });
    expect(portal).toMatchObject({ name: "myportal", identity_stores: ["local"] });
    expect(portal).not.toHaveProperty("cookie_config");
  });

  test("turns a cookie domain + lifetime into cookie_config with lifetime in seconds", () => {
    const both: PortalConfig = {
      name: "p",
      identityStores: ["local"],
      cookieDomain: ".example.com",
      cookieLifetime: "24h",
    };
    expect(generatePortalConfig(both).cookie_config).toEqual({
      domains: { ".example.com": { lifetime: 86400 } },
    });
  });

  test("routes OAuth/OIDC names to identity_providers, not identity_stores", () => {
    const portal = generatePortalConfig(
      { name: "p", identityStores: ["local", "github"] },
      new Set(["github"])
    );
    expect(portal).toMatchObject({ identity_stores: ["local"], identity_providers: ["github"] });
  });
});

describe("generatePolicyConfig", () => {
  test("maps claim/values to access_list_rules match conditions", () => {
    expect(
      generatePolicyConfig({
        name: "my-policy",
        accessLists: [
          { action: "allow", claim: "roles", values: ["admin", "user"] },
          { action: "deny", claim: "email", values: ["banned@example.com"] },
        ],
      })
    ).toEqual({
      name: "my-policy",
      access_list_rules: [
        { action: "allow", conditions: ["match roles admin user"] },
        { action: "deny", conditions: ["match email banned@example.com"] },
      ],
    });
  });
});

describe("generateSecurityCode", () => {
  const quickSetup: SecurityConfig = {
    identityStores: [{ type: "local", realm: "local", path: "/etc/users.json" }],
    portals: [
      {
        name: "myportal",
        identityStores: ["local"],
        cookieDomain: ".example.com",
        cookieLifetime: "24h",
      },
    ],
    policies: [
      {
        name: "myportal-policy",
        accessLists: [{ action: "allow", claim: "roles", values: ["user", "admin"] }],
      },
    ],
  };

  const custom: SecurityConfig = {
    identityStores: [
      {
        type: "ldap",
        realm: "corp",
        ldapServers: [{ address: "ldap.example.com", port: 636 }],
        bindDn: "cn=admin,dc=example,dc=com",
        bindPassword: "secret",
        searchBaseDn: "ou=users,dc=example,dc=com",
      },
      {
        type: "oauth2",
        realm: "github",
        provider: "github",
        clientId: "abc",
        clientSecret: "xyz",
        scopes: ["read:user"],
      },
    ],
    portals: [{ name: "sso", identityStores: ["corp", "github"] }],
    policies: [
      { name: "admins", accessLists: [{ action: "allow", claim: "roles", values: ["admin"] }] },
    ],
  };

  test.each([
    ["quick setup", quickSetup],
    ["custom LDAP + OAuth2 setup", custom],
  ])("%s output validates against the extension's caddy-security.json schema", (_, cfg) => {
    expect(securitySchema).toBeDefined();
    const parsed: unknown = JSON.parse(generateSecurityCode(cfg));
    expect(validator.validate(parsed, securitySchema!)).toEqual([]);
  });

  test("assembles all sections at the top level of the security config", () => {
    const parsed = buildWizardSecurityConfig(custom);
    expect(parsed.identity_stores).toHaveLength(1);
    expect(parsed.identity_providers).toHaveLength(1);
    expect(parsed.authentication_portals).toHaveLength(1);
    expect(parsed.authorization_policies).toHaveLength(1);
  });
});
