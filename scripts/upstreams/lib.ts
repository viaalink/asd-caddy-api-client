/**
 * Shared logic for the upstream update cycle (Redmine #4160).
 *
 * `upstreams.json` lists every Go source the generated types come from. This
 * module reads it, asks each upstream for its newest version and works out
 * which pins are behind. Pure functions (semver, go.mod parsing, Markdown
 * table edits) are exported for src/__tests__/upstreams.test.ts; the network
 * and git calls live in `resolveTargets` and below.
 */

import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

export const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const CONFIG_PATH = join(ROOT_DIR, "upstreams.json");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export type Track =
  /** Newest stable tag whose name matches `pattern`. */
  | { type: "tag"; pattern: string }
  /** Head of a branch (for repos without useful tags). */
  | { type: "branch"; branch: string }
  /** The version `parent`'s go.mod requires, at the parent's target. */
  | { type: "gomod"; parent: string };

export interface Pin {
  /** Tag (`v1.2.3`) or branch name the commit was taken from. */
  ref: string;
  commit: string;
  /** YYYY-MM-DD the pin last moved. */
  updated: string;
}

export interface Upstream {
  name: string;
  repo: string;
  module: string;
  localPath: string;
  track: Track;
  pin: Pin;
  /** Versioned tygo config, copied into the clone as tygo.yaml. */
  tygoConfig: string;
  generator: string;
  /** First cell of this upstream's row in DEPENDENCIES.md's tables. */
  docsRow?: string;
  /** The Caddy binary CI tests against follows this upstream. */
  caddyBinary?: boolean;
  note?: string;
}

export interface SupportedCaddy {
  caddy: string;
  library: string;
  vscode: string;
  validation: string;
}

