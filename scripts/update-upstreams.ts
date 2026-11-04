/**
 * The update half of the upstream cycle (Redmine #4160): move the pins in
 * upstreams.json that are behind, regenerate, run the gate, and write a
 * summary that serves as the pull request body.
 *
 *   just upstreams-update                          # everything that is behind
 *   just upstreams-update --only caddy-security    # one upstream (+ its gomod children)
 *   just upstreams-update --target caddy=v2.11.5   # force a ref (also backwards, to rehearse)
 *   just upstreams-update --skip-vscode            # leave out `just vscode-test`
 *   just upstreams-sync                            # = --sync-only: clones on their pins, nothing else
 *
 * Writes local/upstreams/{summary.md,result.json,logs/*.log}.
 * Exit codes: 0 nothing to do or gate green, 20 updated but the gate failed, 1 error.
 * It never commits, pushes, merges or publishes.
 *
 * Hand-fixes survive. Some generated files carry fixes by hand (tygo's
 * comment-merging artifact, the queryOps types in caddy-rewrite.ts). So the
 * script first regenerates at the OLD pins (the baseline), and for every file
 * where that baseline differs from the committed file, it three-way merges
 * the committed edits onto the new output (`git merge-file`). A fix whose
 * lines upstream also changed comes out as a conflict, which fails the gate
 * and is listed in the summary.
 */

import { spawnSync } from "child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import {
  CONFIG_PATH,
  ROOT_DIR,
  type Target,
  type Upstream,
  type UpstreamsConfig,
  compareUrl,
  formatReport,
  git,
  gitRaw,
  loadConfig,
  renderSupportedCaddy,
  replaceSupportedCaddy,
  resolveTargets,
  shortRef,
  updateDocsRow,
  updateInstallCaddyDefault,
} from "./upstreams/lib.js";

const EXIT_GATE_FAILED = 20;
const OUT_DIR = join(ROOT_DIR, "local/upstreams");
const LOG_DIR = join(OUT_DIR, "logs");
const GENERATED = "src/generated";
const DOC_FILES = {
  dependencies: "DEPENDENCIES.md",
  readme: "README.md",
  vscodeReadme: "vscode-extension/README.md",
  installCaddy: ".github/actions/install-caddy/action.yml",
};
/** Files this script rewrites; they must be clean before it starts. */
const OWNED = [GENERATED, "upstreams.json", ...Object.values(DOC_FILES)];

interface Args {
  only?: Set<string>;
  targets: Map<string, string>;
  skipVscode: boolean;
  forceVscode: boolean;
  noGate: boolean;
  syncOnly: boolean;
  renderDocs: boolean;
  allowDirty: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    targets: new Map(),
    skipVscode: false,
    forceVscode: false,
    noGate: false,
    syncOnly: false,
    renderDocs: false,
    allowDirty: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--only") a.only = new Set(argv[++i].split(",").filter(Boolean));
    else if (arg === "--target") {
      const [name, ref] = argv[++i].split("=");
      if (!name || !ref) throw new Error("--target wants name=ref");
      a.targets.set(name, ref);
    } else if (arg === "--skip-vscode") a.skipVscode = true;
    else if (arg === "--vscode") a.forceVscode = true;
    else if (arg === "--no-gate") a.noGate = true;
    else if (arg === "--sync-only") a.syncOnly = true;
    else if (arg === "--render-docs") a.renderDocs = true;
    else if (arg === "--allow-dirty") a.allowDirty = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  if (a.targets.size > 0 && !a.only) a.only = new Set(a.targets.keys());
  return a;
}

// ---------------------------------------------------------------------------
// Process helpers
// ---------------------------------------------------------------------------

interface StepResult {
  name: string;
  ok: boolean;
  seconds: number;
  log: string;
}

