/**
 * THE MITM STORYBOARD — live traffic inspection with Caddy and mitmproxy.
 *
 * Films the repo-root demo (demo/, `just demo start`): a product search app,
 * its API and Elasticsearch behind a Caddy that @viaalink/caddy-api-client
 * reconfigures at runtime. Everything on screen is the running demo; the code
 * cards are cut from the real files when the film is made.
 *
 * Same rules as ./storyboard.ts: every step does what a user would do and
 * checks that it worked, so a broken demo fails the recording.
 *
 * Render: `just demo-video promo` / `just demo-video qa`.
 *
 * Write the captions as they should read; words in capitals are spoken as
 * abbreviations, letter by letter (API, ID, CLI).
 *
 * Script approved by Kelvin (2026-11-04), published: https://youtu.be/Jt4BY9unm9k
 */

import { expect, type Locator, type Page } from "product-video/test";
import { click, dragTo, hover, moveTo, park } from "product-video/actions";
import { showCode } from "product-video/codecard";
import { assertDemoUp, demoUrl, resetDemo } from "./lib/mitm-demo";
import type { Scene, Storyboard } from "product-video/types";
import { resolve } from "path";

/** The opening diagram (assets/mitm-why.html): one animated stage per spoken line. */
const WHY_PAGE = `file://${resolve(__dirname, "assets/mitm-why.html")}`;

/** Play one stage of the diagram and wait until its animation has finished. */
async function stage(page: Page, n: number): Promise<void> {
  await page.evaluate((i) => (window as unknown as { stage(n: number): void }).stage(i), n);
  await page.waitForFunction(() => (window as unknown as { stageDone: boolean }).stageDone, null, {
    timeout: 30000,
  });
}

/** Load the demo dashboard, with mitmweb ready in its frame. */
async function openDashboard(page: Page): Promise<void> {
  await page.goto(demoUrl("/dashboard"));
  await expect(mitmweb(page).locator("body")).toContainText(/mitmproxy|Flow List/i);
  await expect(page.locator("#flow-control")).not.toHaveClass(/capturing/);
}

const app = (page: Page) => page.frameLocator("#app-iframe");
const mitmweb = (page: Page) => page.frameLocator("#iframe-es");
const flowRows = (page: Page): Locator => mitmweb(page).locator("tbody tr.has-request");
const flowDetail = (page: Page): Locator => mitmweb(page).locator(".flow-detail");

/** Click a flow in mitmweb and wheel its detail pane down until the request body is in view. */
async function openFlow(page: Page, row: Locator): Promise<void> {
  await click(page, row);
  const detail = flowDetail(page);
  await expect(detail).toBeVisible();
  const box = await detail.boundingBox();
  if (!box) throw new Error("no bounding box for the flow detail");
  // The body starts under mitmweb's "View: auto" bar; bring that bar near the top.
  const bodyBar = detail.getByText(/View:/).first();
  await moveTo(page, { x: box.x + box.width / 2, y: box.y + box.height * 0.6 });
  for (let i = 0; i < 30; i++) {
    const bar = await bodyBar.boundingBox();
    if (bar && bar.y < box.y + box.height * 0.3) return;
    await page.mouse.wheel(0, 60);
    await page.waitForTimeout(50);
  }
}

/** Open a flow's Response tab and wheel until `text` sits in the upper half of the detail pane. */
async function showInResponse(page: Page, row: Locator, text: string): Promise<void> {
  await click(page, row);
  const detail = flowDetail(page);
  await expect(detail).toBeVisible();
  await click(page, detail.locator("nav a", { hasText: /^Response$/ }));
  const target = detail.getByText(text).first();
  await expect(target).toBeAttached();
  const box = await detail.boundingBox();
  if (!box) throw new Error("no bounding box for the flow detail");
  await moveTo(page, { x: box.x + box.width / 2, y: box.y + box.height * 0.6 });
  for (let i = 0; i < 40; i++) {
    const at = await target.boundingBox();
    if (at && at.y > box.y && at.y < box.y + box.height * 0.5) return;
    await page.mouse.wheel(0, 60);
    await page.waitForTimeout(50);
  }
  throw new Error(`"${text}" never scrolled into view in the response`);
}

