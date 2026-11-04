/**
 * Unit tests for the pure parts of the upstream update cycle
 * (scripts/upstreams/lib.ts, Redmine #4160). The network/git half is
 * exercised by `just upstreams-check` / `just upstreams-update`.
 */
import { describe, test, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  ROOT_DIR,
  bumpKind,
  loadConfig,
  orderByDependency,
  parseConfig,
  parseGoModRequires,
  pickLatestTag,
  pseudoVersionCommit,
  renderSupportedCaddy,
  replaceSupportedCaddy,
  SUPPORTED_END,
  SUPPORTED_START,
  updateDocsRow,
  updateInstallCaddyDefault,
} from "../../scripts/upstreams/lib.js";

describe("pickLatestTag", () => {
  test("picks the highest stable semver tag matching the pattern", () => {
    const tags = ["v2.10.2", "v2.11.4", "v2.11.10", "v2.12.0-beta.1", "v1.9.9", "v3.0.0"];
    expect(pickLatestTag(tags, "^v2\\.\\d+\\.\\d+$")).toBe("v2.11.10");
  });
  test("ignores pre-releases even when the pattern allows them", () => {
    expect(pickLatestTag(["v1.0.0", "v1.1.0-rc1"], ".*")).toBe("v1.0.0");
  });
  test("undefined when nothing matches", () => {
    expect(pickLatestTag(["latest", "nightly"], ".*")).toBeUndefined();
  });
});

describe("bumpKind", () => {
  test.each([
    ["v1.1.64", "v1.6.2", "minor"],
    ["v2.11.4", "v2.11.8", "patch"],
    ["v0.2.2", "v1.0.0", "major"],
    ["v1.0.0", "v1.0.0", undefined],
    ["master", "master", undefined],
  ])("%s -> %s", (from, to, kind) => {
    expect(bumpKind(from, to)).toBe(kind);
  });
});

describe("go.mod", () => {
  const goMod = [
    "module github.com/greenpau/caddy-security",
    "",
    "go 1.25",
    "",
    "require (",
    "\tgithub.com/caddyserver/caddy/v2 v2.11.4",
    "\tgithub.com/greenpau/go-authcrunch v1.1.41 // indirect",
    ")",
    "",
    "require github.com/libdns/route53 v1.6.2",
  ].join("\n");

  test("parses block and single-line requires", () => {
    const req = parseGoModRequires(goMod);
    expect(req.get("github.com/caddyserver/caddy/v2")).toBe("v2.11.4");
    expect(req.get("github.com/greenpau/go-authcrunch")).toBe("v1.1.41");
    expect(req.get("github.com/libdns/route53")).toBe("v1.6.2");
  });

  test("pseudo-versions resolve to their commit prefix", () => {
    expect(pseudoVersionCommit("v0.0.0-20250606120000-dfa7af5c2e31")).toBe("dfa7af5c2e31");
    expect(pseudoVersionCommit("v1.6.2")).toBeUndefined();
  });
});

describe("updateDocsRow", () => {
  const pin = {
    ref: "v2.11.8",
    commit: "55996dfe05c10bb616ccdcc9bf5b8407a5be75b7",
    updated: "2026-11-04",
  };

  test("rewrites Version, Commit and Updated by column name", () => {
    const md = [
      "| Component | Version | Commit   | Updated    |",
      "| --------- | ------- | -------- | ---------- |",
      "| Caddy     | v2.11.4 | e2eee6a7 | 2026-08-11 |",
    ].join("\n");
    const r = updateDocsRow(md, "Caddy", pin, false);
    expect(r.rows).toBe(1);
    expect(r.text.split("\n")[2]).toBe("| Caddy | v2.11.8 | 55996dfe | 2026-11-04 |");
  });

  test("Version/commit column, keyed on a backticked first cell, pinned by commit", () => {
    const md = [
      "| Package | Upstream module | Version/commit | Updated |",
      "| --- | --- | --- | --- |",
      "| `local/libdns-digitalocean` | `github.com/libdns/digitalocean` | no tags — pinned to commit `dfa7af5` | 2026-08-11 |",
      "| `local/libdns-godaddy` | `github.com/libdns/godaddy` | `v1.1.0` | 2026-08-11 |",
    ].join("\n");
    const r = updateDocsRow(md, "local/libdns-digitalocean", pin, true);
    expect(r.rows).toBe(1);
    expect(r.text).toContain("no tags — pinned to commit `55996df` | 2026-11-04 |");
    expect(r.text).toContain("`v1.1.0` | 2026-08-11 |");
  });

  test("leaves other tables alone and reports a missing row", () => {
    expect(updateDocsRow("| a | Version |\n| - | - |\n| b | v1 |", "Caddy", pin, false).rows).toBe(
      0
    );
  });
});

