/**
 * Generate JSON Schemas from Zod schemas for VSCode extension validation
 *
 * This script converts existing Zod schemas to JSON Schema format for use in:
 * - VSCode JSON language service (autocomplete, validation)
 * - Schema validation in external tools
 * - Documentation generation
 *
 * Generated output: src/generated/schemas/
 */

import { z } from "zod";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, "..");
const SCHEMAS_DIR = join(ROOT_DIR, "src/generated/schemas");

// ============================================================================
// Import Zod Schemas
// ============================================================================

// Core schemas from src/schemas.ts
import {
  CaddyRouteMatcherSchema,
  CaddyRouteSchema,
  ReverseProxyHandlerSchema,
  HeadersHandlerSchema,
  StaticResponseHandlerSchema,
  EncodeHandlerSchema,
  RewriteHandlerSchema,
  AuthenticationHandlerSchema,
  FileServerHandlerSchema,
  TemplatesHandlerSchema,
  MapHandlerSchema,
  PushHandlerSchema,
  RequestBodyHandlerSchema,
  VarsHandlerSchema,
  InterceptHandlerSchema,
  InvokeHandlerSchema,
  TracingHandlerSchema,
  LogAppendHandlerSchema,
  ErrorHandlerSchema,
  CopyResponseHandlerSchema,
  CopyResponseHeadersHandlerSchema,
} from "../src/schemas.js";

// Security plugin schemas
import {
  SecurityAuthenticatorHandlerSchema,
  SecurityAuthorizationHandlerSchema,
  LocalIdentityStoreSchema,
  LdapIdentityStoreSchema,
  OAuth2IdentityProviderSchema,
  OidcIdentityProviderSchema,
  AuthenticationPortalSchema,
  AuthorizationPolicySchema,
  SecurityConfigSchema,
  SecurityAppSchema,
  IdentityStoreSchema,
} from "../src/plugins/caddy-security/schemas.js";

// Generated core/app schemas (tygo -> zod, always in sync with real Go
// source) — composed below into "caddy-full-config" instead of hand-writing
// a separate, driftable copy of admin/logging/http/tls shapes.
import { adminConfigSchema, loggingSchema } from "../src/generated/caddy-core.zod.js";
import { appSchema as HttpAppSchema, serverSchema } from "../src/generated/caddy-http.zod.js";
import { tlsSchema as TlsAppSchema } from "../src/generated/caddy-tls.zod.js";
import {
  Layer4AppSchema,
  LAYER4_HANDLERS,
  LAYER4_HANDLER_SCHEMAS,
  Layer4MatcherSetSchema,
  Layer4TlsHandshakeMatchSchema,
  Layer4VarsHandlerSchema,
} from "../src/caddy/layer4-schemas.js";

/**
 * The objects that stay open on purpose (`.catchall(z.unknown())`): a matcher
 * set and the TLS handshake conditions take matcher modules of other plugins,
 * the `vars` handler takes any variable name. They keep `additionalProperties:
 * {}`, which strictLayer4 and the strictness audit leave alone. Zod 4 builds
 * `.passthrough()` the same way (a catchall of `z.unknown()`), so these are told
 * apart by their catchall instance; every other passthrough object gets
 * `additionalProperties: true` (closed for the editor by strictLayer4, listed
 * in the audit's PERMISSIVE_FIELDS elsewhere).
 */
const OPEN_CATCHALLS = new Set<unknown>(
  [Layer4MatcherSetSchema, Layer4TlsHandshakeMatchSchema, Layer4VarsHandlerSchema].map(
    (schema) => (schema as unknown as { _zod: { def: { catchall?: unknown } } })._zod.def.catchall
  )
);

