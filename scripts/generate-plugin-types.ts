/**
 * Generate TypeScript types and Zod schemas for Caddy plugins
 *
 * This script:
 * 1. Runs tygo in each plugin's local directory to generate TypeScript types
 * 2. Runs ts-to-zod to generate Zod schemas from the TypeScript types
 */

import { execFileSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, "..");
const LOCAL_DIR = join(ROOT_DIR, "local");
const GENERATED_DIR = join(ROOT_DIR, "src/generated/plugins");

// Plugin configurations
interface PluginConfig {
  name: string;
  localPath: string;
  outputFile: string;
  /** Multiple output files (e.g., go-authcrunch generates many files) */
  multiFile?: boolean;
  /**
   * tygo config tracked in this repo (path relative to the repo root), used
   * instead of `local/<localPath>/tygo.yaml`, which lives in the gitignored
   * clone. tygo still runs from the clone, so its output paths are relative to it.
   */
  tygoConfig?: string;
  /** Extra output files (besides `outputFile`) that also get a Zod schema. */
  extraOutputFiles?: string[];
  /**
   * Drop `export const` lines after tygo ran: Go runtime constants (byte sizes,
   * opcodes, default timeouts) are not config and often aren't valid TypeScript.
   */
  stripConstants?: boolean;
}

/** The caddy-l4 modules generated next to the core `layer4` package. */
const CADDY_L4_MODULES = [
  "clock",
  "close",
  "dns",
  "echo",
  "http",
  "openvpn",
  "postgres",
  "proxy",
  "proxyprotocol",
  "quic",
  "rdp",
  "regexp",
  "remoteiplist",
  "socks",
  "ssh",
  "subroute",
  "tee",
  "throttle",
  "tls",
  "vars",
  "winbox",
  "wireguard",
  "xmpp",
];

const plugins: PluginConfig[] = [
  {
    name: "caddy-security",
    localPath: "caddy-security",
    outputFile: "caddy-security",
  },
  {
    name: "go-authcrunch",
    localPath: "go-authcrunch",
    outputFile: "authcrunch-core", // Main file, but generates many
    multiFile: true, // Generates multiple authcrunch-*.ts files
  },
  // caddy-dns/* providers: the real JSON-tagged struct lives in the
  // libdns/* package each wrapper embeds (`*libdns.Provider`), not in the
  // thin caddy-dns/* wrapper repo itself — so these point at libdns/*.
  {
    name: "caddy-dns-porkbun",
    localPath: "libdns-porkbun",
    outputFile: "caddy-dns-porkbun",
  },
  {
    name: "caddy-dns-cloudflare",
    localPath: "libdns-cloudflare",
    outputFile: "caddy-dns-cloudflare",
  },
  {
    name: "caddy-dns-route53-libdns",
    localPath: "libdns-route53",
    outputFile: "caddy-dns-route53-libdns",
  },
  // route53's wrapper adds one field of its own (debug_logging) on top of
  // the embedded libdns/route53 fields — generated separately since it's a
  // different Go module tygo can't cross-resolve into automatically.
  {
    name: "caddy-dns-route53-wrapper",
    localPath: "caddy-dns-route53",
    outputFile: "caddy-dns-route53-wrapper",
  },
  {
    name: "caddy-dns-digitalocean",
    localPath: "libdns-digitalocean",
    outputFile: "caddy-dns-digitalocean",
  },
  {
    name: "caddy-dns-godaddy",
    localPath: "libdns-godaddy",
    outputFile: "caddy-dns-godaddy",
  },
  // caddy-l4 (layer4 app): one generated file per Go package, since the
  // modules reuse type names (Handler, MatchRegexp, ...).
  {
    name: "caddy-l4",
    localPath: "caddy-l4",
    tygoConfig: "scripts/tygo/caddy-l4.yaml",
    outputFile: "caddy-l4-core",
    extraOutputFiles: CADDY_L4_MODULES.map((m) => `caddy-l4-${m}`),
    stripConstants: true,
  },
];

// `--only caddy-l4` (repeatable, or comma-separated) regenerates just those
// plugins, so other generated files don't churn.
const onlyArgs = process.argv.flatMap((arg, i, all) =>
  arg === "--only" && all[i + 1] ? all[i + 1].split(",") : []
);
const selectedPlugins =
  onlyArgs.length > 0 ? plugins.filter((p) => onlyArgs.includes(p.name)) : plugins;
if (onlyArgs.length > 0 && selectedPlugins.length !== onlyArgs.length) {
  console.error(`Unknown plugin in --only: ${onlyArgs.join(", ")}`);
  process.exit(1);
}

function outputFilesOf(plugin: PluginConfig): string[] {
  return [plugin.outputFile, ...(plugin.extraOutputFiles ?? [])];
}