const why: Scene = {
  title: "Why",
  steps: [
    {
      caption:
        "Some queries are never written down: the backend builds them from whatever the user picked. Filters, categories, checkboxes, sort order.",
      act: async (page) => stage(page, 1),
      hold: 3000,
    },
    {
      caption:
        "Reading that code shows you the pieces, not the query that actually reaches Elasticsearch. Watching the traffic shows you exactly that.",
      act: async (page) => stage(page, 2),
      hold: 3000,
    },
    {
      caption:
        "Our Caddy client library puts mitmproxy, a man-in-the-middle proxy, between two services while they run, and takes it out again, without a restart.",
      act: async (page) => stage(page, 3),
      hold: 3000,
      still: "mitm-why-swap",
    },
    {
      caption: "In this video",
      say: "In this video: the demo, inspecting with one click, two bugs found on the wire, how the code does it, and how the Viaalink CLI gives you the same, on demand.",
      act: async (page) => stage(page, 4),
      hold: 3000,
    },
  ],
};

const theDemo: Scene = {
  title: "The demo",
  steps: [
    {
      caption: "A product search, its backend and Elasticsearch, all behind Caddy.",
      act: async (page) => {
        await openDashboard(page);
        for (const id of ["Browser", "Caddy", "MITM", "ES"]) {
          await hover(page, page.locator("#flow-control .flow-node", { hasText: id }));
          await page.waitForTimeout(250);
        }
        await park(page);
      },
      hold: 3500,
    },
    {
      caption: "A search goes straight to Elasticsearch, so mitmproxy sees nothing.",
      act: async (page) => {
        await click(page, app(page).locator("#searchInput"));
        await page.keyboard.type("keyboard", { delay: 60 });
        await click(page, app(page).locator("#searchBtn"));
      },
      check: async (page) => {
        await expect(app(page).locator("#results")).toContainText(/keyboard/i);
        await expect(flowRows(page)).toHaveCount(0);
      },
      hold: 3500,
    },
  ],
};

const node = (page: Page, name: string): Locator =>
  page.locator("#flow-control .flow-node", { hasText: name });

const oneClick: Scene = {
  title: "One click",
  steps: [
    {
      caption: "Caddy has one route for Elasticsearch, and right now it points straight at it.",
      act: async (page) => {
        await hover(page, node(page, "Caddy"));
        await page.waitForTimeout(600);
        await hover(page, node(page, "ES"));
      },
      hold: 3500,
    },
    {
      caption:
        "mitmproxy is a man-in-the-middle proxy: it passes every request on, and keeps a copy for you to read.",
      act: async (page) => {
        await hover(page, node(page, "MITM"));
      },
      hold: 4000,
    },
    {
      caption:
        "One click, and the library swaps that one route for a route through mitmproxy. Caddy and Elasticsearch keep running.",
      act: async (page) => {
        await click(page, page.locator("#mitm-node"));
      },
      check: async (page) => {
        await expect(page.locator("#flow-control")).toHaveClass(/capturing/);
      },
      hold: 4000,
    },
    {
      caption: "The same search again, and now it shows up in mitmproxy.",
      act: async (page) => {
        await click(page, app(page).locator("#searchBtn"));
      },
      check: async (page) => {
        await expect(flowRows(page)).toHaveCount(1);
      },
      hold: 3000,
    },
    {
      caption: "Request and response, exactly as they went over the wire.",
      act: async (page) => {
        // Make room first, as a user would: the dashboard divider to the left,
        // then mitmweb's own splitter, so the JSON values are not cut off.
        await dragTo(page, page.locator("#resize-handle"), 1280 * 0.3);
        await openFlow(page, flowRows(page).last());
        // mitmweb's splitter only exists while a flow is open.
        await dragTo(page, mitmweb(page).locator(".splitter-x").first(), 1280 * 0.58);
      },
      check: async (page) => {
        await expect(flowDetail(page)).toContainText("keyboard");
        const box = await flowDetail(page).boundingBox();
        // Wide enough that `"category": "Electronics",` is not cut off (it needs about 380px).
        expect(box?.width ?? 0).toBeGreaterThan(500);
      },
      hold: 3500,
      still: "mitm-request",
    },
  ],
};