// `@id` is a Caddy-wide JSON convention (admin API object addressing,
// stripped before Go struct decoding) -- it isn't a real Go struct field,
// so tygo/zod-to-json-schema generated schemas never allow it, and
// zod-to-json-schema's default `additionalProperties: false` then rejects
// it outright. CaddyRouteSchema (src/schemas.ts) already declares it
// explicitly; the raw generated server/app schemas below don't. Compose a
// route-aware server/http-app schema for the full-config file so nested
// routes in a server config get both "@id" support and the same
// hand-composed matcher fields (tls/protocol/etc, see
// CaddyRouteMatcherSchema's doc comment) that a standalone
// route.caddy.json already gets -- instead of falling back to the raw
// tygo-generated Route type, which has neither.
// CaddyRouteSchema.handle intentionally keeps CaddyRouteHandlerSchema's
// `.passthrough()` shape (see its doc comment in src/schemas.ts): the
// *runtime* npm client must accept legitimate third-party/custom Caddy
// handler modules it hasn't modeled, so it only requires `handler` to be a
// string. For the editor-time schema below, that tradeoff is backwards --
// the whole point of editor validation is catching typos (e.g. reverse_proxy's
// "upstream" vs "upstreams"), so `handle` items are swapped for the strict
// per-handler discriminated union (StrictKnownCaddyHandlerSchema) instead.
// This does mean a genuinely valid but unmodeled handler module gets
// flagged in the editor -- an acceptable, standard trade-off for typed
// editor tooling (same as e.g. a Kubernetes CRD schema rejecting fields it
// doesn't know).
//
// StrictKnownCaddyHandlerSchema/StrictSubrouteHandlerSchema/StrictRouteSchema
// are mutually self-referential (subroute -> routes -> handlers -> subroute
// -> ...) so a typo at any nesting depth is still caught. Requires real
// $refs (toNamedJsonSchema below) -- inlining collapses recursion to `{}`.
const StrictSubrouteHandlerSchema = z.object({
  handler: z.literal("subroute"),
  routes: z.array(z.lazy((): z.ZodTypeAny => StrictRouteSchema)).optional(),
  errors: z.any().optional(),
});

const StrictKnownCaddyHandlerSchema: z.ZodTypeAny = z.discriminatedUnion("handler", [
  ReverseProxyHandlerSchema,
  HeadersHandlerSchema,
  StaticResponseHandlerSchema,
  AuthenticationHandlerSchema,
  RewriteHandlerSchema,
  EncodeHandlerSchema,
  FileServerHandlerSchema,
  TemplatesHandlerSchema,
  MapHandlerSchema,
  PushHandlerSchema,
  RequestBodyHandlerSchema,
  VarsHandlerSchema,
  InterceptHandlerSchema,
  InvokeHandlerSchema,
  TracingHandlerSchema,
  LogAppendHandlerSchema,
  ErrorHandlerSchema,
  CopyResponseHandlerSchema,
  CopyResponseHeadersHandlerSchema,
  StrictSubrouteHandlerSchema,
  SecurityAuthenticatorHandlerSchema,
]);

const StrictRouteSchema: z.ZodTypeAny = CaddyRouteSchema.extend({
  handle: z.array(StrictKnownCaddyHandlerSchema).min(1, "Route must have at least one handler"),
});

const FullConfigServerSchema = serverSchema.omit({ routes: true, named_routes: true }).extend({
  routes: z.array(StrictRouteSchema).optional(),
  named_routes: z.record(z.string(), StrictRouteSchema).optional(),
});
const FullConfigHttpAppSchema = HttpAppSchema.omit({ servers: true }).extend({
  servers: z.record(z.string(), FullConfigServerSchema).optional(),
});

// ============================================================================
// Schema Definitions
// ============================================================================

interface SchemaDefinition {
  name: string;
  schema: unknown; // Zod schema
  description: string;
  fileMatch?: string[];
}

