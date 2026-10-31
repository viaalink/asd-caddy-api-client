/**
 * Generate VSCode snippets from library metadata and templates
 *
 * This script imports the extension-assets from the library and generates
 * VSCode snippet files for both TypeScript builders and JSON configurations.
 *
 * IMPORTANT: Security snippets are generated from templates.ts which is the
 * SINGLE SOURCE OF TRUTH. All templates are validated by templates.test.ts.
 * This ensures every snippet produces valid configuration.
 *
 * @see src/plugins/caddy-security/templates.ts - Template definitions
 * @see src/__tests__/templates.test.ts - Template validation tests
 */

const fs = require("fs");
const path = require("path");

// Import paths for built library
const assetsPath = path.join(__dirname, "../../dist/generated/extension-assets.js");
const caddySecurityPath = path.join(__dirname, "../../dist/plugins/caddy-security/index.js");

async function generateSnippets() {
  // Dynamic import for ESM modules
  const { BUILDER_METADATA, HANDLER_METADATA } = await import(assetsPath);

  // Try to import templates from caddy-security module
  let SECURITY_TEMPLATES = [];
  try {
    const caddySecurity = await import(caddySecurityPath);
    SECURITY_TEMPLATES = caddySecurity.SECURITY_TEMPLATES || [];
  } catch (e) {
    console.warn(
      "⚠ Could not import templates from caddy-security - security snippets will use fallback"
    );
    console.warn("  Error:", e.message);
  }

  // ============================================================================
  // Generate TypeScript/JavaScript builder snippets
  // ============================================================================
  const builderSnippets = {};

  for (const [name, builder] of Object.entries(BUILDER_METADATA)) {
    builderSnippets[builder.snippet.description] = {
      prefix: builder.snippet.prefix,
      body: builder.snippet.body,
      description: builder.description.split("\n")[0], // First line only
    };
  }

  // ============================================================================
  // Generate TypeScript snippets from templates (SINGLE SOURCE OF TRUTH)
  // ============================================================================
  if (SECURITY_TEMPLATES.length > 0) {
    console.log(`\n📦 Generating ${SECURITY_TEMPLATES.length} security snippets from templates.ts`);

    for (const template of SECURITY_TEMPLATES) {
      // Create TypeScript snippet
      const tsSnippetName = `Caddy Security: ${template.name}`;
      builderSnippets[tsSnippetName] = {
        prefix: template.id,
        body: template.snippet,
        description: template.description,
      };
    }
  }

  // ============================================================================
  // JSON configuration snippets
  // ============================================================================
  // Source of truth: src/snippets/json-snippets.json (also used by the Insert
  // Route / Insert Security Config commands). Each entry names the schema it
  // must validate against; src/__tests__/vscode-json-snippets.test.ts expands
  // every snippet with its defaults and validates it, so a snippet can't ship
  // in a shape the extension's own diagnostics would reject.
  const jsonSnippets = {};
  const jsonSource = require("../src/snippets/json-snippets.json");
  for (const snippet of jsonSource) {
    jsonSnippets[snippet.name] = {
      prefix: snippet.prefix,
      body: snippet.body,
      description: snippet.description,
    };
  }

  // ============================================================================
  // Write snippet files
  // ============================================================================
  const snippetsDir = path.join(__dirname, "../snippets");
  fs.mkdirSync(snippetsDir, { recursive: true });

  fs.writeFileSync(
    path.join(snippetsDir, "caddy-builders.json"),
    JSON.stringify(builderSnippets, null, 2)
  );
  console.log("✓ Generated caddy-builders.json");

  fs.writeFileSync(
    path.join(snippetsDir, "caddy-json.json"),
    JSON.stringify(jsonSnippets, null, 2)
  );
  console.log("✓ Generated caddy-json.json");

  // Summary
  const builderCount = Object.keys(builderSnippets).length;
  const jsonCount = Object.keys(jsonSnippets).length;
  const templateCount = SECURITY_TEMPLATES.length;

  console.log(
    `\nGenerated ${builderCount} builder snippets (including ${templateCount} from templates)`
  );
  console.log(`Generated ${jsonCount} JSON snippets`);

  // Validation reminder
  if (templateCount > 0) {
    console.log("\n✅ Security snippets are backed by validated templates (templates.test.ts)");
  }
}

generateSnippets().catch(console.error);