const bugs: Scene = {
  title: "Bugs on the wire",
  steps: [
    {
      caption: "Now the backend builds a query for keyboards, and Elasticsearch finds nothing.",
      act: async (page) => {
        await click(page, page.locator("#test-query-bug"));
      },
      check: async (page) => {
        await expect(flowRows(page)).toHaveCount(2);
      },
      hold: 3000,
    },
    {
      caption:
        "Elasticsearch answers 200 OK, so there is no error to go on. The request shows what the backend asked for: a field product_name, in the category electronics.",
      act: async (page) => {
        await openFlow(page, flowRows(page).last());
      },
      check: async (page) => {
        await expect(flowDetail(page)).toContainText("product_name");
      },
      hold: 4500,
      still: "mitm-zero-hits",
    },
    {
      caption:
        "The search from before shows what a product really looks like: the field is name, and the category is Electronics, with a capital E.",
      act: async (page) => {
        await showInResponse(page, flowRows(page).first(), "Mechanical Keyboard");
      },
      check: async (page) => {
        await expect(flowDetail(page)).toContainText('"category": "Electronics"');
      },
      hold: 5000,
      still: "mitm-real-document",
    },
    {
      caption:
        "When a search fails outright, the red row shows it asked for an index that does not exist.",
      act: async (page) => {
        await click(page, app(page).locator('button[data-index="nonexistent"]'));
        await openFlow(page, flowRows(page).filter({ hasText: "404" }).last());
      },
      check: async (page) => {
        await expect(flowDetail(page)).toContainText("nonexistent");
      },
      hold: 4000,
    },
    {
      caption: "One more click puts the original route back, straight to Elasticsearch.",
      act: async (page) => {
        await click(page, page.locator("#mitm-node"));
      },
      check: async (page) => {
        await expect(page.locator("#flow-control")).not.toHaveClass(/capturing/);
      },
      hold: 3000,
    },
  ],
};

const theCode: Scene = {
  title: "How it works",
  steps: [
    {
      caption: "The demo registers each service once with the library's MitmproxyManager.",
      act: async (page) => {
        await showCode(
          page,
          {
            file: "demo/api/server.ts",
            from: /^const mitmManager = new MitmproxyManager/,
            past: /backend: \{ host: "elasticsearch"/,
            to: /^\}\);$/,
            mark: [/pathPrefix: "\/es"/, /backend: \{ host: "elasticsearch"/],
          },
          "Register a service"
        );
      },
      hold: 5000,
    },
    {
      caption:
        "Turning inspection on removes the service's route by its ID and adds the route through mitmproxy, using Caddy's admin API.",
      act: async (page) => {
        await showCode(
          page,
          {
            file: "src/mitm/manager.ts",
            from: /^  async enable\(serviceId: string/,
            to: /^  \}$/,
            mark: [/removeRouteById/, /addRoute\(/],
          },
          "MitmproxyManager.enable()"
        );
      },
      hold: 5500,
    },
  ],
};

const viaCli: Scene = {
  title: "Viaalink CLI",
  steps: [
    {
      caption: "The Viaalink CLI drives Caddy with this same client library.",
      act: async (page) => {
        await showCode(
          page,
          {
            file: "via.yaml",
            from: /^network:/,
            to: /^\s+inspect: false/,
            mark: [/inspect: false/],
          },
          "via.yaml"
        );
      },
      hold: 4000,
    },
    {
      caption: "Set inspect to true, and via routes that service through mitmproxy, on demand.",
      act: async (page) => {
        await page.waitForTimeout(300);
      },
      hold: 5000,
    },
  ],
};

export const storyboard: Storyboard = {
  name: "caddy-mitm",
  title: "Inspect live traffic with Caddy and mitmproxy",
  subtitle: "Swap a route through mitmproxy and back at runtime, with @viaalink/caddy-api-client",
  byline: "by Viaalink",
  closing: [
    "npm   npmjs.com/package/@viaalink/caddy-api-client",
    "GitHub   github.com/viaalink/asd-caddy-api-client",
    "Viaalink CLI   viaalink.com",
  ],
  // The intro and the agenda are the animated "Why" scene, not voice over a still card.
  outro: ["Find the client library on npm and GitHub, and the Viaalink CLI at viaalink.com."],
  open: async (page) => {
    await assertDemoUp();
    await resetDemo();
    await page.goto(WHY_PAGE);
    await page.waitForTimeout(500);
  },
  prepare: async (page) => {
    await park(page);
  },
  scenes: [why, theDemo, oneClick, bugs, theCode, viaCli],
};