const schemas: SchemaDefinition[] = [
  // Core Caddy schemas
  {
    name: "caddy-route",
    schema: StrictRouteSchema,
    description: "Caddy HTTP route configuration",
    fileMatch: ["**/caddy-route.json", "**/*.caddy-route.json"],
  },
  {
    name: "caddy-route-matcher",
    schema: CaddyRouteMatcherSchema,
    description: "Caddy route matcher (host, path, method, etc.)",
  },
  {
    name: "caddy-handler",
    schema: StrictKnownCaddyHandlerSchema,
    description: "Caddy HTTP handler (reverse_proxy, headers, etc.)",
  },

  // Individual handler schemas for fine-grained validation
  {
    name: "caddy-handler-reverse-proxy",
    schema: ReverseProxyHandlerSchema,
    description: "Caddy reverse proxy handler configuration",
  },
  {
    name: "caddy-handler-headers",
    schema: HeadersHandlerSchema,
    description: "Caddy headers handler configuration",
  },
  {
    name: "caddy-handler-static-response",
    schema: StaticResponseHandlerSchema,
    description: "Caddy static response handler configuration",
  },
  {
    name: "caddy-handler-encode",
    schema: EncodeHandlerSchema,
    description: "Caddy encode/compression handler configuration",
  },
  {
    name: "caddy-handler-rewrite",
    schema: RewriteHandlerSchema,
    description: "Caddy rewrite handler configuration",
  },
  {
    name: "caddy-handler-authentication",
    schema: AuthenticationHandlerSchema,
    description: "Caddy authentication handler configuration",
  },

  // Security plugin schemas
  {
    name: "caddy-security-authenticator",
    schema: SecurityAuthenticatorHandlerSchema,
    description: "caddy-security authenticator portal handler",
  },
  {
    name: "caddy-security-authorization",
    schema: SecurityAuthorizationHandlerSchema,
    description: "caddy-security authorization handler",
  },
  {
    name: "caddy-security-local-store",
    schema: LocalIdentityStoreSchema,
    description: "caddy-security local identity store configuration",
  },
  {
    name: "caddy-security-ldap-store",
    schema: LdapIdentityStoreSchema,
    description: "caddy-security LDAP identity store configuration",
  },
  {
    name: "caddy-security-oauth2-provider",
    schema: OAuth2IdentityProviderSchema,
    description: "caddy-security OAuth2 identity provider configuration",
  },
  {
    name: "caddy-security-oidc-provider",
    schema: OidcIdentityProviderSchema,
    description: "caddy-security OIDC identity provider configuration",
  },
  {
    name: "caddy-security-identity-store",
    schema: IdentityStoreSchema,
    description: "caddy-security identity store (local, LDAP, OAuth2, OIDC)",
  },
  {
    name: "caddy-security-portal",
    schema: AuthenticationPortalSchema,
    description: "caddy-security authentication portal configuration",
    fileMatch: [
      "**/.caddy-security-portal.json",
      "**/caddy-security-portal.json",
      "**/*.caddy-security-portal.json",
    ],
  },
  {
    name: "caddy-security-policy",
    schema: AuthorizationPolicySchema,
    description: "caddy-security authorization policy (gatekeeper) configuration",
    fileMatch: [
      "**/.caddy-security-policy.json",
      "**/caddy-security-policy.json",
      "**/*.caddy-security-policy.json",
    ],
  },
  {
    name: "caddy-security-config",
    schema: SecurityConfigSchema,
    description: "caddy-security configuration (portals, policies, identity stores)",
    fileMatch: [
      "**/.caddy-security.json",
      "**/caddy-security.json",
      "**/security-config.json",
      "**/*.caddy-security.json",
    ],
  },
  {
    name: "caddy-security-app",
    schema: SecurityAppSchema,
    description: "Complete caddy-security app configuration for /config/apps/security",
    fileMatch: ["**/security-app.json"],
  },
  {
    name: "caddy-layer4-app",
    schema: Layer4AppSchema,
    description: "caddy-l4 layer 4 (TCP/UDP) app configuration for /config/apps/layer4",
    fileMatch: ["**/layer4-app.json"],
  },
  {
    name: "caddy-full-config",
    // Composed entirely from already-generated/already-correct schemas —
    // admin/logging from the tygo-generated Caddy core types, http/tls from
    // their respective generated app schemas, security from the
    // caddy-security plugin's own (Go-source-verified) schema. Previously
    // this file was hand-written once and never regenerated, drifting
    // stale relative to real Caddy (e.g. admin was missing `config`,
    // `identity`, `remote`; the security portion used the pre-0.6.0
    // `access_lists`/flat-identity-store format).
    schema: z.object({
      admin: adminConfigSchema.optional(),
      logging: loggingSchema.optional(),
      apps: z
        .object({
          http: FullConfigHttpAppSchema.optional(),
          tls: TlsAppSchema.optional(),
          security: SecurityAppSchema.optional(),
          layer4: Layer4AppSchema.optional(),
        })
        .optional(),
    }),
    description:
      "Complete Caddy server configuration (admin, logging, apps: http/tls/security/layer4)",
    fileMatch: ["**/caddy-server.json", "**/caddy-full.json", "**/*.caddy-server.json"],
  },
];

