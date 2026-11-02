#!/usr/bin/env bun
/**
 * Speak the storyboard's lines, BEFORE anything is filmed.
 * Ported from DigitaleKraamzorg/scripts/video-voice.ts + scripts/lib/speech.ts.
 *
 * Writes local/video/<storyboard>/<variant>/voice/voice.json: how long each
 * line took. The recorder holds every step at least that long, so the picture
 * is cut to the words rather than the words squeezed into the picture.
 *
 * Piper runs locally (no key, nothing uploaded). Without piper or without the
 * voice model this exits quietly with nothing written; the film is then
 * captions-only, which still tells the whole story.
 *
 * Voice: CADDY_DEMO_VOICE=<path to .onnx>, default local/piper/en_US-lessac-high.onnx
 * (install with `just vscode-demo-voice-install`).
 *
 * Cloned voice instead of piper: CADDY_DEMO_CLONE=<voice name> plus
 * VOICE_CLONE_SAY=<path to project-prod/packages/voice-clone/bin/say.ts>.
 * say.ts writes the same voice.json, so nothing after this step changes.
 */

import { spawn, spawnSync } from "child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { isVariant, linesFor, type VoiceDurations } from "../lib/types";
import { storyboard } from "../storyboard";

const DEFAULT_VOICE = join("local", "piper", "en_US-lessac-high.onnx");

/** A shade quicker than piper's default: a demo, not an audiobook. */
const LENGTH_SCALE = "0.95";

function findPiper(): string | null {
  const candidates = [process.env["PIPER_BIN"], `${process.env["HOME"]}/.local/bin/piper`];
  for (const c of candidates) if (c && existsSync(c)) return c;
  const which = spawnSync("sh", ["-c", "command -v piper"], { encoding: "utf8" });
  return which.status === 0 ? which.stdout.trim() : null;
}

function speak(piper: string, model: string, text: string, out: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(piper, ["-m", model, "-f", out, "--length-scale", LENGTH_SCALE], {
      stdio: ["pipe", "ignore", "pipe"],
    });
    let err = "";
    proc.stderr.on("data", (d: Buffer) => (err += d.toString()));
    proc.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`piper failed on "${text}":\n${err}`))
    );
    proc.stdin.end(text);
  });
}

function durationMs(file: string): number {
  const out = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
    { encoding: "utf8" }
  );
  return Math.round(Number(out.stdout.trim()) * 1000);
}

async function main(): Promise<void> {
  const variant = process.argv[2] ?? "promo";
  if (!isVariant(variant)) throw new Error("variant must be promo or qa");

  const dir = join("local", "video", storyboard.name, variant, "voice");
  rmSync(dir, { recursive: true, force: true });

  if (process.env["CADDY_DEMO_SILENT"] === "1") {
    console.log("CADDY_DEMO_SILENT=1: captions only");
    return;
  }
  const clone = process.env["CADDY_DEMO_CLONE"];
  if (clone) {
    const say = process.env["VOICE_CLONE_SAY"];
    if (!say || !existsSync(say))
      throw new Error("CADDY_DEMO_CLONE needs VOICE_CLONE_SAY=<path to say.ts>");
    mkdirSync(dir, { recursive: true });
    const list = join(dir, "lines.txt");
    writeFileSync(list, `${linesFor(storyboard, variant).join("\n")}\n`);
    const r = spawnSync(
      "bun",
      [say, "en", "--lines", list, "--out", dir, "--voice", clone, "--skip", "typescript,vscode"],
      { stdio: "inherit" }
    );
    if (r.status !== 0) throw new Error(`voice clone failed (exit ${r.status})`);
    return;
  }

  const model = process.env["CADDY_DEMO_VOICE"] ?? DEFAULT_VOICE;
  const piper = findPiper();
  if (!piper || !existsSync(model)) {
    console.log(`no voice: ${!piper ? "piper is not installed" : `${model} is missing`}.`);
    console.log("run `just vscode-demo-voice-install` for narration; the film works without it.");
    return;
  }

  mkdirSync(dir, { recursive: true });
  const lines = linesFor(storyboard, variant);
  const durations: VoiceDurations = {};
  for (const [i, line] of lines.entries()) {
    const file = join(dir, `${String(i + 1).padStart(2, "0")}.wav`);
    await speak(piper, model, line, file);
    durations[line] = { file, ms: durationMs(file) };
    process.stdout.write(`\r${i + 1}/${lines.length} spoken`);
  }
  writeFileSync(join(dir, "voice.json"), `${JSON.stringify(durations, null, 2)}\n`);
  const total = Object.values(durations).reduce((sum, d) => sum + d.ms, 0);
  console.log(`\n${lines.length} lines, ${Math.round(total / 1000)}s of speech (${model})`);
}

await main();
