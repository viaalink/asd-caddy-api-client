#!/usr/bin/env bun
/**
 * Turn a recording + timeline into the finished film.
 * Ported from DigitaleKraamzorg/scripts/video-render.ts.
 *
 * Input (from record.spec.ts): local/video/<storyboard>/<variant>/{recording.mp4,timeline.json}
 * and, if the voice stage ran, voice/voice.json.
 *
 * Output, next to them:
 *   <storyboard>-<variant>.mp4   1920×1080, 30 fps, H.264 + AAC 48 kHz stereo
 *   <storyboard>-<variant>.srt   the captions, timed to the finished film, for upload
 *   steps.png                    one still per step, numbered — review without watching
 *
 * One ffmpeg pass does it all: title card → recording (leader trimmed, ASS
 * captions burned in) → end card, concatenated in a filter graph, with every
 * voice line dropped in at its step's start (adelay + amix). One encode from
 * the recording, so text stays crisp.
 *
 * Variants: promo = cards + plain captions; qa = no cards, captions numbered
 * "12. Scene · caption" so a note can say "it breaks at 12".
 */

import { spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { assColour, BRAND, CARD, ffColour } from "../lib/brand";
import type { Timeline, VoiceDurations } from "../lib/types";

const TITLE_SECONDS = 3.4;

/** Viaalink wordmark (red mark, navy letters, transparent), from the website's static assets. */
const LOGO = resolve(__dirname, "..", "assets", "viaalink-wordmark.png");

/** The same wordmark flattened on a white tab, for the corner of the film (assets/README). */
const LOGO_TAB = resolve(__dirname, "..", "assets", "viaalink-wordmark-tab.png");

/** The logo as an endless still, for overlaying; `movie=` keeps the input list (and voice indexes) untouched. */
function logoSource(width: number, label: string, file = LOGO): string {
  return `movie=${file},loop=loop=-1:size=1,setpts=N/30/TB,format=rgba,scale=${width}:-1[${label}]`;
}
const END_SECONDS = 4.2;
const FADE = 0.35;

/** Roughly what fits on one caption line at 40px in a 1920 frame. */
const WRAP_AT = 66;

const FONT_DIRS = ["/usr/share/fonts/truetype/noto", "/usr/share/fonts/truetype/dejavu"];
const FONTS = {
  regular: ["NotoSans-Regular.ttf", "DejaVuSans.ttf"],
  bold: ["NotoSans-Bold.ttf", "DejaVuSans-Bold.ttf"],
  mono: ["NotoSansMono-Regular.ttf", "DejaVuSansMono.ttf"],
};

function font(kind: keyof typeof FONTS): string | null {
  for (const name of FONTS[kind]) {
    for (const dir of FONT_DIRS) {
      const f = join(dir, name);
      if (existsSync(f)) return f;
    }
  }
  return null;
}

function run(args: string[]): void {
  const res = spawnSync(args[0]!, args.slice(1), { encoding: "utf8", maxBuffer: 1 << 26 });
  if (res.status !== 0) {
    throw new Error(
      `${args[0]} failed (${res.status}):\n${(res.stderr ?? "").split("\n").slice(-30).join("\n")}`
    );
  }
}

/** Break at spaces to fit the frame; at most two lines (fold the rest into the second). */
function wrap(text: string, at = WRAP_AT): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && `${line} ${word}`.length > at) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.length > 2 ? [lines[0]!, lines.slice(1).join(" ")] : lines;
}