// ============================================================================
// Generation Logic
// ============================================================================

/**
 * "@id" is a Caddy-wide admin-API object-addressing convention (stripped
 * before Go struct decoding) that's valid on virtually ANY JSON object in a
 * Caddy config -- not just module containers, but matcher objects, upstream
 * entries, anywhere -- verified against real `caddy validate` (an object
 * with "@id" on a matcher, a handler, and an upstream entry all validated
 * successfully). It's therefore not a real Go struct field, so no
 * tygo/zod-to-json-schema-generated schema ever includes it on its own.
 *
 * Hand-adding "@id" wherever we happen to notice it's missing is exactly
 * how it went missing in the first place (see the 0.9.0 changelog entry
 * for caddy-server.json). Instead, walk every generated schema after the
 * fact and add it to every strict (additionalProperties:false) object node
 * -- new schemas get this automatically, with nothing to remember.
 */
function injectUniversalId(node: unknown): void {
  if (node === null || typeof node !== "object") {
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      injectUniversalId(item);
    }
    return;
  }

  const obj = node as Record<string, unknown>;

  if (
    obj.type === "object" &&
    obj.additionalProperties === false &&
    typeof obj.properties === "object" &&
    obj.properties !== null
  ) {
    const properties = obj.properties as Record<string, unknown>;
    if (!("@id" in properties)) {
      properties["@id"] = { type: "string" };
    }
  }

  // Recurse into every place a subschema can live: object properties,
  // array items, additionalProperties-as-schema (z.record()'s value type),
  // and union branches (anyOf/oneOf/allOf, e.g. discriminated unions).
  for (const key of ["properties", "definitions", "patternProperties"]) {
    if (typeof obj[key] === "object" && obj[key] !== null) {
      for (const value of Object.values(obj[key] as Record<string, unknown>)) {
        injectUniversalId(value);
      }
    }
  }
  if (typeof obj.additionalProperties === "object") {
    injectUniversalId(obj.additionalProperties);
  }
  injectUniversalId(obj.items);
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    if (Array.isArray(obj[key])) {
      injectUniversalId(obj[key]);
    }
  }
}

/**
 * caddy-l4 for the editor: strict where the runtime schemas are lenient.
 *
 * The library's layer4 Zod schemas pass unknown fields through on purpose, so
 * a config read back from a newer caddy-l4 still parses. In the editor that
 * would let a typo ("upstream" for "upstreams") pass, which is what the
 * strictness audit guards against. So in the JSON schema, every layer4 object
 * with known fields is closed (additionalProperties: false), and the handler
 * of a module the library doesn't model may not carry a known handler's name:
 * otherwise a misspelled `proxy` handler would validate as an unknown one.
 * Matcher sets stay open (catchall): other plugins add matcher modules.
 */
