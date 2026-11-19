/**
 * Keep the zod 3 meaning of `z.any()` / `z.unknown()` fields in the generated schemas.
 *
 * ts-to-zod writes a Go type it cannot resolve (an embedded struct, an interface, a
 * function) as `z.any()` or `z.unknown()`, inline or through a constant
 * (`const headerOpsSchema = z.any();`). Zod 3 treated an object key with such a schema as
 * optional; zod 4 requires the key. Without this pass a valid Caddy config that leaves
 * such a field out (the `push` handler without `headers.HeaderOps`, for one) fails to
 * parse after the move to zod 4.
 *
 * The pass marks those fields `.optional()`, so a parse accepts exactly what it accepted
 * on zod 3. It is idempotent.
 *
 * Usage: bun scripts/zod4-optional-any.ts [file.zod.ts ...]   (no files: every generated one)
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ANY_ALIAS = /^(?:export )?const ([A-Za-z_$][\w$]*) = z\.(?:any|unknown)\(\);$/gm;

/**
 * The source with every object field whose schema is `z.any()`, `z.unknown()` or a
 * constant defined as one of those made optional.
 *
 * @param source - A generated `.zod.ts` file.
 * @returns The changed source (the same string when nothing applies).
 */
export function optionalAnyFields(source: string): string {
  const aliases = new Set<string>();
  for (const m of source.matchAll(ANY_ALIAS)) aliases.add(m[1]!);
  const names = [
    "z\\.any\\(\\)",
    "z\\.unknown\\(\\)",
    ...[...aliases].map((a) => a.replace(/\$/g, "\\$")),
  ];
  const field = new RegExp(
    `^(\\s+(?:[A-Za-z_$][\\w$]*|"[^"]+"|'[^']+'): (?:${names.join("|")}))(,?)$`,
    "gm"
  );
  return source.replace(field, "$1.optional()$2");
}

/** Every `.zod.ts` file below `dir`. */
function zodFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...zodFiles(path));
    else if (name.endsWith(".zod.ts")) out.push(path);
  }
  return out;
}

if (import.meta.main ?? process.argv[1]?.endsWith("zod4-optional-any.ts")) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const files = process.argv.slice(2).length
    ? process.argv.slice(2)
    : zodFiles(join(root, "src/generated"));
  let changed = 0;
  for (const file of files) {
    const before = readFileSync(file, "utf8");
    const after = optionalAnyFields(before);
    if (after !== before) {
      writeFileSync(file, after);
      changed++;
    }
  }
  console.log(`zod4-optional-any: ${changed} of ${files.length} files changed`);
}
