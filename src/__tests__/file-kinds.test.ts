import { describe, test, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { caddyFileKind } from "../../vscode-extension/src/providers/file-kinds.js";

interface JsonValidation {
  fileMatch: string[];
  url: string;
}

const pkg = JSON.parse(
  readFileSync(join(__dirname, "../../vscode-extension/package.json"), "utf-8")
) as { contributes: { jsonValidation: JsonValidation[] } };

describe("caddyFileKind mirrors package.json jsonValidation", () => {
  const cases = pkg.contributes.jsonValidation.flatMap((entry) =>
    entry.fileMatch.map((glob) => {
      const name = glob.replace("**/", "").replace("*", "my-app");
      return [name, entry.url.replace("./schemas/", "")] as const;
    })
  );

  test.each(cases)("%s -> %s", (name, schemaFile) => {
    expect(caddyFileKind(`/work/${name}`)?.schemaFile).toBe(schemaFile);
  });

  test.each(["package.json", "tsconfig.json", "my-security.json", "caddyfile.json"])(
    "%s is not a Caddy file",
    (name) => {
      expect(caddyFileKind(name)).toBeUndefined();
    }
  );
});