function assTime(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${Math.floor(t / 3_600_000)}:${pad(Math.floor((t % 3_600_000) / 60_000))}:${pad(
    Math.floor((t % 60_000) / 1000)
  )}.${pad(Math.floor((t % 1000) / 10))}`;
}

function srtTime(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  const pad = (n: number, w = 2): string => String(n).padStart(w, "0");
  return `${pad(Math.floor(t / 3_600_000))}:${pad(Math.floor((t % 3_600_000) / 60_000))}:${pad(
    Math.floor((t % 60_000) / 1000)
  )},${pad(t % 1000, 3)}`;
}

function captionFor(tl: Timeline, i: number): string {
  const entry = tl.entries[i];
  const raw = entry?.caption.trim() ?? "";
  if (!raw) return "";
  return tl.variant === "promo" ? raw : `${i + 1}. ${entry!.scene} · ${raw}`;
}

/**
 * ASS, not SRT: libass sizes text against the script's PlayResX/Y, and an SRT
 * has none (it falls back to 384×288 and the caption fills the screen).
 * BorderStyle 3 = an opaque box behind the text, which stays readable over
 * any editor content.
 */
function buildAss(tl: Timeline): string {
  const box = assColour(BRAND.slate, 0x30);
  const out = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${tl.width}`,
    `PlayResY: ${tl.height}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour," +
      " BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle," +
      " BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,Noto Sans,40,${assColour(BRAND.text)},${assColour(BRAND.text)},${box},${box},` +
      "0,0,0,0,100,100,0,0,3,14,0,2,120,120,64,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  tl.entries.forEach((entry, i) => {
    const label = captionFor(tl, i);
    if (!label) return;
    const text = wrap(label).join("\\N").replace(/[{}]/g, "");
    out.push(
      `Dialogue: 0,${assTime(entry.startMs)},${assTime(entry.endMs)},Default,,0,0,0,,${text}`
    );
  });
  return `${out.join("\n")}\n`;
}

function buildSrt(tl: Timeline, offsetMs: number): string {
  const blocks: string[] = [];
  tl.entries.forEach((entry, i) => {
    const label = captionFor(tl, i);
    if (!label) return;
    blocks.push(
      `${blocks.length + 1}\n${srtTime(entry.startMs + offsetMs)} --> ${srtTime(
        entry.endMs + offsetMs
      )}\n${wrap(label).join("\n")}\n`
    );
  });
  return `${blocks.join("\n")}\n`;
}

interface CardLine {
  text: string;
  size: number;
  y: string;
  colour: string;
  font: keyof typeof FONTS;
}

/**
 * A card as a filter-graph source: slate background, an accent rule, lines of
 * text. textfile= rather than text= because colons, slashes and apostrophes
 * all mean something to drawtext's own parser.
 */
function cardGraph(
  label: string,
  tl: Timeline,
  seconds: number,
  lines: CardLine[],
  work: string,
  logo?: { width: number; y: number }
): string {
  const parts = [
    `color=c=${ffColour(CARD.background)}:s=${tl.width}x${tl.height}:d=${seconds}:r=30`,
  ];
  // A short red rule above the first line.
  parts.push(
    `drawbox=x=(iw-120)/2:y=${lines[0]?.y ?? "h/2"}-48:w=120:h=6:color=${ffColour(CARD.red)}:t=fill`
  );
  lines.forEach((line, i) => {
    const file = join(work, `${label}-${i}.txt`);
    writeFileSync(file, line.text);
    const f = font(line.font);
    parts.push(
      [
        `drawtext=textfile=${file}`,
        `fontcolor=${ffColour(line.colour)}`,
        `fontsize=${line.size}`,
        "x=(w-text_w)/2",
        `y=${line.y}`,
        "line_spacing=12",
        ...(f ? [`fontfile=${f}`] : []),
      ].join(":")
    );
  });
  const fades = [
    `fade=t=in:st=0:d=${FADE}`,
    `fade=t=out:st=${seconds - FADE}:d=${FADE}`,
    "format=yuv420p",
  ];
  if (!logo || !existsSync(LOGO)) return `${[...parts, ...fades].join(",")}[${label}]`;
  // Logo on the card first, then fade the two together.
  return [
    `${parts.join(",")}[${label}bg]`,
    logoSource(logo.width, `${label}logo`),
    `[${label}bg][${label}logo]overlay=x=(W-w)/2:y=${logo.y}:shortest=1,${fades.join(",")}[${label}]`,
  ].join(";");
}

