/**
 * A crisp 1080p screen recorder for one page, over CDP.
 *
 * WHY NOT PLAYWRIGHT'S recordVideo
 * It captures CSS pixels: a 1280×720 viewport at deviceScaleFactor 1.5 comes
 * out as a 1280×720 picture padded with grey to the requested 1920×1080. And
 * a 1920×1080 CSS viewport makes VS Code's 13px UI unreadable on a phone.
 *
 * What works is a 1280×720 layout rendered at a real device scale factor of
 * 1.5 (Chromium's --force-device-scale-factor, see record.spec.ts) and filmed
 * with Page.startScreencast, which then hands over 1920×1080 device-pixel
 * frames. The screencast only sends a frame when something changes, so this
 * turns that variable-rate stream into constant 30 fps on the fly — each frame
 * is repeated until the next one is due — and pipes it straight into ffmpeg.
 *
 * Frames carry their own wall-clock timestamp, so `startedAtMs` (the first
 * frame) and the player's Date.now() are on the same clock: the difference is
 * the leader the render stage trims.
 */

import { spawn, type ChildProcess } from "child_process";
import type { CDPSession, Page } from "@playwright/test";

export interface RecorderOptions {
  out: string;
  width: number;
  height: number;
  fps?: number;
}

interface ScreencastFrame {
  data: string;
  sessionId: number;
  metadata: { timestamp?: number };
}

export class ScreenRecorder {
  private ffmpeg: ChildProcess;
  private exited: Promise<number>;
  private cdp: CDPSession;
  private last: Buffer | null = null;
  private written = 0;
  private frameMs: number;
  private stderr = "";
  /** Epoch ms of the first frame; the recording's time zero. */
  startedAtMs = 0;

  private constructor(cdp: CDPSession, opts: RecorderOptions) {
    this.cdp = cdp;
    const fps = opts.fps ?? 30;
    this.frameMs = 1000 / fps;
    this.ffmpeg = spawn(
      "ffmpeg",
      [
        "-y",
        "-loglevel",
        "error",
        "-f",
        "image2pipe",
        "-c:v",
        "mjpeg",
        "-framerate",
        String(fps),
        "-i",
        "-",
        "-vf",
        // The device-pixel frame can be a pixel or two off 1920×1080 when the
        // window chrome does not divide evenly by 1.5; a lanczos nudge is invisible.
        `scale=${opts.width}:${opts.height}:flags=lanczos,setsar=1,format=yuv420p`,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "14",
        "-r",
        String(fps),
        opts.out,
      ],
      { stdio: ["pipe", "ignore", "pipe"] }
    );
    this.ffmpeg.stderr?.on("data", (d: Buffer) => (this.stderr += d.toString()));
    this.exited = new Promise((resolve) => this.ffmpeg.on("exit", (code) => resolve(code ?? 1)));
  }

  static async start(page: Page, opts: RecorderOptions): Promise<ScreenRecorder> {
    const cdp = await page.context().newCDPSession(page);
    const rec = new ScreenRecorder(cdp, opts);
    cdp.on("Page.screencastFrame", (frame: ScreencastFrame) => {
      rec.onFrame(frame);
      cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {});
    });
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 92,
      maxWidth: opts.width,
      maxHeight: opts.height,
      everyNthFrame: 1,
    });
    // Wait for the first frame so startedAtMs is real before anyone reads it.
    const deadline = Date.now() + 5000;
    while (!rec.startedAtMs && Date.now() < deadline) await page.waitForTimeout(20);
    if (!rec.startedAtMs) throw new Error("screencast produced no frame within 5s");
    return rec;
  }

  private onFrame(frame: ScreencastFrame): void {
    const ts = frame.metadata.timestamp ? frame.metadata.timestamp * 1000 : Date.now();
    const buf = Buffer.from(frame.data, "base64");
    if (!this.startedAtMs) this.startedAtMs = ts;
    this.fillUntil(ts);
    this.last = buf;
  }

  /** Repeat the previous frame for every 30 fps tick that has passed before `ts`. */
  private fillUntil(ts: number): void {
    if (!this.last) return;
    const due = Math.floor((ts - this.startedAtMs) / this.frameMs);
    while (this.written < due) {
      this.ffmpeg.stdin?.write(this.last);
      this.written++;
    }
  }

  /** Stop filming; resolves once the mp4 is fully written. */
  async stop(): Promise<{ durationMs: number }> {
    await this.cdp.send("Page.stopScreencast").catch(() => {});
    const end = Date.now();
    this.fillUntil(end);
    if (this.last && this.written === 0) {
      this.ffmpeg.stdin?.write(this.last);
      this.written++;
    }
    this.ffmpeg.stdin?.end();
    const code = await this.exited;
    if (code !== 0) throw new Error(`ffmpeg (recorder) failed:\n${this.stderr}`);
    return { durationMs: this.written * this.frameMs };
  }
}