/**
 * Clean up tygo output for one plugin:
 * - tygo's comment-merging artifact: a Go trailing comment (`//nolint:...`) on a
 *   field swallows the next field's `/**` opener (`foo?: string[]; //   /**`),
 *   which is a TypeScript syntax error. Split it back.
 * - optionally drop `export const` lines (see `stripConstants`).
 */
function postProcess(plugin: PluginConfig): void {
  for (const file of outputFilesOf(plugin)) {
    const path = join(GENERATED_DIR, `${file}.ts`);
    if (!existsSync(path)) continue;
    const fixed = readFileSync(path, "utf-8").replace(
      /;[ \t]*\/\/[^\n]*\/\*\*[ \t]*$/gm,
      ";\n  /**"
    );
    const lines = fixed.split("\n");
    const kept: string[] = [];
    for (const line of lines) {
      if (plugin.stripConstants && line.startsWith("export const ")) {
        // Also drop the doc comment that described the constant.
        while (kept.length > 0 && /^(\/\*\*| \*)/.test(kept[kept.length - 1])) kept.pop();
        continue;
      }
      kept.push(line);
    }
    writeFileSync(path, kept.join("\n").replace(/\n{3,}/g, "\n\n"));
  }
}

function findTygo(): string {
  // Try common locations
  const home = process.env.HOME || "";
  const locations = [join(home, "go/bin/tygo"), "/usr/local/go/bin/tygo"];

  for (const loc of locations) {
    if (existsSync(loc)) {
      return loc;
    }
  }

  throw new Error("tygo not found. Install with: go install github.com/gzuidhof/tygo@latest");
}

function generateTypesForPlugin(plugin: PluginConfig, tygoPath: string): boolean {
  const pluginDir = join(LOCAL_DIR, plugin.localPath);
  const tygoConfig = plugin.tygoConfig
    ? join(ROOT_DIR, plugin.tygoConfig)
    : join(pluginDir, "tygo.yaml");

  if (!existsSync(pluginDir)) {
    console.log(`  - Skipping ${plugin.name} (directory not found: ${pluginDir})`);
    return false;
  }

  if (!existsSync(tygoConfig)) {
    console.log(`  - Skipping ${plugin.name} (tygo.yaml not found)`);
    return false;
  }

  try {
    execFileSync(tygoPath, ["--config", tygoConfig, "generate"], {
      cwd: pluginDir,
      stdio: "pipe",
    });
    postProcess(plugin);
    console.log(`  ✓ Generated TypeScript types for ${plugin.name}`);
    return true;
  } catch (error) {
    console.error(`  ✗ Failed to generate types for ${plugin.name}`);
    if (error instanceof Error) {
      console.error(`    ${error.message}`);
    }
    return false;
  }
}

function generateZodSchema(plugin: PluginConfig, file: string = plugin.outputFile): boolean {
  const inputFile = join(GENERATED_DIR, `${file}.ts`);

  // Use relative paths from ROOT_DIR for ts-to-zod
  const relativeInput = `src/generated/plugins/${file}.ts`;
  const relativeOutput = `src/generated/plugins/${file}.zod.ts`;

  if (!existsSync(inputFile)) {
    console.log(`  - Skipping Zod generation for ${plugin.name} (TypeScript file not found)`);
    return false;
  }

  try {
    execFileSync("npx", ["ts-to-zod", relativeInput, relativeOutput, "--skipValidation"], {
      cwd: ROOT_DIR,
      stdio: "inherit",
    });
    console.log(`  ✓ Generated Zod schema for ${file}`);
    return true;
  } catch {
    console.error(`  ✗ Failed to generate Zod schema for ${file}`);
    return false;
  }
}

function runScript(scriptPath: string, description: string): boolean {
  console.log(`\n${description}...`);
  try {
    execFileSync("npx", ["tsx", scriptPath], {
      cwd: ROOT_DIR,
      stdio: "inherit",
    });
    return true;
  } catch {
    console.error(`  ✗ Failed: ${description}`);
    return false;
  }
}

// Main execution
console.log("Generating plugin types...\n");

let tygoPath: string;
try {
  tygoPath = findTygo();
  console.log(`Using tygo at: ${tygoPath}\n`);
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}

console.log("Step 1: Generate TypeScript from Go source (tygo)");
for (const plugin of selectedPlugins) {
  generateTypesForPlugin(plugin, tygoPath);
}

console.log("\nStep 2: Resolve cross-package references");
if (!runScript(join(__dirname, "resolve-cross-refs.ts"), "Resolving cross-package references")) {
  process.exit(1);
}

console.log("\nStep 3: Generate Zod schemas from TypeScript (ts-to-zod)");
for (const plugin of selectedPlugins) {
  // Skip multiFile plugins - they're handled by generate-zod-schemas.ts
  if (!plugin.multiFile) {
    for (const file of outputFilesOf(plugin)) generateZodSchema(plugin, file);
  } else {
    console.log(
      `  - Skipping ${plugin.name} (multiFile - run generate:types for full Zod generation)`
    );
  }
}

console.log("\nDone!");