/** Run a command with output to logs/<name>.log; print one status line. */
function step(name: string, cmd: string, args: string[], env: NodeJS.ProcessEnv = {}): StepResult {
  mkdirSync(LOG_DIR, { recursive: true });
  const log = join(LOG_DIR, `${name}.log`);
  const started = Date.now();
  const shown = args.length > 4 ? [...args.slice(0, 3), `(+${args.length - 3} more)`] : args;
  process.stdout.write(`  ${name}: ${cmd} ${shown.join(" ")} ... `);
  const r = spawnSync(cmd, args, {
    cwd: ROOT_DIR,
    env: { ...process.env, ...env },
    encoding: "utf-8",
    maxBuffer: 512 * 1024 * 1024,
  });
  const output = `$ ${cmd} ${args.join(" ")}\n${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? String(r.error) : ""}`;
  writeFileSync(log, output);
  const seconds = Math.round((Date.now() - started) / 1000);
  const ok = r.status === 0;
  console.log(`${ok ? "ok" : `FAILED (exit ${r.status ?? "signal"})`} [${seconds}s]`);
  return { name, ok, seconds, log };
}

function tail(file: string, lines: number): string {
  const all = readFileSync(file, "utf-8").split("\n");
  return all.slice(-lines).join("\n");
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function changedPaths(paths: string[]): string[] {
  const out = gitRaw(["status", "--porcelain", "--untracked-files=all", "--", ...paths]);
  return out
    .split("\n")
    .filter(Boolean)
    .map((l) => l.slice(3).replace(/^.* -> /, ""));
}

// ---------------------------------------------------------------------------
// Clones
// ---------------------------------------------------------------------------

function sameRepo(a: string, b: string): boolean {
  const norm = (u: string): string =>
    u
      .replace(/^git@github\.com:/, "github.com/")
      .replace(/^https?:\/\//, "")
      .replace(/\.git$/, "")
      .toLowerCase();
  return norm(a) === norm(b);
}

/**
 * Put local/<name> on `commit` (cloning it when missing) and install the
 * versioned tygo config. Refuses to touch a clone with edits of its own.
 */
function checkoutUpstream(u: Upstream, commit: string, allowDirty: boolean): string {
  const dir = join(ROOT_DIR, u.localPath);
  if (!existsSync(join(dir, ".git"))) {
    console.log(`  clone ${u.repo} -> ${u.localPath}`);
    mkdirSync(dirname(dir), { recursive: true });
    git(["clone", "--quiet", "--no-checkout", u.repo, dir]);
  } else {
    const origin = git(["remote", "get-url", "origin"], dir);
    if (!sameRepo(origin, u.repo)) {
      throw new Error(`${u.localPath}: origin is ${origin}, upstreams.json says ${u.repo}`);
    }
    const dirty = git(["status", "--porcelain"], dir)
      .split("\n")
      .filter((l) => l.trim() !== "" && !/\btygo\.yaml$/.test(l));
    if (dirty.length > 0 && !allowDirty) {
      throw new Error(`${u.localPath} has local edits (${dirty.join(", ")}); use --allow-dirty`);
    }
  }
  const has = (sha: string): boolean => {
    try {
      git(["cat-file", "-e", `${sha}^{commit}`], dir);
      return true;
    } catch {
      return false;
    }
  };
  if (!has(commit)) git(["fetch", "--quiet", "--tags", "origin"], dir);
  if (!has(commit)) git(["fetch", "--quiet", "origin", commit], dir);
  const full = git(["rev-parse", `${commit}^{commit}`], dir);
  git(["checkout", "--quiet", "--detach", full], dir);

  const tracked = join(ROOT_DIR, u.tygoConfig);
  if (existsSync(tracked)) copyFileSync(tracked, join(dir, "tygo.yaml"));
  return full;
}

/** Lines adding or removing a `json:"..."` struct tag between two commits. */
function jsonTagDelta(u: Upstream, from: string, to: string): { added: number; removed: number } {
  const dir = join(ROOT_DIR, u.localPath);
  let added = 0;
  let removed = 0;
  try {
    const diff = git(["diff", "--unified=0", from, to, "--", "*.go", ":(exclude)*_test.go"], dir);
    for (const line of diff.split("\n")) {
      if (!line.includes('json:"')) continue;
      if (line.startsWith("+") && !line.startsWith("+++")) added++;
      else if (line.startsWith("-") && !line.startsWith("---")) removed++;
    }
  } catch {
    /* shallow history; the compare link still works */
  }
  return { added, removed };
}

// ---------------------------------------------------------------------------
// Generation with hand-fixes carried over
// ---------------------------------------------------------------------------

function regenerate(label: string, epoch: string): StepResult[] {
  const gen = step(`generate-${label}`, "bun", ["run", "generate:all"], {
    SOURCE_DATE_EPOCH: epoch,
  });
  // generate-plugin-types.ts logs "✗" and carries on when tygo fails for one
  // plugin, which would leave that plugin's types silently stale.
  const log = readFileSync(gen.log, "utf-8");
  if (gen.ok && /✗|Failed to generate/.test(log)) {
    gen.ok = false;
    console.log(`    a generator reported a failure; see ${gen.log}`);
    if (log.includes("toolchain not available")) {
      // e.g. libdns/route53's go.mod says "go 1.25", which go 1.22 cannot fetch.
      console.log("    your Go is older than an upstream's go.mod: try GOTOOLCHAIN=go1.25.0+auto");
    }
  }
  // Format like the committed files are. tygo's comment-merging artifact can
  // leave a file that does not parse; prettier then skips it (exit 2), which
  // is expected here: the same file is unparseable in both runs and the
  // committed hand-fix is merged on top later. typecheck in the gate judges.
  const changed = changedPaths([GENERATED]).filter((p) => existsSync(join(ROOT_DIR, p)));
  if (changed.length > 0) {
    const fmt = step(`format-${label}`, "just", ["format-paths", ...changed]);
    if (!fmt.ok) {
      const bad = [...readFileSync(fmt.log, "utf-8").matchAll(/\[error\] (\S+): SyntaxError/g)];
      console.log(`    left unformatted (does not parse): ${bad.map((m) => m[1]).join(", ")}`);
    }
  }
  return [gen];
}

interface CarryResult {
  /** Files whose committed version differs from a regeneration at the old pins. */
  handFixed: string[];
  merged: string[];
  conflicts: string[];
}

/** Snapshot the baseline (old pins) output, then restore src/generated. */
function takeBaseline(): { dir: string; files: Map<string, boolean> } {
  const dir = mkdtempSync(join(tmpdir(), "upstreams-baseline-"));
  const files = new Map<string, boolean>();
  for (const path of changedPaths([GENERATED])) {
    const abs = join(ROOT_DIR, path);
    const exists = existsSync(abs);
    files.set(path, exists);
    if (exists) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      copyFileSync(abs, join(dir, path));
    }
  }
  git(["checkout", "HEAD", "--", GENERATED]);
  git(["clean", "-fdq", "--", GENERATED]);
  return { dir, files };
}

function committedVersion(path: string): string | undefined {
  try {
    return gitRaw(["show", `HEAD:${path}`]);
  } catch {
    return undefined;
  }
}

function carryHandFixes(baseline: { dir: string; files: Map<string, boolean> }): CarryResult {
  const result: CarryResult = { handFixed: [...baseline.files.keys()], merged: [], conflicts: [] };
  const scratch = mkdtempSync(join(tmpdir(), "upstreams-committed-"));
  for (const [path, baseExists] of baseline.files) {
    const abs = join(ROOT_DIR, path);
    const basePath = join(baseline.dir, path);
    const committed = committedVersion(path);
    const nowExists = existsSync(abs);

    // Upstream did not touch this file: keep the committed (hand-fixed) one.
    const same =
      nowExists === baseExists &&
      (!nowExists || readFileSync(abs, "utf-8") === readFileSync(basePath, "utf-8"));
    if (same) {
      if (committed !== undefined) git(["checkout", "HEAD", "--", path]);
      else rmSync(abs, { force: true });
      continue;
    }
    if (!nowExists || !baseExists || committed === undefined) continue; // added/removed: take the new output

    const committedPath = join(scratch, path);
    mkdirSync(dirname(committedPath), { recursive: true });
    writeFileSync(committedPath, committed);
    const r = spawnSync(
      "git",
      [
        "merge-file",
        "-L",
        "regenerated",
        "-L",
        "old-pins",
        "-L",
        "committed",
        abs,
        basePath,
        committedPath,
      ],
      { cwd: ROOT_DIR, encoding: "utf-8" }
    );
    if (r.status === 0) result.merged.push(path);
    else if ((r.status ?? -1) > 0) result.conflicts.push(path);
    else throw new Error(`git merge-file ${path}: ${r.stderr}`);
  }
  rmSync(scratch, { recursive: true, force: true });
  rmSync(baseline.dir, { recursive: true, force: true });
  return result;
}

// ---------------------------------------------------------------------------
// Docs
// ---------------------------------------------------------------------------

function writeDocs(config: UpstreamsConfig, changed: Target[]): string[] {
  const notes: string[] = [];
  const path = (p: string): string => join(ROOT_DIR, p);

  let deps = readFileSync(path(DOC_FILES.dependencies), "utf-8");
  for (const t of changed) {
    const u = t.upstream;
    if (!u.docsRow) continue;
    const r = updateDocsRow(deps, u.docsRow, u.pin, u.track.type === "branch");
    deps = r.text;
    if (r.rows === 0) notes.push(`DEPENDENCIES.md has no row for ${u.docsRow}; add one by hand.`);
  }
  writeFileSync(path(DOC_FILES.dependencies), deps);

  const caddy = changed.find((t) => t.upstream.caddyBinary);
  if (caddy) {
    const action = readFileSync(path(DOC_FILES.installCaddy), "utf-8");
    const next = updateInstallCaddyDefault(action, caddy.ref);
    if (next === action) notes.push(`${DOC_FILES.installCaddy}: default version not found.`);
    writeFileSync(path(DOC_FILES.installCaddy), next);
    if (!config.supportedCaddy.some((s) => s.caddy === caddy.ref)) {
      config.supportedCaddy.unshift({
        caddy: caddy.ref,
        library: "next release",
        vscode: "next release",
        validation:
          "Upstream update PR: types regenerated from this source, then `just check` (CI runs the unit and differential fuzz tests on this binary), `just build` and `just vscode-test` on the regenerated schemas.",
      });
    }
  }

  const table = renderSupportedCaddy(config.supportedCaddy);
  for (const file of [DOC_FILES.readme, DOC_FILES.vscodeReadme]) {
    writeFileSync(path(file), replaceSupportedCaddy(readFileSync(path(file), "utf-8"), table));
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
  return notes;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

interface Summary {
  changed: Target[];
  all: Target[];
  gate: StepResult[];
  generation: StepResult[];
  carry: CarryResult;
  tagDelta: Map<string, { added: number; removed: number }>;
  notes: string[];
  caddyOnPath: string;
}

function prTitle(changed: Target[]): string {
  return `chore(deps): upstream Go sources: ${changed.map((t) => `${t.upstream.name} ${shortRef(t)}`).join(", ")}`;
}

function writeSummary(s: Summary, gateOk: boolean): string {
  const lines: string[] = [];
  lines.push(`## ${prTitle(s.changed)}`, "");
  lines.push(
    "Opened by the upstream update cycle (`just upstreams-update`, `.github/workflows/upstreams.yml`). " +
      "It is never merged automatically: review the regenerated code, then merge, version, CHANGELOG and publish by hand.",
    ""
  );
  lines.push(`### Gate: ${gateOk ? "PASS" : "FAILING"}`, "");
  lines.push("| step | result | time |", "| --- | --- | --- |");
  for (const r of [...s.generation, ...s.gate]) {
    lines.push(`| \`${r.name}\` | ${r.ok ? "pass" : "**FAIL**"} | ${r.seconds}s |`);
  }
  lines.push("", `Caddy binary the tests ran against: \`${s.caddyOnPath}\``, "");

  lines.push("### Bumps", "");
  lines.push(
    "| upstream | from | to | kind | `json:` tag lines (+/-) | diff |",
    "| --- | --- | --- | --- | --- | --- |"
  );
  for (const t of s.changed) {
    const d = s.tagDelta.get(t.upstream.name);
    lines.push(
      `| ${t.upstream.name} | ${shortRef(t.upstream.pin)} | ${shortRef(t)} | ${t.kind ?? "commit"} | ${d ? `+${d.added} / -${d.removed}` : "?"} | [compare](${compareUrl(t.upstream.repo, t.upstream.pin, t)}) |`
    );
  }
  const warnings = s.all.flatMap((t) => t.warnings.map((w) => `- ${t.upstream.name}: ${w}`));
  if (warnings.length > 0 || s.notes.length > 0) {
    lines.push("", "### Warnings", "", ...warnings, ...s.notes.map((n) => `- ${n}`));
  }

  lines.push("", "### Regenerated files", "");
  const stat = git(["diff", "--stat", "--", GENERATED]);
  lines.push("```", stat || "(no change in src/generated)", "```");

  lines.push("", "### Hand-fixes carried over", "");
  lines.push(
    `${s.carry.handFixed.length} generated file(s) differ from what the generator produces at the old pins (fixes by hand). ` +
      `${s.carry.merged.length} were 3-way merged onto the new output; ${s.carry.conflicts.length} conflict(s).`
  );
  for (const c of s.carry.conflicts)
    lines.push(`- CONFLICT (look for \`<<<<<<< regenerated\`): \`${c}\``);

  lines.push(
    "",
    "### Before merging",
    "",
    "- [ ] Read the upstream diffs above; write the `vX → vY notes` in DEPENDENCIES.md (new/removed JSON fields, security fixes).",
    "- [ ] If typecheck failed: fix tygo's comment-merging artifacts by hand (DEPENDENCIES.md, 'Adding a Provider' step 5).",
    "- [ ] Builders/schemas in `src/plugins/*` and `src/caddy/*` cover any new syntax you want exposed.",
    "- [ ] CHANGELOG + version bump only if this ships in a release (no npm bump without functional changes).",
    "- [ ] Compatibility matrix in DEPENDENCIES.md/README.md, and the library/extension versions in the supported-Caddy table."
  );

  const failed = [...s.generation, ...s.gate].filter((r) => !r.ok && r.log);
  for (const r of failed) {
    lines.push(
      "",
      `<details><summary>Log tail: <code>${r.name}</code></summary>`,
      "",
      "```",
      tail(r.log, 80).replace(/```/g, "'''"),
      "```",
      "",
      "</details>"
    );
  }
  const text = lines.join("\n") + "\n";
  writeFileSync(join(OUT_DIR, "summary.md"), text);
  return text;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function caddyVersion(): string {
  const r = spawnSync("caddy", ["version"], { encoding: "utf-8" });
  return r.status === 0 ? r.stdout.trim() : "caddy not on PATH";
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(LOG_DIR, { recursive: true });
  const config = loadConfig();

  if (args.renderDocs) {
    // Re-render the supported-Caddy tables after editing upstreams.json by hand.
    writeDocs(config, []);
    step("format-docs", "just", ["format-paths", "upstreams.json", ...Object.values(DOC_FILES)]);
    return 0;
  }

  if (args.syncOnly) {
    for (const u of config.upstreams) {
      checkoutUpstream(u, u.pin.commit, args.allowDirty);
      console.log(`  ${u.name}: ${shortRef(u.pin)}`);
    }
    return 0;
  }

  const dirty = changedPaths(OWNED);
  if (dirty.length > 0 && !args.allowDirty) {
    throw new Error(`commit or stash these first: ${dirty.join(", ")}`);
  }

  console.log("Checking upstreams...");
  const all = await resolveTargets(config, args.targets, args.only);
  console.log(formatReport(all));
  const changed = all.filter((t) => t.changed);
  const writeResult = (r: object): void =>
    writeFileSync(join(OUT_DIR, "result.json"), JSON.stringify(r, null, 2) + "\n");
  if (changed.length === 0) {
    writeResult({ changed: false, gate: "skipped" });
    return 0;
  }

  // Baseline: every clone on its pin, regenerate, remember the output.
  console.log("\nBaseline: regenerating at the current pins");
  for (const u of config.upstreams) checkoutUpstream(u, u.pin.commit, args.allowDirty);
  const epoch = git(["log", "-1", "--format=%ct"]);
  const baseGen = regenerate("baseline", epoch);
  if (!baseGen.every((r) => r.ok)) {
    throw new Error(`regenerating at the current pins failed; see ${LOG_DIR}`);
  }
  const baseline = takeBaseline();
  console.log(`  ${baseline.files.size} committed generated file(s) carry fixes by hand`);

  // Move the pins.
  console.log("\nUpdating");
  const tagDelta = new Map<string, { added: number; removed: number }>();
  for (const t of changed) {
    const full = checkoutUpstream(t.upstream, t.commit, args.allowDirty);
    tagDelta.set(t.upstream.name, jsonTagDelta(t.upstream, t.upstream.pin.commit, full));
    t.commit = full;
    t.upstream.pin = { ref: t.ref, commit: full, updated: today() };
    console.log(`  ${t.upstream.name} -> ${shortRef(t)}`);
  }
  const generation = regenerate("new", epoch);
  const carry = carryHandFixes(baseline);
  console.log(`  hand-fixes: ${carry.merged.length} merged, ${carry.conflicts.length} conflict(s)`);

  const notes = writeDocs(config, changed);
  step("format-docs", "just", ["format-paths", "upstreams.json", ...Object.values(DOC_FILES)]);

  // Gate.
  const gate: StepResult[] = [];
  if (!args.noGate) {
    console.log("\nGate");
    gate.push(step("check", "just", ["check"]));
    const build = step("build", "just", ["build"]);
    gate.push(build);
    const caddyChanged = changed.some((t) => t.upstream.caddyBinary);
    if (args.forceVscode || (caddyChanged && !args.skipVscode)) {
      if (build.ok) {
        const deps = step("vscode-deps", "just", ["vscode-deps"]);
        gate.push(deps);
        if (deps.ok) gate.push(step("vscode-test", "just", ["vscode-test"]));
      } else {
        notes.push("`just vscode-test` skipped: the library build failed.");
      }
    }
  }
  const gateOk =
    generation.every((r) => r.ok) && carry.conflicts.length === 0 && gate.every((r) => r.ok);

  writeSummary(
    { changed, all, gate, generation, carry, tagDelta, notes, caddyOnPath: caddyVersion() },
    gateOk
  );
  writeResult({
    changed: true,
    gate: args.noGate ? "skipped" : gateOk ? "pass" : "fail",
    title: prTitle(changed),
    caddyVersion: changed.find((t) => t.upstream.caddyBinary)?.ref ?? null,
    upstreams: changed.map((t) => ({ name: t.upstream.name, to: shortRef(t), commit: t.commit })),
  });
  console.log(`\nSummary: ${join(OUT_DIR, "summary.md")}`);
  console.log(`Gate: ${gateOk ? "PASS" : "FAILING"}`);
  return gateOk ? 0 : EXIT_GATE_FAILED;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`update-upstreams: ${err instanceof Error ? err.message : String(err)}`);
    console.error(
      "src/generated may be half-written: `git checkout -- src/generated` restores it."
    );
    process.exit(1);
  }
);
