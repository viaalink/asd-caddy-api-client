/**
 * The on-screen cursor, click ripple and keystroke badge.
 *
 * Playwright drives the mouse through CDP, so the recording has no pointer at
 * all — a viewer sees menus open by themselves. This init script draws one: an
 * arrow that follows every `mousemove` the page receives, a ripple on every
 * `mousedown`, and a small badge (e.g. "Ctrl + Space") that ./actions.ts shows
 * before pressing a shortcut.
 *
 * It lives in its own fixed, pointer-events:none layer on <html>, outside the
 * workbench's DOM, so it can never intercept a click or be re-rendered away.
 * Only the top frame gets it; code-server's webview/worker iframes are skipped.
 */

import type { Page } from "@playwright/test";
import { BRAND } from "./brand";

interface OverlayConfig {
  accent: string;
  surface: string;
  text: string;
}

declare global {
  interface Window {
    __demoKeys?: (label: string) => void;
  }
}

/** Runs in the page. Must be self-contained: Playwright serialises it. */
function overlayInit(cfg: OverlayConfig): void {
  if (window.top !== window) return;

  const install = (): void => {
    if (document.getElementById("__demo_overlay")) return;
    const style = document.createElement("style");
    style.textContent = `
      #__demo_overlay { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; }
      #__demo_cursor { position: absolute; left: 0; top: 0; width: 26px; height: 26px;
        transform: translate(-100px, -100px); will-change: transform;
        filter: drop-shadow(0 2px 3px rgba(0,0,0,.55)); transition: scale 90ms ease-out; }
      #__demo_cursor.down { scale: .86; }
      .__demo_ripple { position: absolute; width: 14px; height: 14px; margin: -7px 0 0 -7px;
        border-radius: 50%; border: 3px solid ${cfg.accent}; background: ${cfg.accent}33;
        animation: __demo_ripple 520ms cubic-bezier(.2,.7,.3,1) forwards; }
      @keyframes __demo_ripple { from { transform: scale(.4); opacity: 1 }
        to { transform: scale(4); opacity: 0 } }
      #__demo_keys { position: absolute; right: 28px; bottom: 44px; display: flex; gap: 6px;
        align-items: center; padding: 8px 12px; border-radius: 10px; background: ${cfg.surface}EE;
        border: 1px solid ${cfg.accent}; box-shadow: 0 6px 24px rgba(0,0,0,.45);
        font: 600 15px/1 "Noto Sans", "DejaVu Sans", system-ui, sans-serif; color: ${cfg.text};
        opacity: 0; transform: translateY(8px); transition: opacity 160ms, transform 160ms; }
      #__demo_keys.show { opacity: 1; transform: none; }
      #__demo_keys kbd { font: inherit; padding: 4px 9px; border-radius: 6px;
        background: #0B1220; border: 1px solid #334155; border-bottom-width: 3px; }
      #__demo_keys span { color: ${cfg.accent}; }
    `;
    const layer = document.createElement("div");
    layer.id = "__demo_overlay";
    layer.innerHTML =
      '<svg id="__demo_cursor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M4 2.5 L4 19.5 L8.6 15.2 L11.6 21.8 L14.6 20.5 L11.7 14 L18 14 Z" ' +
      'fill="#FFFFFF" stroke="#0B1220" stroke-width="1.4" stroke-linejoin="round"/></svg>' +
      '<div id="__demo_keys"></div>';
    document.documentElement.appendChild(style);
    document.documentElement.appendChild(layer);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }

  const cursor = (): HTMLElement | null => document.getElementById("__demo_cursor");

  window.addEventListener(
    "mousemove",
    (e) => {
      const c = cursor();
      if (c) c.style.transform = `translate(${e.clientX - 4}px, ${e.clientY - 2}px)`;
    },
    { capture: true, passive: true }
  );
  window.addEventListener(
    "mousedown",
    (e) => {
      const layer = document.getElementById("__demo_overlay");
      cursor()?.classList.add("down");
      if (!layer) return;
      const ripple = document.createElement("div");
      ripple.className = "__demo_ripple";
      ripple.style.left = `${e.clientX}px`;
      ripple.style.top = `${e.clientY}px`;
      layer.appendChild(ripple);
      setTimeout(() => ripple.remove(), 600);
    },
    { capture: true, passive: true }
  );
  window.addEventListener("mouseup", () => cursor()?.classList.remove("down"), {
    capture: true,
    passive: true,
  });

  let hideTimer: number | undefined;
  window.__demoKeys = (label: string): void => {
    const badge = document.getElementById("__demo_keys");
    if (!badge) return;
    badge.innerHTML = label
      .split(" + ")
      .map((k) => `<kbd>${k.replace(/</g, "&lt;")}</kbd>`)
      .join("<span>+</span>");
    badge.classList.add("show");
    if (hideTimer !== undefined) clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => badge.classList.remove("show"), 1400);
  };
}

/** Inject the overlay into every page of the context, now and on reloads. */
export async function installOverlay(page: Page): Promise<void> {
  const cfg: OverlayConfig = { accent: BRAND.accent, surface: BRAND.surface, text: BRAND.text };
  await page.addInitScript(overlayInit, cfg);
}
