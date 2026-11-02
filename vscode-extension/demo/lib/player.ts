/**
 * Playing a storyboard. Ported from DigitaleKraamzorg/tests/e2e/bundle/player.ts.
 *
 * TIMING (plus a SETTLE_MS floor after the act, so a result is never off screen at once)
 * Every step gets a window that starts when its act starts and lasts at least
 * `max(hold * pace, spokenMs + tailMs(line))`. The act's own duration counts towards
 * that window — a step that takes two seconds to type does not then sit still
 * for another two. What is left is waited out, so subtitles and voice line up
 * with the picture without measuring anything afterwards.
 *
 * The voice durations come from the voice stage, which runs BEFORE recording:
 * the only order in which the picture can be cut to the words.
 */

import { test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { Storyboard, TimelineEntry, Variant, VoiceDurations } from "./types";
import { stepsFor } from "./types";

/** How long a step stays on screen when it does not ask for longer. */
const DEFAULT_HOLD_MS = 1600;

/**
 * Breath after a spoken line, so the next one does not tread on it — by how the
 * line ends, the way a speaker pauses: barely after a comma (the thought goes
 * on), a beat after a question, a little more after a full stop. The voice
 * clips are trimmed to the words (voice-clone's cleanup), so this IS the pause.
 */
function tailMs(line: string): number {
  const end = line.trim().slice(-1);
  if (end === "," || end === "…" || end === ":") return 120;
  if (end === "?") return 300;
  return 350;
}

/**
 * Least time the RESULT of an act stays on screen. Without it a step whose act
 * outlasts its hold (open a file, type a line) shows its result for zero
 * frames: the next step's first keypress follows immediately.
 */
const SETTLE_MS = 900;

export interface PlayOptions {
  variant: Variant;
  /** Multiplies every silent hold; never shortens a spoken line. */
  pace?: number;
  /** What the voice stage measured. Absent means no voice. */
  voice?: VoiceDurations;
}

export interface PlayResult {
  /** Wall clock (epoch ms) at the first step, for working out the recording's leader. */
  startedAt: number;
  totalMs: number;
  entries: TimelineEntry[];
}

/**
 * `result` is filled in as the steps run, so a failing step still leaves a
 * partial timeline behind for the render stage — the fastest way to see why.
 */
export async function play(
  page: Page,
  board: Storyboard,
  options: PlayOptions,
  result: PlayResult = { startedAt: 0, totalMs: 0, entries: [] }
): Promise<PlayResult> {
  const { variant, pace = 1, voice } = options;
  const steps = stepsFor(board, variant);
  const entries = result.entries;

  const startedAt = Date.now();
  result.startedAt = startedAt;
  const since = (): number => Date.now() - startedAt;

  for (const [i, { scene, step }] of steps.entries()) {
    const line = step.say ?? step.caption;
    const startMs = since();

    try {
      await test.step(`${i + 1}. ${scene} · ${step.caption}`, async () => {
        await step.act(page);
        if (step.check) await step.check(page);
      });
    } catch (err) {
      // Keep the failing step in the timeline so the partial render shows it.
      entries.push({ scene, caption: `FAILED: ${step.caption}`, say: "", startMs, endMs: since() });
      result.totalMs = since();
      throw err;
    }

    const spokenMs = voice?.[line]?.ms ?? 0;
    const window = Math.max(
      (step.hold ?? DEFAULT_HOLD_MS) * pace,
      spokenMs + (spokenMs ? tailMs(line) : 0)
    );
    const left = Math.max(window - (since() - startMs), SETTLE_MS * pace);
    if (left > 0) await page.waitForTimeout(left);

    entries.push({
      scene,
      caption: step.caption,
      say: line,
      startMs,
      endMs: since(),
      ...(step.still ? { still: step.still } : {}),
      ...(step.clip ? { clip: step.clip } : {}),
    });
    result.totalMs = since();
  }

  return result;
}
