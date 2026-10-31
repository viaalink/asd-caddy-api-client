/**
 * One palette for everything the pipeline draws: title/end cards, the caption
 * box, the cursor ripple and the keystroke badge. A neutral dark slate with a
 * single cyan accent, so the cards sit comfortably next to VS Code's
 * "Default Dark Modern" theme.
 */
export const BRAND = {
  /** Card background. */
  slate: "#0F172A",
  /** Raised surface (badge, caption box). */
  surface: "#1E293B",
  /** The one accent colour. */
  accent: "#00ADD8",
  /** Primary text. */
  text: "#F1F5F9",
  /** Secondary text. */
  muted: "#94A3B8",
} as const;

/** `#RRGGBB` → ffmpeg's `0xRRGGBB`. */
export function ffColour(hex: string): string {
  return `0x${hex.replace("#", "")}`;
}

/** `#RRGGBB` + alpha (0 opaque … 255 clear) → ASS `&HAABBGGRR`. */
export function assColour(hex: string, alpha = 0): string {
  const h = hex.replace("#", "");
  const [r, g, b] = [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)];
  const a = alpha.toString(16).padStart(2, "0");
  return `&H${a}${b}${g}${r}`.toUpperCase();
}
