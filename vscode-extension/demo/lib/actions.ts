/**
 * Human-looking input for the recording.
 *
 * Every helper here does what a person would do, at a person's speed, so the
 * cursor overlay (./overlay.ts) has something to show: the mouse glides along
 * an eased path instead of teleporting, clicks leave a ripple, shortcuts flash
 * a keystroke badge, and text is typed with a little jitter between keys.
 *
 * Playwright does not expose the mouse position, so it is tracked here per page.
 */

import type { Locator, Page } from "@playwright/test";

interface Point {
  x: number;
  y: number;
}

const positions = new WeakMap<Page, Point>();

function current(page: Page): Point {
  const vp = page.viewportSize() ?? { width: 1280, height: 720 };
  return positions.get(page) ?? { x: vp.width * 0.62, y: vp.height * 0.55 };
}

const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** Glide the mouse to a point along an eased path (≈ 60 fps). */
export async function moveTo(page: Page, to: Point): Promise<void> {
  const from = current(page);
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const duration = Math.min(900, Math.max(280, dist * 0.9));
  const steps = Math.max(8, Math.round(duration / 16));
  // A slight arc reads as a hand, not a robot.
  const bend = Math.min(40, dist * 0.08);
  for (let i = 1; i <= steps; i++) {
    const t = easeInOut(i / steps);
    const arc = Math.sin(Math.PI * t) * bend;
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t - arc;
    await page.mouse.move(x, y);
    await page.waitForTimeout(12);
  }
  positions.set(page, to);
}

/** Centre of a locator (or a point inside it, as fractions of its box). */
async function pointOf(target: Locator, fx = 0.5, fy = 0.5): Promise<Point> {
  await target.waitFor({ state: "visible", timeout: 10000 });
  const box = await target.boundingBox();
  if (!box) throw new Error(`no bounding box for ${target.toString()}`);
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

export interface PointerOptions {
  /** Where inside the element, as fractions of its box (default centre). */
  at?: [number, number];
  double?: boolean;
}

/** Glide to an element and hover there. */
export async function hover(page: Page, target: Locator, opts: PointerOptions = {}): Promise<void> {
  const [fx, fy] = opts.at ?? [0.5, 0.5];
  await moveTo(page, await pointOf(target, fx, fy));
}

/** Glide to an element and click it (with a visible ripple). */
export async function click(page: Page, target: Locator, opts: PointerOptions = {}): Promise<void> {
  await hover(page, target, opts);
  await page.waitForTimeout(120);
  const p = current(page);
  await page.mouse.click(p.x, p.y, { clickCount: opts.double ? 2 : 1, delay: 60 });
}

/** "Control+Shift+p" → "Ctrl + Shift + P". */
export function keyLabel(combo: string): string {
  const names: Record<string, string> = {
    Control: "Ctrl",
    Meta: "Cmd",
    ArrowDown: "↓",
    ArrowUp: "↑",
    Escape: "Esc",
  };
  return combo
    .split("+")
    .map((k) => names[k] ?? (k.length === 1 ? k.toUpperCase() : k))
    .join(" + ");
}

/** Press a key or shortcut, showing it in the keystroke badge first. */
export async function press(
  page: Page,
  combo: string,
  opts: { badge?: boolean } = {}
): Promise<void> {
  if (opts.badge !== false) {
    await page.evaluate((label) => window.__demoKeys?.(label), keyLabel(combo));
    await page.waitForTimeout(140);
  }
  await page.keyboard.press(combo);
}

/** Press a key without a badge — for plumbing like arrow keys and Escape. */
export async function key(page: Page, combo: string, times = 1): Promise<void> {
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(combo);
    if (times > 1) await page.waitForTimeout(25);
  }
}

/** Type like a person: 35–65 ms per key, a little longer after punctuation. */
export async function type(page: Page, text: string): Promise<void> {
  for (const ch of text) {
    await page.keyboard.type(ch);
    const base = 35 + Math.random() * 30;
    await page.waitForTimeout(/[ ,.:"{}[\]]/.test(ch) ? base + 25 : base);
  }
}

/** A beat, for the viewer to take in what just happened. */
export async function beat(page: Page, ms = 500): Promise<void> {
  await page.waitForTimeout(ms);
}

/** Park the cursor somewhere neutral so it does not cover what the step shows. */
export async function park(page: Page, where: Point = { x: 1180, y: 640 }): Promise<void> {
  await moveTo(page, where);
}
