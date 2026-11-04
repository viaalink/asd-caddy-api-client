/**
 * Extract metadata from builder functions, handler types, and schemas
 * for use in VSCode extension and other tooling.
 *
 * This script parses TypeScript source files using the TypeScript compiler API
 * to extract JSDoc comments, default values, and type information.
 *
 * Generated output: src/generated/extension-assets.ts
 */

import * as ts from "typescript";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, "..");
const OUTPUT_FILE = join(ROOT_DIR, "src/generated/extension-assets.ts");

// ============================================================================
// Types for extracted metadata
// ============================================================================

interface ParamMetadata {
  name: string;
  type: string;
  required: boolean;
  description: string;
  default?: string;
  example?: string;
}

interface BuilderMetadata {
  name: string;
  description: string;
  params: ParamMetadata[];
  returnType: string;
  example?: string;
  snippet: {
    prefix: string;
    body: string[];
    description: string;
  };
}

interface HandlerMetadata {
  name: string;
  displayName: string;
  description: string;
  discriminator: string;
  commonFields: string[];
  caddyDocsPath: string;
}

interface ExtensionAssets {
  version: string;
  generatedAt: string;
  builders: Record<string, BuilderMetadata>;
  handlers: Record<string, HandlerMetadata>;
}

// ============================================================================
// TypeScript AST Utilities
// ============================================================================

function createProgram(filePaths: string[]): ts.Program {
  const configPath = join(ROOT_DIR, "tsconfig.json");
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, ROOT_DIR);

  return ts.createProgram(filePaths, parsedConfig.options);
}

function getJSDocComment(node: ts.Node): string {
  const jsDocTags = ts.getJSDocCommentsAndTags(node);
  for (const tag of jsDocTags) {
    if (ts.isJSDoc(tag) && tag.comment) {
      if (typeof tag.comment === "string") {
        return tag.comment;
      }
      // Handle JSDocComment[] case
      return tag.comment.map((c) => (ts.isJSDocText(c) ? c.text : "")).join("");
    }
  }
  return "";
}

function getJSDocTag(node: ts.Node, tagName: string): string | undefined {
  const jsDocTags = ts.getJSDocCommentsAndTags(node);
  for (const tag of jsDocTags) {
    if (ts.isJSDoc(tag) && tag.tags) {
      for (const t of tag.tags) {
        if (t.tagName.text === tagName && t.comment) {
          if (typeof t.comment === "string") {
            return t.comment;
          }
          return t.comment.map((c) => (ts.isJSDocText(c) ? c.text : "")).join("");
        }
      }
    }
  }
  return undefined;
}

function getJSDocExample(node: ts.Node): string | undefined {
  const example = getJSDocTag(node, "example");
  if (example) {
    // Extract code from markdown code block
    const match = example.match(/```(?:typescript|ts)?\s*([\s\S]*?)```/);
    return match ? match[1].trim() : example.trim();
  }
  return undefined;
}

function typeToString(type: ts.TypeNode | undefined, checker: ts.TypeChecker): string {
  if (!type) return "unknown";
  return type.getText();
}

// ============================================================================
// Interface Extraction
// ============================================================================