function strictLayer4(node: unknown, expandHandlers = true): void {
  if (Array.isArray(node)) {
    node.forEach((item) => strictLayer4(item, expandHandlers));
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  const props = obj.properties as Record<string, Record<string, unknown>> | undefined;
  if (props && (obj.additionalProperties === true || obj.additionalProperties === undefined)) {
    const keys = Object.keys(props).filter((key) => key !== "@id");
    const handler = props.handler;
    const otherHandler =
      keys.length === 1 &&
      handler?.type === "string" &&
      !("const" in handler) &&
      !("enum" in handler);
    if (otherHandler && expandHandlers) {
      // The runtime schema dispatches on `handler` in a superRefine, which JSON
      // Schema can't see. Spell it out: a known handler name brings its own
      // (strict) schema; any other name is a module of another plugin.
      obj.allOf = LAYER4_HANDLERS.map((name) => ({
        if: { properties: { handler: { const: name } }, required: ["handler"] },
        // Inline: these are embedded in another document. Recursion (subroute,
        // tee) ends in `{}` one level down rather than a dangling $ref.
        then: toInlineJsonSchema(LAYER4_HANDLER_SCHEMAS[name] as z.ZodType),
      }));
      // Close the embedded handler schemas, but don't expand the handlers nested
      // in them (subroute → handlers → subroute … would never end): one level
      // of handlers is checked in full, deeper ones by name.
      // Only the `then` parts: an `if` must stay open, or it never matches.
      for (const rule of obj.allOf as { then: unknown }[]) strictLayer4(rule.then, false);
      return;
    } else if (!otherHandler) {
      obj.additionalProperties = false;
    }
  }
  for (const value of Object.values(obj)) strictLayer4(value, expandHandlers);
}

/**
 * The shared definitions a subtree reaches through `$ref`s, transitively: zod 4
 * hoists a recursive schema (a matcher set's `not`) to the document's top-level
 * `definitions`, outside `apps.layer4`, where strictLayer4 has to follow it.
 */
function layer4Refs(
  node: unknown,
  definitions: Record<string, unknown>,
  seen: Set<string>
): Set<string> {
  if (Array.isArray(node)) {
    node.forEach((item) => layer4Refs(item, definitions, seen));
  } else if (node && typeof node === "object") {
    const ref = (node as { $ref?: unknown }).$ref;
    const name = typeof ref === "string" ? ref.replace(/^#\/definitions\//, "") : undefined;
    if (name && name in definitions && !seen.has(name)) {
      seen.add(name);
      layer4Refs(definitions[name], definitions, seen);
    }
    for (const value of Object.values(node)) layer4Refs(value, definitions, seen);
  }
  return seen;
}

/** The layer4 app inside a schema: the whole schema, or `apps.layer4` of a full config. */
function applyStrictLayer4(definition: SchemaDefinition, jsonSchema: object): void {
  if (definition.name === "caddy-layer4-app") {
    strictLayer4(jsonSchema);
    return;
  }
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    const apps = (obj.properties as Record<string, { properties?: Record<string, unknown> }>)?.apps;
    if (apps?.properties?.layer4) {
      strictLayer4(apps.properties.layer4);
      layer4Refs(apps.properties.layer4, definitions, new Set()).forEach((name) =>
        strictLayer4(definitions[name])
      );
    }
    for (const value of Object.values(obj)) visit(value);
  };
  const definitions = ((jsonSchema as { definitions?: Record<string, unknown> }).definitions ??
    {}) as Record<string, unknown>;
  visit(jsonSchema);
}

/**
 * Zod 4's own JSON Schema output (`z.toJSONSchema`), normalized to the shape the
 * editor schemas have always had (zod-to-json-schema doesn't understand zod 4
 * and emits `{}` for every schema):
 * - an object with known fields and no `additionalProperties` (zod's default
 *   "strip" objects, whose input form zod 4 leaves open) is closed (`false`),
 *   so a typo'd field is flagged in the editor;
 * - a `.passthrough()` object gets `additionalProperties: true` (see OPEN_CATCHALLS);
 * - a lone `allOf: [{ $ref }]` becomes the `$ref`;
 * - `oneOf` (zod 4's discriminated unions) stays `anyOf`, as consumers expect;
 * - the safe-integer bounds zod 4 adds to every `.int()` are dropped, and so is
 *   `propertyNames: { type: "string" }` (every JSON key is a string).
 */
function normalizeZod4JsonSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalizeZod4JsonSchema);
  if (!node || typeof node !== "object") return node;
  const obj: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    obj[key] = normalizeZod4JsonSchema(value);
  }
  if (obj.maximum === Number.MAX_SAFE_INTEGER) delete obj.maximum;
  if (obj.minimum === Number.MIN_SAFE_INTEGER) delete obj.minimum;
  const names = obj.propertyNames as Record<string, unknown> | undefined;
  if (names && Object.keys(names).length === 1 && names.type === "string") {
    delete obj.propertyNames;
  }
  if (obj.type === "object" && typeof obj.properties === "object") {
    if (obj.additionalProperties === undefined) obj.additionalProperties = false;
  }
  if (Array.isArray(obj.oneOf) && !("anyOf" in obj)) {
    obj.anyOf = obj.oneOf;
    delete obj.oneOf;
  }
  const allOf = obj.allOf as Record<string, unknown>[] | undefined;
  if (Array.isArray(allOf) && allOf.length === 1 && Object.keys(obj).length === 1) {
    const only = allOf[0];
    if (only && typeof only === "object" && "$ref" in only && Object.keys(only).length === 1) {
      return only;
    }
  }
  return obj;
}

