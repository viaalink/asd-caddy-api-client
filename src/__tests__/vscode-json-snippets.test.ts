/**
 * Every JSON snippet the extension ships (vscode-extension/src/snippets/
 * json-snippets.json -> snippets/caddy-json.json, and the Insert Route /
 * Insert Security Config commands) must, when accepted with its defaults,
 * parse as JSON and validate against the schema the extension itself applies.
 * 0.2.0 shipped identity-store/portal/policy snippets in a shape
 * (driver/search_filter/cookie/access_lists) that its own validator rejected.
 */
import { describe, test, expect } from "vitest";
import { join } from "path";
import { existsSync, readFileSync } from "fs";
import { SimpleSchemaValidator } from "../../vscode-extension/src/providers/schema-validator.js";
import { expandSnippet, tabstopNumbers } from "./helpers/snippet-expand.js";
import JSON_SNIPPETS from "../../vscode-extension/src/snippets/json-snippets.json";

const validator = new SimpleSchemaValidator(join(__dirname, "../generated"));

function loadSchema(file: string): object {
  const p = join(__dirname, "../generated/schemas", file);
  return JSON.parse(readFileSync(p, "utf-8")) as object;
}

describe("snippet expansion helper", () => {
  test("defaults, nested defaults, choices, bare tabstops and escapes", () => {
    expect(expandSnippet('"${1:a}" ${2|x,y|} $0 ${3:p${4:q}r} \\$ \\}')).toBe('"a" x  pqr $ }');
  });
});

describe("JSON snippets", () => {
  test("prefixes are unique", () => {
    const prefixes = JSON_SNIPPETS.map((s) => s.prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  test.each(JSON_SNIPPETS.map((s) => [s.prefix, s] as const))(
    "%s expands to JSON that validates against its schema",
    (_, snippet) => {
      const expanded = expandSnippet(snippet.body);
      let parsed: unknown;
      expect(() => {
        parsed = JSON.parse(expanded) as unknown;
      }, expanded).not.toThrow();
      expect(validator.validate(parsed, loadSchema(snippet.schema)), expanded).toEqual([]);
    }
  );

  test.each(JSON_SNIPPETS.map((s) => [s.prefix, s] as const))(
    "%s numbers its tabstops 1..n without gaps and ends on $0",
    (_, snippet) => {
      const nums = tabstopNumbers(snippet.body).filter((n) => n > 0);
      expect(nums).toEqual(nums.map((_, idx) => idx + 1));
      expect(snippet.body.join("\n")).toMatch(/\$0$/);
    }
  );

  test("no snippet uses the Caddyfile-only {username} LDAP placeholder", () => {
    for (const s of JSON_SNIPPETS) expect(s.body.join("\n")).not.toContain("{username}");
  });

  // Only meaningful after `npm run build` in vscode-extension (gitignored output).
  const generated = join(__dirname, "../../vscode-extension/snippets/caddy-json.json");
  test.runIf(existsSync(generated))("generated caddy-json.json matches the source", () => {
    const out = JSON.parse(readFileSync(generated, "utf-8")) as Record<
      string,
      { prefix: string; body: string[] }
    >;
    expect(Object.values(out).map((s) => s.prefix)).toEqual(JSON_SNIPPETS.map((s) => s.prefix));
  });
});
