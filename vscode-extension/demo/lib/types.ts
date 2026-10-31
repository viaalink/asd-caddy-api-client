/**
 * The vocabulary of a demo storyboard.
 *
 * Ported from DigitaleKraamzorg/tests/e2e/bundle/types.ts. A storyboard is one
 * walk through the extension written down once, as steps a user takes; from it
 * we make two films:
 *
 *   promo  title card, burned-in captions, voice, end card — the blog video
 *   qa     no cards, numbered captions, slower — for checking each feature
 *
 * The variants differ in pace, captions and which steps they include. They do
 * NOT differ in what is done to the editor: one act, filmed twice.
 *
 * WHAT MAY GO IN AN `act`
 * Only what a user can do in VS Code: move the mouse, click, type, press keys.
 * No writing files behind the editor's back, no executing commands through an
 * API. Use the helpers in ./actions.ts so the cursor overlay shows every move.
 */

import type { Page } from "@playwright/test";

export type Variant = "promo" | "qa";

export const VARIANTS: readonly Variant[] = ["promo", "qa"];

export function isVariant(value: string): value is Variant {
  return (VARIANTS as readonly string[]).includes(value);
}

export interface Step {
  /**
   * Burned into the picture, and read out when there is no separate `say`.
   * One line: a 1920px frame holds roughly 70 characters before it wraps.
   */
  caption: string;

  /** What the voice says, when that should differ from what is on screen. */
  say?: string;

  /** The user's action. */
  act(page: Page): Promise<void>;

  /**
   * What must be true once the action is done — e.g. "the suggest widget is
   * visible". Runs in every variant, so a broken feature fails the recording
   * instead of quietly filming nothing.
   */
  check?(page: Page): Promise<void>;

  /** Minimum time on screen after the act starts, in ms before the pace multiplier. */
  hold?: number;

  /**
   * Variants this step appears in. Left out means all of them; `[]` parks a
   * step (kept in the storyboard, filmed by nobody) — say why in a comment.
   */
  only?: readonly Variant[];
}

export interface Scene {
  /** Chapter title; the qa captions are prefixed with it. */
  title: string;
  steps: readonly Step[];
  /** Same as Step.only, for a whole scene. */
  only?: readonly Variant[];
}

export interface Storyboard {
  /** File-safe; also the stem of everything this storyboard produces. */
  name: string;
  /** The title card. */
  title: string;
  /** One line under the title. */
  subtitle?: string;
  /** Small line at the bottom of the title card ("by Viaalink"). */
  byline?: string;
  /** End card lines, top to bottom. */
  closing: readonly string[];
  /**
   * Runs once before the first step and is trimmed out of the film with the
   * leader: open the workbench, settle the layout.
   */
  prepare?(page: Page): Promise<void>;
  scenes: readonly Scene[];
}

/** One step as it ended up in the recording, in milliseconds from the first step. */
export interface TimelineEntry {
  scene: string;
  caption: string;
  say: string;
  startMs: number;
  endMs: number;
}

export interface Timeline {
  storyboard: string;
  title: string;
  subtitle?: string;
  byline?: string;
  closing: readonly string[];
  variant: Variant;
  /** The recording, relative to vscode-extension/. */
  video: string;
  width: number;
  height: number;
  /** Time between the recording's first frame and the first step — trimmed off. */
  leaderMs: number;
  totalMs: number;
  entries: TimelineEntry[];
}

/** What the voice stage measured, keyed by the line it spoke. */
export type VoiceDurations = Record<string, { file: string; ms: number }>;

/** The steps of one storyboard in the order a given variant plays them. */
export function stepsFor(board: Storyboard, variant: Variant): { scene: string; step: Step }[] {
  const out: { scene: string; step: Step }[] = [];
  for (const scene of board.scenes) {
    if (scene.only && !scene.only.includes(variant)) continue;
    for (const step of scene.steps) {
      if (step.only && !step.only.includes(variant)) continue;
      out.push({ scene: scene.title, step });
    }
  }
  return out;
}

/** Every line the voice has to speak for a variant, deduplicated, in order. */
export function linesFor(board: Storyboard, variant: Variant): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const { step } of stepsFor(board, variant)) {
    const line = step.say ?? step.caption;
    if (!line.trim() || seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }
  return lines;
}