function zod4JsonSchema(schema: z.ZodType): Record<string, unknown> {
  const out = z.toJSONSchema(schema, {
    target: "draft-7", // JSON Schema draft-07 for broad compatibility
    io: "input", // what a user writes: defaulted fields stay optional
    unrepresentable: "any", // transforms/custom checks: `{}`
    cycles: "ref",
    reused: "inline",
    // A union member `z.undefined()` (an optional map value) matches nothing in
    // JSON, so it must not widen the union to "anything".
    override: (ctx) => {
      const def = ctx.zodSchema._zod.def;
      if (def.type === "undefined") ctx.jsonSchema.not = {};
      if (
        def.type === "object" &&
        def.catchall?._zod.def.type === "unknown" &&
        !OPEN_CATCHALLS.has(def.catchall)
      ) {
        ctx.jsonSchema.additionalProperties = true;
      }
    },
  }) as Record<string, unknown>;
  delete out.$schema;
  return normalizeZod4JsonSchema(out) as Record<string, unknown>;
}

/** Rewrite every `$ref` in `node` through `rewrite` (`undefined` = drop the ref to `{}`). */
function mapRefs(node: unknown, rewrite: (ref: string) => string | undefined): unknown {
  if (Array.isArray(node)) return node.map((item) => mapRefs(item, rewrite));
  if (!node || typeof node !== "object") return node;
  const obj = node as Record<string, unknown>;
  if (typeof obj.$ref === "string") {
    const ref = rewrite(obj.$ref);
    return ref === undefined ? {} : { ...obj, $ref: ref };
  }
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, mapRefs(v, rewrite)]));
}

/** `{ $ref: "#/definitions/<name>", definitions: { <name>: …, …shared } }`. */
function toNamedJsonSchema(schema: z.ZodType, name: string): object {
  const { definitions, ...root } = zod4JsonSchema(schema);
  const self = `#/definitions/${name}`;
  const rewrite = (ref: string): string => (ref === "#" ? self : ref);
  return {
    $ref: self,
    definitions: {
      [name]: mapRefs(root, rewrite),
      ...(mapRefs(definitions ?? {}, rewrite) as Record<string, unknown>),
    },
  };
}