describe("supported Caddy table", () => {
  test("renders between the markers, idempotently", () => {
    const md = `# x\n\n${SUPPORTED_START}\nold\n${SUPPORTED_END}\n\nafter\n`;
    const table = renderSupportedCaddy([
      { caddy: "v2.11.4", library: "0.9.0+", vscode: "0.2.0+", validation: "CI" },
    ]);
    const once = replaceSupportedCaddy(md, table);
    expect(once).toContain("| v2.11.4 | 0.9.0+ | 0.2.0+ | CI |");
    expect(once).not.toContain("old");
    expect(replaceSupportedCaddy(once, table)).toBe(once);
    expect(once.endsWith("after\n")).toBe(true);
  });

  test("throws without markers", () => {
    expect(() => replaceSupportedCaddy("# none", "t")).toThrow(/markers/);
  });
});

test("updateInstallCaddyDefault rewrites only the default version", () => {
  const yaml = [
    "inputs:",
    "  version:",
    "    description: Caddy version to install when none is on PATH",
    '    default: "2.11.4"',
  ].join("\n");
  expect(updateInstallCaddyDefault(yaml, "v2.11.8")).toContain('default: "2.11.8"');
});

describe("upstreams.json", () => {
  const config = loadConfig();

  test("parses, and gomod children come after their parent", () => {
    const order = orderByDependency(config.upstreams).map((u) => u.name);
    expect(order.indexOf("go-authcrunch")).toBeGreaterThan(order.indexOf("caddy-security"));
    expect(order.indexOf("libdns-route53")).toBeGreaterThan(order.indexOf("caddy-dns-route53"));
  });

  test("every upstream that generates code has a versioned tygo config", () => {
    const missing = config.upstreams
      .filter((u) => !existsSync(join(ROOT_DIR, u.tygoConfig)))
      .map((u) => u.name);
    expect(missing).toEqual([]);
  });

  test("tygo configs write into src/generated", () => {
    for (const u of config.upstreams) {
      const path = join(ROOT_DIR, u.tygoConfig);
      if (!existsSync(path)) continue;
      for (const m of readFileSync(path, "utf-8").matchAll(/output_path:\s*"([^"]+)"/g)) {
        expect(m[1]).toMatch(/^\.\.\/\.\.\/src\/generated\//);
      }
    }
  });

  test("the README tables are rendered from supportedCaddy", () => {
    const table = renderSupportedCaddy(config.supportedCaddy).split("\n")[2];
    for (const file of ["README.md", "vscode-extension/README.md"]) {
      const text = readFileSync(join(ROOT_DIR, file), "utf-8").replace(/ +\|/g, " |");
      expect(text).toContain(SUPPORTED_START);
      expect(text).toContain(table.replace(/ +\|/g, " |"));
    }
  });

  test("rejects a short commit and an unknown gomod parent", () => {
    const base = {
      name: "x",
      repo: "https://github.com/a/b",
      module: "github.com/a/b",
      localPath: "local/x",
      tygoConfig: "t.yaml",
      generator: "g",
      pin: { ref: "v1.0.0", commit: "abc", updated: "2026-01-01" },
      track: { type: "tag", pattern: ".*" },
    };
    expect(() => parseConfig(JSON.stringify({ upstreams: [base], supportedCaddy: [] }))).toThrow(
      /40-char/
    );
    const orphan = {
      ...base,
      pin: { ...base.pin, commit: "a".repeat(40) },
      track: { type: "gomod", parent: "nope" },
    };
    expect(() => parseConfig(JSON.stringify({ upstreams: [orphan], supportedCaddy: [] }))).toThrow(
      /unknown parent/
    );
  });
});