/** One still per step, numbered, in a 4-wide grid. */
function stepSheet(film: string, tl: Timeline, offsetMs: number, out: string, work: string): void {
  const tiles: string[] = [];
  const mono = font("regular");
  tl.entries.forEach((entry, i) => {
    const at = (offsetMs + entry.endMs - Math.min(600, (entry.endMs - entry.startMs) / 3)) / 1000;
    const label = join(work, `step-${i}.txt`);
    writeFileSync(label, `${i + 1}. ${entry.scene}`);
    const tile = join(work, `step-${String(i).padStart(2, "0")}.png`);
    run([
      "ffmpeg",
      "-y",
      "-loglevel",
      "error",
      "-ss",
      String(at),
      "-i",
      film,
      "-frames:v",
      "1",
      "-vf",
      `scale=480:270,drawtext=textfile=${label}:x=8:y=8:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.75:boxborderw=5${
        mono ? `:fontfile=${mono}` : ""
      }`,
      tile,
    ]);
    tiles.push(tile);
  });
  if (!tiles.length) return;
  const cols = 4;
  const rows = Math.ceil(tiles.length / cols);
  const layout = tiles.map((_, i) => `${(i % cols) * 480}_${Math.floor(i / cols) * 270}`).join("|");
  run([
    "ffmpeg",
    "-y",
    "-loglevel",
    "error",
    ...tiles.flatMap((t) => ["-i", t]),
    "-filter_complex",
    `${tiles.map((_, i) => `[${i}:v]`).join("")}xstack=inputs=${tiles.length}:layout=${layout}:fill=black[out]`,
    "-map",
    "[out]",
    "-s",
    `${cols * 480}x${rows * 270}`,
    out,
  ]);
}

/**
 * Clean stills and GIF clips, cut from the RAW recording (no captions, no
 * cards) — the cursor and keystroke badge stay, they are part of the story.
 * Recording time = leaderMs + timeline time.
 */
function extras(tl: Timeline, dir: string): string[] {
  const made: string[] = [];
  const raw = tl.video;
  const stillDir = join(dir, "stills");
  rmSync(stillDir, { recursive: true, force: true });
  for (const entry of tl.entries) {
    if (!entry.still) continue;
    mkdirSync(stillDir, { recursive: true });
    const out = join(stillDir, `${entry.still}.png`);
    // Just before the step ends: its result, before the next act begins.
    const at = (tl.leaderMs + entry.endMs - 250) / 1000;
    run([
      "ffmpeg",
      "-y",
      "-loglevel",
      "error",
      "-ss",
      String(at),
      "-i",
      raw,
      "-frames:v",
      "1",
      out,
    ]);
    made.push(resolve(out));
  }
  const clips = new Map<string, { from: number; to: number }>();
  for (const entry of tl.entries) {
    if (!entry.clip) continue;
    const span = clips.get(entry.clip);
    clips.set(entry.clip, {
      from: Math.min(span?.from ?? entry.startMs, entry.startMs),
      to: Math.max(span?.to ?? entry.endMs, entry.endMs),
    });
  }
  for (const [name, span] of clips) {
    const out = join(dir, `${name}.gif`);
    run([
      "ffmpeg",
      "-y",
      "-loglevel",
      "error",
      "-ss",
      String((tl.leaderMs + span.from) / 1000),
      "-t",
      String((span.to - span.from) / 1000),
      "-i",
      raw,
      "-filter_complex",
      "fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];" +
        "[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle",
      out,
    ]);
    made.push(resolve(out));
  }
  return made;
}