/** Self-contained (no `$ref`s): recursion ends in `{}`. */
function toInlineJsonSchema(schema: z.ZodType): object {
  const { definitions, ...root } = zod4JsonSchema(schema);
  const defs = (definitions ?? {}) as Record<string, unknown>;
  const inline = (node: unknown, seen: Set<string>): unknown =>
    mapRefsInline(node, (ref) => {
      const key = ref.replace("#/definitions/", "");
      if (ref === "#" || seen.has(key) || !(key in defs)) return undefined;
      return inline(defs[key], new Set([...seen, key]));
    });
  return inline(root, new Set()) as object;
}

function mapRefsInline(node: unknown, resolve: (ref: string) => unknown): unknown {
  if (Array.isArray(node)) return node.map((item) => mapRefsInline(item, resolve));
  if (!node || typeof node !== "object") return node;
  const obj = node as Record<string, unknown>;
  if (typeof obj.$ref === "string") return resolve(obj.$ref) ?? {};
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, mapRefsInline(v, resolve)]));
}

function generateJsonSchema(definition: SchemaDefinition): object {
  // Real $refs (not inlined `{}`), so Strict*Schema's recursion is expressed.
  const jsonSchema = toNamedJsonSchema(definition.schema as z.ZodType, definition.name);

  injectUniversalId(jsonSchema);
  applyStrictLayer4(definition, jsonSchema);

  // Enrich with metadata
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: `https://viaalink.github.io/asd-caddy-api-client/schemas/${definition.name}.json`,
    title: definition.name
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" "),
    description: definition.description,
    ...jsonSchema,
  };
}

function generateCatalog(schemas: SchemaDefinition[]): {
  schemas: { name: string; description: string; url: string; fileMatch?: string[] }[];
} {
  return {
    schemas: schemas.map((s) => ({
      name: s.name,
      description: s.description,
      url: `./${s.name}.json`,
      ...(s.fileMatch && { fileMatch: s.fileMatch }),
    })),
  };
}

function generateVSCodeSettings(schemas: SchemaDefinition[]): object {
  const associations: Record<string, string> = {};

  for (const schema of schemas) {
    if (schema.fileMatch) {
      for (const pattern of schema.fileMatch) {
        associations[pattern] = `./src/generated/schemas/${schema.name}.json`;
      }
    }
  }

  return {
    "json.schemas": Object.entries(associations).map(([fileMatch, url]) => ({
      fileMatch: [fileMatch],
      url,
    })),
  };
}

// ============================================================================
// Main
// ============================================================================

console.log("Generating JSON Schemas from Zod schemas...\n");

// Ensure output directory exists
if (!existsSync(SCHEMAS_DIR)) {
  mkdirSync(SCHEMAS_DIR, { recursive: true });
}

let successCount = 0;
let failCount = 0;

for (const definition of schemas) {
  try {
    const jsonSchema = generateJsonSchema(definition);
    const outputPath = join(SCHEMAS_DIR, `${definition.name}.json`);
    writeFileSync(outputPath, JSON.stringify(jsonSchema, null, 2));
    console.log(`  ✓ ${definition.name}.json`);
    successCount++;
  } catch (error) {
    console.error(`  ✗ ${definition.name}.json - ${error}`);
    failCount++;
  }
}

// Generate catalog file
const catalog = generateCatalog(schemas);
writeFileSync(join(SCHEMAS_DIR, "catalog.json"), JSON.stringify(catalog, null, 2));
console.log(`  ✓ catalog.json`);

// Generate VSCode settings example
const vscodeSettings = generateVSCodeSettings(schemas);
writeFileSync(
  join(SCHEMAS_DIR, "vscode-settings.example.json"),
  JSON.stringify(vscodeSettings, null, 2)
);
console.log(`  ✓ vscode-settings.example.json`);

console.log(`\nGenerated ${successCount} schemas (${failCount} failed)`);
console.log(`Output directory: ${SCHEMAS_DIR}`);
