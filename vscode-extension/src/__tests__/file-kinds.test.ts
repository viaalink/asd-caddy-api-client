/**
 * The status bar and our diagnostics must name the same schema as VS Code's own
 * validation (package.json `contributes.jsonValidation`) for every file name.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { caddyFileKind } from "../providers/file-kinds";

interface JsonValidation {
  fileMatch: string[];
  url: string;
}

const manifest = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf8")) as {
  contributes: { jsonValidation: JsonValidation[] };
};

/** A file name that matches a `**\/name` or `**\/*.suffix` glob. */
function exampleFor(glob: string): string {
  const base = glob.replace(/^\*\*\//, "");
  return base.startsWith("*") ? `project${base.slice(1)}` : base;
}

describe("file kinds follow package.json jsonValidation", () => {
  for (const { fileMatch, url } of manifest.contributes.jsonValidation) {
    const schema = url.replace("./schemas/", "");
    for (const glob of fileMatch) {
      test(`${glob} → ${schema}`, () => {
        expect(caddyFileKind(`/work/${exampleFor(glob)}`)?.schemaFile).toBe(schema);
      });
    }
  }

  test("layer4 files are the caddy-l4 app", () => {
    expect(caddyFileKind("/w/layer4.json")?.label).toBe("Caddy Layer 4");
    expect(caddyFileKind("/w/edge.layer4.json")?.schemaFile).toBe("caddy-layer4-app.json");
    // Not every json is a Caddy file.
    expect(caddyFileKind("/w/package.json")).toBeUndefined();
  });
});