export interface UpstreamsConfig {
  $comment?: string;
  upstreams: Upstream[];
  supportedCaddy: SupportedCaddy[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse and sanity-check upstreams.json. Throws with a readable message. */
export function parseConfig(text: string): UpstreamsConfig {
  const raw: unknown = JSON.parse(text);
  if (!isRecord(raw) || !Array.isArray(raw.upstreams) || !Array.isArray(raw.supportedCaddy)) {
    throw new Error("upstreams.json: expected { upstreams: [...], supportedCaddy: [...] }");
  }
  const config = raw as unknown as UpstreamsConfig;
  const names = new Set<string>();
  for (const u of config.upstreams) {
    for (const key of ["name", "repo", "module", "localPath", "tygoConfig", "generator"] as const) {
      if (typeof u[key] !== "string" || u[key] === "") {
        throw new Error(`upstreams.json: ${u.name ?? "?"} is missing "${key}"`);
      }
    }
    if (names.has(u.name)) throw new Error(`upstreams.json: duplicate name ${u.name}`);
    names.add(u.name);
    if (!/^[0-9a-f]{40}$/.test(u.pin.commit)) {
      throw new Error(`upstreams.json: ${u.name} pin.commit must be a full 40-char sha`);
    }
    if (u.track.type === "gomod" && !config.upstreams.some((p) => p.name === u.track.parent)) {
      throw new Error(`upstreams.json: ${u.name} follows unknown parent ${u.track.parent}`);
    }
  }
  return config;
}

export function loadConfig(path = CONFIG_PATH): UpstreamsConfig {
  return parseConfig(readFileSync(path, "utf-8"));
}

/** Parents before children, so a gomod upstream can read its parent's target. */
export function orderByDependency(upstreams: Upstream[]): Upstream[] {
  const done = new Set<string>();
  const out: Upstream[] = [];
  const visit = (u: Upstream, seen: Set<string>): void => {
    if (done.has(u.name)) return;
    if (seen.has(u.name)) throw new Error(`upstreams.json: gomod cycle at ${u.name}`);
    seen.add(u.name);
    if (u.track.type === "gomod") {
      const parentName = u.track.parent;
      const parent = upstreams.find((p) => p.name === parentName);
      if (parent) visit(parent, seen);
    }
    done.add(u.name);
    out.push(u);
  };
  for (const u of upstreams) visit(u, new Set());
  return out;
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

export function parseSemver(tag: string): SemVer | undefined {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag);
  if (!m) return undefined;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

export function compareSemver(a: SemVer, b: SemVer): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/** Newest tag that matches `pattern` and is plain semver (no pre-releases). */
export function pickLatestTag(tags: string[], pattern: string): string | undefined {
  const re = new RegExp(pattern);
  let best: { tag: string; v: SemVer } | undefined;
  for (const tag of tags) {
    if (!re.test(tag)) continue;
    const v = parseSemver(tag);
    if (!v) continue;
    if (!best || compareSemver(v, best.v) > 0) best = { tag, v };
  }
  return best?.tag;
}

/** "major" | "minor" | "patch" | undefined, for the report. */
export function bumpKind(from: string, to: string): "major" | "minor" | "patch" | undefined {
  const a = parseSemver(from);
  const b = parseSemver(to);
  if (!a || !b || compareSemver(b, a) <= 0) return undefined;
  if (b.major !== a.major) return "major";
  if (b.minor !== a.minor) return "minor";
  return "patch";
}

/** `require` lines of a go.mod, module -> version. */
export function parseGoModRequires(goMod: string): Map<string, string> {
  const out = new Map<string, string>();
  let inBlock = false;
  for (const rawLine of goMod.split("\n")) {
    const line = rawLine.replace(/\/\/.*$/, "").trim();
    if (line === "") continue;
    if (/^require\s*\($/.test(line)) {
      inBlock = true;
      continue;
    }
    if (inBlock && line === ")") {
      inBlock = false;
      continue;
    }
    const m = inBlock ? /^(\S+)\s+(\S+)$/.exec(line) : /^require\s+(\S+)\s+(\S+)$/.exec(line);
    if (m) out.set(m[1], m[2]);
  }
  return out;
}

/** A Go pseudo-version ends in the 12-char commit prefix it points at. */
export function pseudoVersionCommit(version: string): string | undefined {
  const m = /-(?:\d{14})-([0-9a-f]{12})$/.exec(version);
  return m?.[1];
}

// ---------------------------------------------------------------------------
// Remote lookups
// ---------------------------------------------------------------------------

/** git output, untrimmed (porcelain and file contents are whitespace-exact). */
export function gitRaw(args: string[], cwd = ROOT_DIR): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
}

export function git(args: string[], cwd = ROOT_DIR): string {
  return gitRaw(args, cwd).trim();
}

/** `git ls-remote` as ref -> sha; annotated tags resolve to their commit. */
export function lsRemote(repo: string, args: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const peeled = new Map<string, string>();
  for (const line of git(["ls-remote", ...args, repo]).split("\n")) {
    const [sha, ref] = line.split("\t");
    if (!sha || !ref) continue;
    if (ref.endsWith("^{}")) peeled.set(ref.slice(0, -3), sha);
    else out.set(ref, sha);
  }
  for (const [ref, sha] of peeled) out.set(ref, sha);
  return out;
}

function githubRaw(repo: string, commit: string, file: string): string {
  const m = /github\.com\/([^/]+)\/([^/.]+)/.exec(repo);
  if (!m) throw new Error(`not a GitHub repo: ${repo}`);
  return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${commit}/${file}`;
}

export async function fetchGoMod(repo: string, commit: string): Promise<string> {
  const url = githubRaw(repo, commit, "go.mod");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url}: ${res.status}`);
  return res.text();
}

/** GitHub compare link; tags when both ends are tags, commits otherwise. */
export function compareUrl(repo: string, from: Pin | Target, to: Pin | Target): string {
  const end = (p: Pin | Target): string => (parseSemver(p.ref) ? p.ref : p.commit.slice(0, 12));
  return `${repo.replace(/\.git$/, "")}/compare/${end(from)}...${end(to)}`;
}

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

export interface Target {
  upstream: Upstream;
  /** Tag or branch to move to (equals pin.ref when up to date). */
  ref: string;
  commit: string;
  changed: boolean;
  kind?: "major" | "minor" | "patch";
  /** Tracked modules this upstream's go.mod requires at the target. */
  requires: Map<string, string>;
  warnings: string[];
}

/** Ask every upstream for its newest version. `overrides` forces name -> ref. */
export async function resolveTargets(
  config: UpstreamsConfig,
  overrides: Map<string, string> = new Map(),
  only?: Set<string>
): Promise<Target[]> {
  const targets = new Map<string, Target>();
  const byModule = new Map(config.upstreams.map((u) => [u.module, u]));
  const ordered = orderByDependency(config.upstreams);
  if (only) {
    // A gomod child moves with its parent: --only caddy-security takes go-authcrunch along.
    only = new Set(only);
    for (const u of ordered) {
      if (u.track.type === "gomod" && only.has(u.track.parent)) only.add(u.name);
    }
  }

  for (const u of ordered) {
    const warnings: string[] = [];
    let ref: string;
    let commit: string;
    const skip = only !== undefined && !only.has(u.name) && !overrides.has(u.name);

    if (skip) {
      ref = u.pin.ref;
      commit = u.pin.commit;
    } else if (overrides.has(u.name)) {
      ref = overrides.get(u.name) ?? u.pin.ref;
      const refs = lsRemote(u.repo, []);
      const sha =
        refs.get(`refs/tags/${ref}`) ??
        refs.get(`refs/heads/${ref}`) ??
        resolveShaPrefix(refs, ref);
      if (!sha) throw new Error(`${u.name}: ${ref} not found upstream`);
      commit = sha;
      warnings.push(`target forced to ${ref} with --target`);
    } else if (u.track.type === "tag") {
      const refs = lsRemote(u.repo, ["--tags"]);
      const tags = [...refs.keys()].map((r) => r.replace(/^refs\/tags\//, ""));
      const latest = pickLatestTag(tags, u.track.pattern);
      if (!latest) throw new Error(`${u.name}: no tag matches ${u.track.pattern}`);
      ref = latest;
      commit = refs.get(`refs/tags/${latest}`) ?? "";
      const pinned = parseSemver(u.pin.ref);
      const found = parseSemver(latest);
      if (pinned && found && compareSemver(found, pinned) < 0) {
        // Upstream deleted or re-tagged; never move a pin backwards on our own.
        warnings.push(`newest upstream tag ${latest} is older than the pin; keeping ${u.pin.ref}`);
        ref = u.pin.ref;
        commit = u.pin.commit;
      }
    } else if (u.track.type === "branch") {
      const branch = u.track.branch;
      const refs = lsRemote(u.repo, ["--heads"]);
      commit = refs.get(`refs/heads/${branch}`) ?? "";
      if (!commit) throw new Error(`${u.name}: branch ${branch} not found`);
      ref = branch;
    } else {
      const parentName = u.track.parent;
      const parent = targets.get(parentName);
      if (!parent) throw new Error(`${u.name}: parent ${parentName} not resolved`);
      const version = parent.requires.get(u.module);
      if (!version)
        throw new Error(`${u.name}: ${parentName}'s go.mod does not require ${u.module}`);
      const pseudo = pseudoVersionCommit(version);
      if (pseudo) {
        const refs = lsRemote(u.repo, []);
        commit = resolveShaPrefix(refs, pseudo) ?? "";
        if (!commit) {
          // Not at any ref head; trust the prefix, the clone step resolves it.
          commit = pseudo;
          warnings.push(`pseudo-version ${version}: commit resolved from the clone`);
        }
        ref = version;
      } else {
        const refs = lsRemote(u.repo, ["--tags"]);
        commit = refs.get(`refs/tags/${version}`) ?? "";
        if (!commit) throw new Error(`${u.name}: tag ${version} (from ${parentName}) not found`);
        ref = version;
      }
    }

    let requires = new Map<string, string>();
    try {
      const all = parseGoModRequires(await fetchGoMod(u.repo, commit));
      requires = new Map([...all].filter(([mod]) => byModule.has(mod)));
    } catch (err) {
      warnings.push(`could not read go.mod at ${commit.slice(0, 7)}: ${(err as Error).message}`);
    }

    const changed = commit !== u.pin.commit && !commit.startsWith(u.pin.commit.slice(0, 12));
    targets.set(u.name, {
      upstream: u,
      ref,
      commit,
      changed: changed && commit.length >= 12,
      kind: bumpKind(u.pin.ref, ref),
      requires,
      warnings,
    });
  }

  // Cross-check: does a target need a newer version of another tracked module?
  const all = config.upstreams.map((u) => targets.get(u.name)).filter((t): t is Target => !!t);
  for (const t of all) {
    for (const [mod, version] of t.requires) {
      const dep = all.find((d) => d.upstream.module === mod);
      if (!dep) continue;
      const want = parseSemver(version);
      const have = parseSemver(dep.ref);
      if (want && have && compareSemver(want, have) > 0) {
        t.warnings.push(
          `requires ${dep.upstream.name} ${version}, newer than the ${dep.ref} we generate from`
        );
      }
    }
  }
  return all;
}

function resolveShaPrefix(refs: Map<string, string>, prefix: string): string | undefined {
  if (!/^[0-9a-f]{7,40}$/.test(prefix)) return undefined;
  for (const sha of refs.values()) if (sha.startsWith(prefix)) return sha;
  return undefined;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export function shortRef(t: { ref: string; commit: string }): string {
  return parseSemver(t.ref) ? t.ref : `${t.ref}@${t.commit.slice(0, 7)}`;
}

export function formatReport(targets: Target[]): string {
  const rows = targets.map((t) => {
    const from = shortRef(t.upstream.pin);
    const to = shortRef(t);
    const status = t.changed ? `UPDATE${t.kind ? ` (${t.kind})` : ""}` : "up to date";
    return [t.upstream.name, from, t.changed ? to : "", status];
  });
  const head = ["upstream", "pinned", "latest", "status"];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]): string =>
    cells
      .map((c, i) => c.padEnd(widths[i]))
      .join("  ")
      .trimEnd();
  const out = [line(head), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)];
  for (const t of targets) {
    for (const w of t.warnings) out.push(`  ! ${t.upstream.name}: ${w}`);
  }
  for (const t of targets.filter((x) => x.changed)) {
    out.push(`  ${t.upstream.name}: ${compareUrl(t.upstream.repo, t.upstream.pin, t)}`);
  }
  const n = targets.filter((t) => t.changed).length;
  out.push("", n === 0 ? "All upstreams are up to date." : `${n} upstream(s) have updates.`);
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Docs
// ---------------------------------------------------------------------------

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

/**
 * Rewrite the row of every Markdown table whose first cell (backticks
 * stripped) is `rowKey`: columns named Version, Version/commit, Commit and
 * Updated get the new values. Returns the new text and how many rows changed.
 * Alignment is left to prettier.
 */
export function updateDocsRow(
  markdown: string,
  rowKey: string,
  pin: Pin,
  pinnedByCommit: boolean
): { text: string; rows: number } {
  const lines = markdown.split("\n");
  let header: string[] | undefined;
  let rows = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim().startsWith("|")) {
      header = undefined;
      continue;
    }
    const cells = splitRow(line);
    if (!header) {
      header = cells.map((c) => c.toLowerCase());
      continue;
    }
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    if (cells[0].replace(/`/g, "") !== rowKey) continue;
    const short = pin.commit.slice(0, 7);
    header.forEach((h, col) => {
      if (col >= cells.length) return;
      if (h === "version/commit") {
        cells[col] = pinnedByCommit ? `no tags — pinned to commit \`${short}\`` : `\`${pin.ref}\``;
      } else if (h === "version") {
        cells[col] = pinnedByCommit ? `\`${short}\`` : pin.ref;
      } else if (h === "commit") {
        cells[col] = pin.commit.slice(0, 8);
      } else if (h === "updated") {
        cells[col] = pin.updated;
      }
    });
    lines[i] = `| ${cells.join(" | ")} |`;
    rows++;
  }
  return { text: lines.join("\n"), rows };
}

export const SUPPORTED_START = "<!-- upstreams:supported-caddy:start -->";
export const SUPPORTED_END = "<!-- upstreams:supported-caddy:end -->";

export function renderSupportedCaddy(entries: SupportedCaddy[]): string {
  const rows = entries.map((e) => `| ${e.caddy} | ${e.library} | ${e.vscode} | ${e.validation} |`);
  return [
    "| Caddy | Library | VS Code extension | How it is validated |",
    "| --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

/** Replace the text between the supported-caddy markers. */
export function replaceSupportedCaddy(markdown: string, table: string): string {
  const start = markdown.indexOf(SUPPORTED_START);
  const end = markdown.indexOf(SUPPORTED_END);
  if (start < 0 || end < start) throw new Error("supported-caddy markers not found");
  return (
    markdown.slice(0, start + SUPPORTED_START.length) +
    "\n\n" +
    table +
    "\n\n" +
    markdown.slice(end)
  );
}

/** Rewrite the default Caddy version in the install-caddy composite action. */
export function updateInstallCaddyDefault(actionYaml: string, version: string): string {
  return actionYaml.replace(
    /(Caddy version to install when none is on PATH\n\s+default: )"[^"]*"/,
    `$1"${version.replace(/^v/, "")}"`
  );
}
