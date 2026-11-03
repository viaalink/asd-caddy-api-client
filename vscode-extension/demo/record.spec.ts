/**
 * Film the storyboard. Ported from DigitaleKraamzorg/tests/e2e/bundle/record.spec.ts.
 *
 * Only run through `just vscode-demo-video` (demo/playwright.config.ts), never
 * by `just vscode-test`.
 *
 * WHY ITS OWN BROWSER
 * The film is 1920×1080 of a 1280×720 layout — VS Code at 150 % — which needs
 * a real device scale factor (--force-device-scale-factor) rather than
 * Playwright's emulated one, and full Chromium rather than the headless shell.
 * See lib/recorder.ts for why Playwright's own recordVideo cannot do this.
 *
 * Only one page is ever opened: every extra tab would be a second film.
 *
 * Everything before the first step — loading the workbench, `prepare` — is the
 * leader. Its length goes into the timeline and the render stage trims it.
 */

import { chromium, test } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join, relative, resolve } from "path";
import { PORT_FILE } from "./global-setup";
import { installOverlay } from "./lib/overlay";
import { play, type PlayResult } from "./lib/player";
import { ScreenRecorder } from "./lib/recorder";
import type { Timeline, Variant, VoiceDurations } from "./lib/types";
import { isVariant } from "./lib/types";
import { openWorkbench } from "./lib/vscode";
import { storyboard } from "./storyboard";

const LAYOUT = { width: 1280, height: 720 };
const SCALE = 1.5;
const FRAME = { width: LAYOUT.width * SCALE, height: LAYOUT.height * SCALE };

const EXT_ROOT = resolve(__dirname, "..");
const RAW_VARIANT = process.env["DEMO_VARIANT"] ?? "promo";
const PACE = Number(process.env["DEMO_PACE"] ?? "1");
const VOICE_FILE = process.env["DEMO_VOICE"] ?? "";

test("record storyboard", async () => {
  test.setTimeout(15 * 60 * 1000);
  if (!isVariant(RAW_VARIANT)) throw new Error("DEMO_VARIANT must be promo or qa");
  const variant: Variant = RAW_VARIANT;

  const outDir = join(EXT_ROOT, "local", "video", storyboard.name, variant);
  mkdirSync(outDir, { recursive: true });
  const videoPath = join(outDir, "recording.mp4");
  rmSync(videoPath, { force: true });

  const voice: VoiceDurations | undefined =
    VOICE_FILE && existsSync(VOICE_FILE)
      ? (JSON.parse(readFileSync(VOICE_FILE, "utf8")) as VoiceDurations)
      : undefined;

  const port = readFileSync(PORT_FILE, "utf8").trim();
  const browser = await chromium.launch({
    channel: "chromium",
    args: [
      `--force-device-scale-factor=${SCALE}`,
      `--window-size=${LAYOUT.width},${LAYOUT.height + 100}`,
      "--hide-scrollbars",
    ],
  });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  await installOverlay(page);

  // With viewport: null the window decides the layout size; nudge the window
  // until the page itself is exactly 1280×720.
  const cdp = await context.newCDPSession(page);
  const { windowId } = (await cdp.send("Browser.getWindowForTarget")) as { windowId: number };
  for (let i = 0; i < 4; i++) {
    const [w, h] = await page.evaluate(() => [window.innerWidth, window.innerHeight]);
    if (w === LAYOUT.width && h === LAYOUT.height) break;
    const { bounds } = (await cdp.send("Browser.getWindowBounds", { windowId })) as {
      bounds: { width: number; height: number };
    };
    await cdp.send("Browser.setWindowBounds", {
      windowId,
      bounds: { width: bounds.width + LAYOUT.width - w, height: bounds.height + LAYOUT.height - h },
    });
    await page.waitForTimeout(100);
  }

  await openWorkbench(page, `http://127.0.0.1:${port}/`);
  // Let the extension host start and the first paint settle before filming.
  await page.waitForTimeout(2500);

  const recorder = await ScreenRecorder.start(page, { out: videoPath, ...FRAME });
  const result: PlayResult = { startedAt: 0, totalMs: 0, entries: [] };
  try {
    if (storyboard.prepare) await storyboard.prepare(page);
    await play(page, storyboard, { variant, pace: PACE, voice }, result);
  } finally {
    await page.waitForTimeout(400);
    await recorder.stop();
    await context.close();
    await browser.close();
    // Written even when a step failed: `bun demo/scripts/render.ts` on the
    // partial timeline shows exactly where and what the screen looked like.
    if (result.startedAt) writeTimeline();
  }

  function writeTimeline(): void {
    const timeline: Timeline = {
      storyboard: storyboard.name,
      title: storyboard.title,
      ...(storyboard.subtitle ? { subtitle: storyboard.subtitle } : {}),
      ...(storyboard.byline ? { byline: storyboard.byline } : {}),
      closing: storyboard.closing,
      ...(storyboard.intro ? { intro: storyboard.intro } : {}),
      ...(storyboard.agenda ? { agenda: storyboard.agenda } : {}),
      ...(storyboard.outro ? { outro: storyboard.outro } : {}),
      variant,
      video: relative(EXT_ROOT, videoPath),
      width: FRAME.width,
      height: FRAME.height,
      leaderMs: result.startedAt - recorder.startedAtMs,
      totalMs: result.totalMs,
      entries: result.entries,
    };
    writeFileSync(join(outDir, "timeline.json"), `${JSON.stringify(timeline, null, 2)}\n`);
  }
});