function main(): void {
  const [name, variant = "promo"] = process.argv.slice(2);
  if (!name) throw new Error("usage: render.ts <storyboard> [promo|qa]");
  const dir = join("local", "video", name, variant);
  const tlPath = join(dir, "timeline.json");
  if (!existsSync(tlPath)) throw new Error(`no timeline at ${tlPath} — record first`);
  const tl = JSON.parse(readFileSync(tlPath, "utf8")) as Timeline;

  const work = join(dir, "work");
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const assPath = resolve(work, "captions.ass");
  writeFileSync(assPath, buildAss(tl));

  const cards = variant === "promo";
  const offsetMs = cards ? Math.round(TITLE_SECONDS * 1000) : 0;
  const film = join(dir, `${name}-${variant}.mp4`);
  writeFileSync(join(dir, `${name}-${variant}.srt`), buildSrt(tl, offsetMs));

  const graph: string[] = [];
  const inputs: string[] = ["-i", tl.video];
  graph.push(
    `[0:v]trim=start=${tl.leaderMs / 1000}:duration=${tl.totalMs / 1000},setpts=PTS-STARTPTS,` +
      `fps=30,subtitles=filename=${assPath}${existsSync(LOGO_TAB) ? "[film]" : ",format=yuv420p[main]"}`
  );
  if (existsSync(LOGO_TAB)) {
    // A small wordmark on a white tab, top right: clear of the editor tabs'
    // actions, and of the bottom right where the status bar item and the
    // "Caddy updated" toast are part of the story.
    graph.push(
      logoSource(228, "bug", LOGO_TAB),
      "[film][bug]overlay=x=W-w-24:y=56:shortest=1,format=yuv420p[main]"
    );
  }
  if (cards) {
    const mid = tl.height / 2;
    // Title: the wordmark, a red rule, the name in navy, what it does in grey.
    // The wordmark is the byline, so the "by Viaalink" line is not drawn.
    graph.push(
      cardGraph(
        "title",
        tl,
        TITLE_SECONDS,
        [
          { text: tl.title, size: 76, y: `${mid - 40}`, colour: CARD.navy, font: "bold" },
          ...(tl.subtitle
            ? [
                {
                  text: wrap(tl.subtitle, 60).join("\n"),
                  size: 34,
                  y: `${mid + 80}`,
                  colour: CARD.muted,
                  font: "regular" as const,
                },
              ]
            : []),
        ],
        work,
        { width: 560, y: mid - 300 }
      )
    );
    // End: the wordmark, how to install, where everything lives, the site.
    // closing = [install command, ...links, site].
    const install = tl.closing[0];
    const site = tl.closing.length > 1 ? tl.closing[tl.closing.length - 1] : undefined;
    const links = tl.closing.slice(1, -1);
    graph.push(
      cardGraph(
        "end",
        tl,
        END_SECONDS,
        [
          {
            text: "Install from the VS Code Marketplace",
            size: 38,
            y: `${mid - 200}`,
            colour: CARD.muted,
            font: "regular",
          },
          ...(install
            ? [
                {
                  text: install,
                  size: 52,
                  y: `${mid - 130}`,
                  colour: CARD.navy,
                  font: "mono" as const,
                },
              ]
            : []),
          ...links.map((text, i) => ({
            text,
            size: 28,
            y: `${mid - 10 + i * 52}`,
            colour: CARD.navy,
            font: "regular" as const,
          })),
          ...(site
            ? [
                {
                  text: site,
                  size: 44,
                  y: `${mid + 40 + links.length * 52}`,
                  colour: CARD.red,
                  font: "bold" as const,
                },
              ]
            : []),
        ],
        work,
        { width: 440, y: mid - 400 }
      )
    );
    graph.push("[title][main][end]concat=n=3:v=1:a=0[v]");
  } else {
    graph.push("[main]null[v]");
  }

  // The voice, every line placed where its step starts in the finished film.
  const voicePath = join(dir, "voice", "voice.json");
  let audio = false;
  if (existsSync(voicePath)) {
    const voice = JSON.parse(readFileSync(voicePath, "utf8")) as VoiceDurations;
    const used = tl.entries
      .map((entry) => ({ entry, clip: voice[entry.say] }))
      .filter(
        (x): x is { entry: (typeof tl.entries)[number]; clip: { file: string; ms: number } } =>
          Boolean(x.clip && existsSync(x.clip.file))
      );
    used.forEach((x, i) => {
      inputs.push("-i", x.clip.file);
      const at = offsetMs + x.entry.startMs;
      graph.push(`[${i + 1}:a]aresample=48000,adelay=${at}|${at}[a${i}]`);
    });
    if (used.length) {
      // Padded to the film's length so the audio track does not end before the end card.
      const filmSeconds = (offsetMs + tl.totalMs) / 1000 + (cards ? END_SECONDS : 0);
      graph.push(
        `${used.map((_, i) => `[a${i}]`).join("")}amix=inputs=${used.length}:normalize=0,` +
          `apad=whole_dur=${filmSeconds}[a]`
      );
      audio = true;
    }
  }

  run([
    "ffmpeg",
    "-y",
    "-loglevel",
    "error",
    ...inputs,
    "-filter_complex",
    graph.join(";"),
    "-map",
    "[v]",
    ...(audio ? ["-map", "[a]"] : []),
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "30",
    ...(audio ? ["-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2"] : []),
    // No -shortest: the voice ends before the end card and must not cut it off.
    "-movflags",
    "+faststart",
    film,
  ]);

  stepSheet(film, tl, offsetMs, join(dir, "steps.png"), work);
  for (const f of extras(tl, dir)) console.error(`extra: ${f}`);
  rmSync(work, { recursive: true, force: true });
  console.log(resolve(film));
}

main();
