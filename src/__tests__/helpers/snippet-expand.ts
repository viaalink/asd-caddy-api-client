/**
 * Expand a VS Code snippet body the way accepting it without edits would:
 * every placeholder takes its default (`${1:foo}` -> `foo`, nested ones
 * included), a choice takes its first option (`${1|a,b|}` -> `a`), bare
 * tabstops (`$1`, `$0`, `${2}`) vanish, and `\$` / `\}` / `\\` unescape.
 *
 * Lets unit tests check that what a user actually gets from a snippet parses
 * and validates, instead of only checking the snippet's source text.
 */
export function expandSnippet(body: string | string[]): string {
  const text = Array.isArray(body) ? body.join("\n") : body;
  let out = "";
  let i = 0;

  // Parses from `i` until an unescaped `}` at depth 0 (when `inPlaceholder`).
  function parse(inPlaceholder: boolean): string {
    let acc = "";
    while (i < text.length) {
      const ch = text[i];
      if (ch === "\\" && i + 1 < text.length && "$}\\".includes(text[i + 1])) {
        acc += text[i + 1];
        i += 2;
        continue;
      }
      if (inPlaceholder && ch === "}") {
        i++;
        return acc;
      }
      if (ch === "$") {
        const bare = /^\$(\d+)/.exec(text.slice(i));
        if (bare) {
          i += bare[0].length;
          continue;
        }
        const choice = /^\$\{\d+\|([^|]*)\|\}/.exec(text.slice(i));
        if (choice) {
          acc += choice[1].split(",")[0];
          i += choice[0].length;
          continue;
        }
        const open = /^\$\{\d+(:|\})/.exec(text.slice(i));
        if (open) {
          i += open[0].length;
          if (open[1] === ":") acc += parse(true);
          continue;
        }
      }
      acc += ch;
      i++;
    }
    return acc;
  }

  out = parse(false);
  return out;
}

/** Highest tabstop number used, and whether 1..max are all present. */
export function tabstopNumbers(body: string | string[]): number[] {
  const text = Array.isArray(body) ? body.join("\n") : body;
  const nums = new Set<number>();
  for (const m of text.matchAll(/(?<!\\)\$(?:\{(\d+)|(\d+))/g)) {
    nums.add(Number(m[1] ?? m[2]));
  }
  return [...nums].sort((a, b) => a - b);
}