function extractInterfaceParams(
  sourceFile: ts.SourceFile,
  interfaceName: string,
  checker: ts.TypeChecker
): ParamMetadata[] {
  const params: ParamMetadata[] = [];

  function visit(node: ts.Node) {
    if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
      for (const member of node.members) {
        if (ts.isPropertySignature(member) && member.name) {
          const name = member.name.getText();
          const type = typeToString(member.type, checker);
          const required = !member.questionToken;
          const description = getJSDocComment(member);
          const defaultValue = getJSDocTag(member, "default");
          const example = getJSDocTag(member, "example");

          params.push({
            name,
            type,
            required,
            description,
            ...(defaultValue && { default: defaultValue.replace(/^"(.*)"$/, "$1") }),
            ...(example && { example: example.replace(/^"(.*)"$/, "$1") }),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return params;
}

// ============================================================================
// Builder Function Extraction
// ============================================================================

function extractBuilderFunctions(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker
): BuilderMetadata[] {
  const builders: BuilderMetadata[] = [];

  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name) {
      const funcName = node.name.text;

      // Only process exported build* functions -- a module-private helper
      // (e.g. buildServiceMetadataHeadersHandler) can't be imported, so a
      // snippet or hover for it would be a dead end.
      const exported = (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0;
      if (!funcName.startsWith("build") || !exported) {
        ts.forEachChild(node, visit);
        return;
      }

      const description = getJSDocComment(node);
      const example = getJSDocExample(node);

      // Get options interface name from first parameter
      let optionsInterfaceName = "";
      let params: ParamMetadata[] = [];

      if (node.parameters.length > 0) {
        const firstParam = node.parameters[0];
        if (firstParam.type && ts.isTypeReferenceNode(firstParam.type)) {
          optionsInterfaceName = firstParam.type.typeName.getText();
          params = extractInterfaceParams(sourceFile, optionsInterfaceName, checker);
        }
        // Options declared in another file, as a type alias, or as z.infer<>:
        // ask the type checker instead of only scanning this file's interfaces.
        if (params.length === 0) {
          params = extractParamsFromType(firstParam, checker);
        }
      }

      // Get return type
      let returnType = "unknown";
      if (node.type) {
        returnType = node.type.getText();
      }

      // Generate snippet
      const snippet = generateSnippet(funcName, params, node.parameters[0], checker);

      builders.push({
        name: funcName,
        description,
        params,
        returnType,
        ...(example && { example }),
        snippet,
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return builders;
}

function extractParamsFromType(
  param: ts.ParameterDeclaration,
  checker: ts.TypeChecker
): ParamMetadata[] {
  const type = checker.getNonNullableType(checker.getTypeAtLocation(param));
  return checker.getPropertiesOfType(type).map((prop) => {
    const propType = checker.getTypeOfSymbolAtLocation(prop, param);
    const tags = prop.getJsDocTags(checker);
    const tagText = (name: string): string | undefined => {
      const tag = tags.find((t) => t.name === name);
      return tag?.text?.map((t) => t.text).join("");
    };
    const defaultValue = tagText("default");
    const example = tagText("example");
    return {
      name: prop.getName(),
      type: checker.typeToString(checker.getNonNullableType(propType)),
      required: (prop.flags & ts.SymbolFlags.Optional) === 0,
      description: ts.displayPartsToString(prop.getDocumentationComment(checker)),
      ...(defaultValue && { default: defaultValue.replace(/^"(.*)"$/, "$1") }),
      ...(example && { example: example.replace(/^"(.*)"$/, "$1") }),
    };
  });
}

/**
 * Builds TypeScript literal text for a value of `type`, with VS Code snippet
 * tabstops. Strings are quoted, arrays/objects are expanded from their element
 * / required-property types, so the snippet accepted with its defaults
 * type-checks against the real builder (see
 * src/__tests__/vscode-builder-snippets.test.ts).
 */
class SnippetValueWriter {
  private tabstop = 1;

  constructor(
    private readonly checker: ts.TypeChecker,
    private readonly location: ts.Node,
    private readonly funcName: string
  ) {}

  next(): number {
    return this.tabstop++;
  }

  write(
    type: ts.Type,
    name: string,
    preferred: string | undefined,
    depth = 0,
    context = ""
  ): string {
    const where = `${this.funcName} ${context}`;
    const checker = this.checker;
    const t = checker.getNonNullableType(type);
    const parts = t.isUnion() ? t.types : [t];

    // String literal union -> choice
    if (parts.length > 1 && parts.every((p) => p.isStringLiteral())) {
      const values = parts.map((p) => (p as ts.StringLiteralType).value);
      const ordered =
        preferred && values.includes(preferred)
          ? [preferred, ...values.filter((v) => v !== preferred)]
          : values;
      return `"\${${this.next()}|${ordered.map(escapeChoice).join(",")}|}"`;
    }
    if (parts.length === 1 && parts[0].isStringLiteral()) {
      return JSON.stringify((parts[0] as ts.StringLiteralType).value);
    }
    if (parts.length === 1 && parts[0].isNumberLiteral()) {
      return String((parts[0] as ts.NumberLiteralType).value);
    }

    const has = (flag: ts.TypeFlags): boolean => parts.some((p) => (p.flags & flag) !== 0);
    if (has(ts.TypeFlags.StringLike)) {
      return `"\${${this.next()}:${escapePlaceholder(preferred ?? placeholderFor(name, where))}}"`;
    }
    if (has(ts.TypeFlags.NumberLike)) {
      const n = preferred && /^-?\d+(\.\d+)?$/.test(preferred) ? preferred : numberFor(name, where);
      return `\${${this.next()}:${n}}`;
    }
    if (has(ts.TypeFlags.BooleanLike)) {
      return preferred === "false"
        ? `\${${this.next()}|false,true|}`
        : `\${${this.next()}|true,false|}`;
    }

    const obj = parts.find((p) => (p.flags & ts.TypeFlags.Object) !== 0);
    if (obj) {
      if (checker.isArrayType(obj) || checker.isTupleType(obj)) {
        const [elem] = checker.getTypeArguments(obj as ts.TypeReference);
        if (!elem) return "[]";
        const singular = name.replace(/ies$/, "y").replace(/s$/, "");
        return `[${this.write(elem, singular, preferred, depth + 1, `${context} ${name}`)}]`;
      }
      if (obj.getCallSignatures().length > 0) return "() => {}";
      const required = checker
        .getPropertiesOfType(obj)
        .filter((p) => (p.flags & ts.SymbolFlags.Optional) === 0);
      if (required.length === 0 || depth >= 3) return "{}";
      const fields = required.map((p) => {
        const pt = checker.getTypeOfSymbolAtLocation(p, this.location);
        const nested = this.write(pt, p.getName(), undefined, depth + 1, `${context} ${name}`);
        return `${propertyKey(p.getName())}: ${nested}`;
      });
      return `{ ${fields.join(", ")} }`;
    }
    return "{}";
  }
}

function propertyKey(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
}

function escapePlaceholder(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\$/g, "\\$")
    .replace(/\}/g, "\\}")
    .replace(/"/g, '\\"');
}

function escapeChoice(text: string): string {
  return text.replace(/[,|\\$}]/g, (c) => `\\${c}`);
}

function generateSnippet(
  funcName: string,
  params: ParamMetadata[],
  optionsParam: ts.ParameterDeclaration | undefined,
  checker: ts.TypeChecker
): { prefix: string; body: string[]; description: string } {
  // Convert camelCase to kebab-case for prefix
  // Preserve common acronyms before splitting on capitals
  const prefix = funcName
    .replace(/^build/, "caddy-")
    .replace(/OAuth/g, "oauth")
    .replace(/Oidc/g, "oidc")
    .replace(/OIDC/g, "oidc")
    .replace(/Ldap/g, "ldap")
    .replace(/LDAP/g, "ldap")
    .replace(/Sso/g, "sso")
    .replace(/SSO/g, "sso")
    .replace(/([A-Z])/g, "-$1")
    .toLowerCase()
    .replace(/--/g, "-");

  const body: string[] = [];
  const declaration = optionsParam?.parent;
  const allParams =
    declaration && ts.isFunctionDeclaration(declaration) ? [...declaration.parameters] : [];
  const firstType = optionsParam
    ? checker.getNonNullableType(checker.getTypeAtLocation(optionsParam))
    : undefined;
  const primitiveFlags =
    ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike;
  const isPositional =
    firstType !== undefined &&
    (firstType.isUnion() ? firstType.types : [firstType]).every(
      (t) => (t.flags & primitiveFlags) !== 0
    );

  if (!optionsParam) {
    body.push(`${funcName}()$0`);
  } else if (isPositional) {
    // e.g. buildReverseProxyHandler(dial, options?): positional primitives.
    const writer = new SnippetValueWriter(checker, optionsParam, funcName);
    const required = allParams.filter((p) => !p.questionToken && !p.initializer);
    const shown = required.length > 0 ? required : allParams.slice(0, 1);
    const args = shown.map((p) => {
      const literalDefault =
        p.initializer && ts.isStringLiteral(p.initializer) ? p.initializer.text : undefined;
      return writer.write(checker.getTypeAtLocation(p), p.name.getText(), literalDefault);
    });
    body.push(`${funcName}(${args.join(", ")})$0`);
  } else {
    const writer = new SnippetValueWriter(checker, optionsParam, funcName);
    const optionsType = checker.getNonNullableType(checker.getTypeAtLocation(optionsParam));
    const byName = new Map(checker.getPropertiesOfType(optionsType).map((p) => [p.getName(), p]));

    // Required options always; when there are none, the documented-default
    // options (max 3) so the snippet still shows how the builder is used.
    let chosen = params.filter((p) => p.required);
    if (chosen.length === 0) {
      const withDefault = params.filter((p) => p.default !== undefined);
      chosen = (withDefault.length > 0 ? withDefault : params).slice(0, 3);
    }

    body.push(`${funcName}({`);
    for (const param of chosen) {
      const symbol = byName.get(param.name);
      if (!symbol) continue;
      const type = checker.getTypeOfSymbolAtLocation(symbol, optionsParam);
      body.push(`  ${propertyKey(param.name)}: ${writer.write(type, param.name, param.default)},`);
    }
    const omitted = params.filter((p) => !chosen.includes(p)).map((p) => p.name);
    if (omitted.length > 0) {
      const list = omitted.slice(0, 6).join(", ") + (omitted.length > 6 ? ", ..." : "");
      body.push(`  // optional: ${list}`);
    }
    body.push("})$0");
  }

  // Get description from function name
  // Use lowercase placeholders to preserve acronyms during camelCase splitting
  const description = funcName
    .replace(/^build/, "Build")
    .replace(/OAuth2/g, " xoauth2x")
    .replace(/Oidc/g, " xoidcx")
    .replace(/Ldap/g, " xldapx")
    .replace(/LDAP/g, " xldapx")
    .replace(/SSO/g, " xssox")
    .replace(/Sso/g, " xssox")
    .replace(/([A-Z])/g, " $1")
    .replace(/xoauth2x/g, "OAuth2")
    .replace(/xoidcx/g, "OIDC")
    .replace(/xldapx/g, "LDAP")
    .replace(/xssox/g, "SSO")
    .replace(/\s+/g, " ")
    .trim();

  return { prefix, body, description };
}

function placeholderFor(name: string, funcName: string): string {
  const n = name.toLowerCase();
  if (n === "path") {
    return /IdentityStore|identityStore/.test(funcName) ? "/etc/caddy/users.json" : "/api/*";
  }
  if (n === "dial") return "localhost:3000";
  if (n === "realm") return "local";
  if (n === "address") return "ldap.example.com";
  if (n === "clientid") return "your-client-id";
  if (n === "clientsecret") return "your-client-secret";
  if (n === "metadataurl" || n === "discoveryurl") return "https://idp.example.com";
  if (n === "provider") return "github";
  if (n === "portalname") return "myportal";
  if (n === "gatekeepername") return "mypolicy";
  if (n === "bindusername") return "cn=admin,dc=example,dc=com";
  if (n === "bindpassword") return "change-me";
  if (n === "searchbasedn") return "ou=users,dc=example,dc=com";
  if (n === "root" || n === "fileroot") return "/var/www/html";
  if (n === "pathprefix") return "/app";
  if (n === "to" || n.endsWith("url")) return "https://example.com";
  if (n === "upstream") return "localhost:3000";
  if (n.includes("upstreamhost")) return "localhost";
  if (n.includes("host") || n.includes("domain")) return "example.com";
  if (n === "source") return "{http.request.host}";
  if (n === "name" && /Portal|portal/.test(funcName)) return "myportal";
  if (n === "name" && /Polic|polic/.test(funcName)) return "mypolicy";
  if (n === "name" && /IdentityStore|identityStore/.test(funcName)) return "local";
  if (n === "prefix") return "/api";
  if (n === "tag") return "production";
  if (n === "projectid") return "my-project";
  if (n === "allowedorigin") return "*";
  if (n.includes("name")) return "my-name";
  if (n.includes("id")) return "my-id";
  if (n === "maxsize") return "10MB";
  return name;
}

function numberFor(name: string, funcName: string): string {
  const n = name.toLowerCase();
  if (n === "statuscode" || n === "status") return /Redirect/.test(funcName) ? "301" : "404";
  if (n.includes("port")) return /Ldap/.test(funcName) ? "389" : "3000";
  if (n === "maxsize") return "10485760";
  if (n === "priority") return "0";
  return "1";
}

// ============================================================================
// Handler Type Extraction
// ============================================================================

function extractHandlerTypes(sourceFile: ts.SourceFile): HandlerMetadata[] {
  const handlers: HandlerMetadata[] = [];

  // Known handler mappings for better metadata
  const handlerInfo: Record<
    string,
    { displayName: string; description: string; caddyDocsPath: string }
  > = {
    reverse_proxy: {
      displayName: "Reverse Proxy",
      description: "Proxy requests to upstream backend servers with load balancing",
      caddyDocsPath: "/docs/json/apps/http/servers/routes/handle/reverse_proxy/",
    },
    headers: {
      displayName: "Headers",
      description: "Modify request and response headers",
      caddyDocsPath: "/docs/json/apps/http/servers/routes/handle/headers/",
    },
    static_response: {
      displayName: "Static Response",
      description: "Return a static response without proxying",
      caddyDocsPath: "/docs/json/apps/http/servers/routes/handle/static_response/",
    },
    authentication: {
      displayName: "Authentication",
      description: "HTTP Basic authentication or custom auth providers",
      caddyDocsPath: "/docs/json/apps/http/servers/routes/handle/authentication/",
    },
    rewrite: {
      displayName: "Rewrite",
      description: "Rewrite the request URI before processing",
      caddyDocsPath: "/docs/json/apps/http/servers/routes/handle/rewrite/",
    },
    encode: {
      displayName: "Encode",
      description: "Compress responses with gzip, zstd, or brotli",
      caddyDocsPath: "/docs/json/apps/http/servers/routes/handle/encode/",
    },
    subroute: {
      displayName: "Subroute",
      description: "Process requests through nested routes",
      caddyDocsPath: "/docs/json/apps/http/servers/routes/handle/subroute/",
    },
    file_server: {
      displayName: "File Server",
      description: "Serve static files from disk",
      caddyDocsPath: "/docs/json/apps/http/servers/routes/handle/file_server/",
    },
    templates: {
      displayName: "Templates",
      description: "Render Go templates in responses",
      caddyDocsPath: "/docs/json/apps/http/servers/routes/handle/templates/",
    },
    map: {
      displayName: "Map",
      description: "Map input to output values for use in other handlers",
      caddyDocsPath: "/docs/json/apps/http/servers/routes/handle/map/",
    },
    push: {
      displayName: "HTTP/2 Push",
      description: "Push resources to clients over HTTP/2",
      caddyDocsPath: "/docs/json/apps/http/servers/routes/handle/push/",
    },
    request_body: {
      displayName: "Request Body",
      description: "Configure request body size limits",
      caddyDocsPath: "/docs/json/apps/http/servers/routes/handle/request_body/",
    },
    vars: {
      displayName: "Variables",
      description: "Set variables for use in other handlers",
      caddyDocsPath: "/docs/json/apps/http/servers/routes/handle/vars/",
    },
    intercept: {
      displayName: "Intercept",
      description: "Intercept and modify responses from upstreams",
      caddyDocsPath: "/docs/json/apps/http/servers/routes/handle/intercept/",
    },
    invoke: {
      displayName: "Invoke",
      description: "Invoke a named route by reference",
      caddyDocsPath: "/docs/json/apps/http/servers/routes/handle/invoke/",
    },
    tracing: {
      displayName: "Tracing",
      description: "Add distributed tracing spans",
      caddyDocsPath: "/docs/json/apps/http/servers/routes/handle/tracing/",
    },
    log_append: {
      displayName: "Log Append",
      description: "Append custom fields to access logs",
      caddyDocsPath: "/docs/json/apps/http/servers/routes/handle/log_append/",
    },
    error: {
      displayName: "Error",
      description: "Trigger an error response",
      caddyDocsPath: "/docs/json/apps/http/servers/routes/handle/error/",
    },
    copy_response: {
      displayName: "Copy Response",
      description: "Copy response from another handler",
      caddyDocsPath: "/docs/json/apps/http/servers/routes/handle/copy_response/",
    },
    copy_response_headers: {
      displayName: "Copy Response Headers",
      description: "Copy specific headers from another response",
      caddyDocsPath: "/docs/json/apps/http/servers/routes/handle/copy_response_headers/",
    },
    authenticator: {
      displayName: "Authenticator (caddy-security)",
      description: "Serve authentication portal for caddy-security plugin",
      caddyDocsPath: "https://github.com/greenpau/caddy-security",
    },
  };

  // Extract handler interface definitions
  function visit(node: ts.Node) {
    if (ts.isInterfaceDeclaration(node)) {
      const name = node.name.text;

      // Look for handler interfaces
      if (name.endsWith("Handler")) {
        // Find the handler discriminator
        for (const member of node.members) {
          if (
            ts.isPropertySignature(member) &&
            member.name &&
            member.name.getText() === "handler"
          ) {
            if (member.type && ts.isLiteralTypeNode(member.type)) {
              const literal = member.type.literal;
              if (ts.isStringLiteral(literal)) {
                const discriminator = literal.text;
                const info = handlerInfo[discriminator] || {
                  displayName: name.replace("Handler", ""),
                  description: getJSDocComment(node) || `${name} handler`,
                  caddyDocsPath: `/docs/json/apps/http/servers/routes/handle/${discriminator}/`,
                };

                // Extract common fields (non-handler properties)
                const commonFields: string[] = [];
                for (const m of node.members) {
                  if (ts.isPropertySignature(m) && m.name) {
                    const fieldName = m.name.getText();
                    if (fieldName !== "handler") {
                      commonFields.push(fieldName);
                    }
                  }
                }

                handlers.push({
                  name: discriminator,
                  displayName: info.displayName,
                  description: info.description,
                  discriminator,
                  commonFields: commonFields.slice(0, 5), // Top 5 fields
                  caddyDocsPath: info.caddyDocsPath,
                });
              }
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return handlers;
}

// ============================================================================
// Main Generation Logic
// ============================================================================

function generateExtensionAssets(): ExtensionAssets {
  const filesToParse = [
    join(ROOT_DIR, "src/plugins/caddy-security/builders.ts"),
    join(ROOT_DIR, "src/plugins/caddy-security/types.ts"),
    join(ROOT_DIR, "src/caddy/routes.ts"),
    join(ROOT_DIR, "src/caddy/helpers.ts"),
    join(ROOT_DIR, "src/types.ts"),
  ];

  // Filter to existing files
  const existingFiles = filesToParse.filter((f) => existsSync(f));
  const program = createProgram(existingFiles);
  const checker = program.getTypeChecker();

  const allBuilders: Record<string, BuilderMetadata> = {};
  const allHandlers: Record<string, HandlerMetadata> = {};

  for (const filePath of existingFiles) {
    const sourceFile = program.getSourceFile(filePath);
    if (!sourceFile) continue;

    // Extract builders from builder files
    if (
      filePath.includes("builders.ts") ||
      filePath.includes("routes.ts") ||
      filePath.includes("helpers.ts")
    ) {
      const builders = extractBuilderFunctions(sourceFile, checker);
      for (const builder of builders) {
        allBuilders[builder.name] = builder;
      }
    }

    // Extract handlers from types files
    if (filePath.includes("types.ts")) {
      const handlers = extractHandlerTypes(sourceFile);
      for (const handler of handlers) {
        allHandlers[handler.name] = handler;
      }
    }
  }

  // Read package.json for version
  const pkgJson = JSON.parse(readFileSync(join(ROOT_DIR, "package.json"), "utf-8"));

  return {
    version: pkgJson.version,
    // SOURCE_DATE_EPOCH (reproducible-builds convention) pins the timestamp:
    // the upstream update cycle regenerates twice and diffs the results.
    generatedAt: (process.env.SOURCE_DATE_EPOCH
      ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000)
      : new Date()
    ).toISOString(),
    builders: allBuilders,
    handlers: allHandlers,
  };
}

function generateOutputFile(assets: ExtensionAssets): string {
  return `/**
 * Extension assets for VSCode extension and tooling
 *
 * AUTO-GENERATED FILE - DO NOT EDIT
 * Generated from source files by scripts/extract-metadata.ts
 * Run: npm run generate:extension
 *
 * @generated
 * @version ${assets.version}
 * @generatedAt ${assets.generatedAt}
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
export const METADATA_VERSION = "${assets.version}";

/**
 * Timestamp when this metadata was generated
 */
export const GENERATED_AT = "${assets.generatedAt}";

/**
 * Builder function metadata extracted from JSDoc and type definitions
 *
 * Use this for:
 * - Generating VSCode snippets
 * - Powering wizard step generation
 * - Providing hover documentation
 */
export const BUILDER_METADATA: Record<string, BuilderMetadata> = ${JSON.stringify(assets.builders, null, 2)};

/**
 * Handler type metadata for Caddy route handlers
 *
 * Use this for:
 * - Autocomplete for handler discriminator
 * - Hover documentation with Caddy docs links
 * - Handler-specific field suggestions
 */
export const HANDLER_METADATA: Record<string, HandlerMetadata> = ${JSON.stringify(assets.handlers, null, 2)};

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
export function getVSCodeSnippets(): Record<string, { prefix: string; body: string[]; description: string }> {
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
export function getHandlerCompletions(): Array<{ label: string; detail: string; documentation: string }> {
  return Object.values(HANDLER_METADATA).map((handler) => ({
    label: handler.name,
    detail: handler.displayName,
    documentation: handler.description,
  }));
}
`;
}

// ============================================================================
// Entry Point
// ============================================================================

console.log("Extracting metadata for extension assets...\n");

try {
  const assets = generateExtensionAssets();

  console.log(`Found ${Object.keys(assets.builders).length} builder functions:`);
  for (const name of Object.keys(assets.builders)) {
    console.log(`  - ${name}`);
  }

  console.log(`\nFound ${Object.keys(assets.handlers).length} handler types:`);
  for (const name of Object.keys(assets.handlers)) {
    console.log(`  - ${name}`);
  }

  const output = generateOutputFile(assets);
  writeFileSync(OUTPUT_FILE, output);

  console.log(`\n✓ Generated ${OUTPUT_FILE}`);
} catch (error) {
  console.error("Failed to generate extension assets:", error);
  process.exit(1);
}
