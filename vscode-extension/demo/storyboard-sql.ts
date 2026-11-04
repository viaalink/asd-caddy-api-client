/**
 * THE SQL STORYBOARD — read the SQL between an app and Postgres, with Caddy's
 * layer4 app and mitmproxy.
 *
 * Films the repo-root demo (demo/, `just demo start`), Postgres tab: a shop
 * whose backend builds SQL from the filters and reaches Postgres through Caddy
 * (caddy-l4). @viaalink/caddy-api-client swaps that one TCP route through
 * mitmproxy and back; the pgwire addon makes the Postgres protocol readable.
 *
 * Same rules as ./storyboard-mitm.ts: every step does what a user would do and
 * checks that it worked, so a broken demo fails the recording.
 *
 * Render: `just film ext/asd-caddy-api-client/vscode-extension/demo/film.config.ts caddy-sql promo`.
 *
 * Words in capitals are spoken as abbreviations, letter by letter (SQL, TCP, ID).
 *
 * Outline approved by Kelvin (2026-11-04); the lines are a draft until he has
 * watched them.
 */

import { expect, type Locator, type Page } from "product-video/test";
import { click, dragTo, hover, moveTo, park } from "product-video/actions";
import { showCode } from "product-video/codecard";
import { assertDemoUp, demoUrl, resetDemo } from "./lib/mitm-demo";
import type { Scene, Storyboard } from "product-video/types";
import { resolve } from "path";

/** The opening diagram (assets/sql-why.html): one animated stage per spoken line. */
const WHY_PAGE = `file://${resolve(__dirname, "assets/sql-why.html")}`;

async function stage(page: Page, n: number): Promise<void> {
  await page.evaluate((i) => (window as unknown as { stage(n: number): void }).stage(i), n);
  await page.waitForFunction(() => (window as unknown as { stageDone: boolean }).stageDone, null, {
    timeout: 30000,
  });
}

const app = (page: Page) => page.frameLocator("#app-iframe");
const mitmweb = (page: Page) => page.frameLocator("#iframe-pg");
const tcpFlows = (page: Page): Locator => mitmweb(page).locator("tbody tr", { hasText: "TCP" });
const flowDetail = (page: Page): Locator => mitmweb(page).locator(".flow-detail");
const node = (page: Page, name: string): Locator =>
  page.locator("#flow-control .flow-node", { hasText: name });
const chip = (page: Page, name: string): Locator =>
  app(page).locator("#categories [data-category]", { hasText: name });

/**
 * Open a TCP flow's Stream Data, decoded by the pgwire addon, and wheel until
 * `text` sits in the upper half of the detail pane.
 */
async function showInStream(page: Page, row: Locator, text: string | RegExp): Promise<void> {
  await click(page, row);
  const detail = flowDetail(page);
  await expect(detail).toBeVisible();
  await click(page, detail.locator("nav a", { hasText: /Stream Data/ }));
  const target = detail.getByText(text).first();
  await expect(target).toBeAttached();
  const box = await detail.boundingBox();
  if (!box) throw new Error("no bounding box for the flow detail");
  await moveTo(page, { x: box.x + box.width / 2, y: box.y + box.height * 0.6 });
  let last: number | undefined;
  for (let i = 0; i < 60; i++) {
    const at = await target.boundingBox();
    if (at && at.y > box.y && at.y < box.y + box.height * 0.5) return;
    // At the end of the stream the text can't rise further: in view is enough.
    if (at && at.y === last && at.y + at.height < box.y + box.height) return;
    last = at?.y;
    await page.mouse.wheel(0, 60);
    await page.waitForTimeout(50);
  }
  throw new Error(`"${String(text)}" never scrolled into view in Stream Data`);
}

/** Search again with the same filters, once the old pooled connections have closed. */
async function searchAgain(page: Page): Promise<void> {
  // The pool closes idle connections after 250 ms; a new one takes the new route.
  await page.waitForTimeout(600);
  await click(page, app(page).locator("#searchBtn"));
}

const why: Scene = {
  title: "Why",
  steps: [
    {
      caption:
        "Here the backend builds the SQL from what the user picked: a category, a price, a sort order.",
      act: async (page) => stage(page, 1),
      hold: 3000,
    },
    {
      caption:
        "The code holds the pieces. The query that reaches Postgres, with its parameters, only exists on the wire.",
      act: async (page) => stage(page, 2),
      hold: 3000,
    },
    {
      caption:
        "SQL travels over TCP, not HTTP. Caddy routes it with its layer 4 app, and our Caddy client library swaps that route through mitmproxy and back, while everything keeps running.",
      act: async (page) => stage(page, 3),
      hold: 3000,
      still: "sql-why-swap",
    },
    {
      caption: "In this video",
      say: "In this video: the demo on Postgres, inspecting with one click, two bugs found on the wire, and how the code does it.",
      act: async (page) => stage(page, 4),
      hold: 3000,
    },
  ],
};

const theDemo: Scene = {
  title: "The demo",
  steps: [
    {
      caption:
        "The same demo, now with a shop on Postgres. The backend reaches the database through Caddy.",
      act: async (page) => {
        await page.goto(demoUrl("/dashboard"));
        await click(page, page.locator("#tab-pg"));
        await expect(app(page).locator("#categories")).toBeVisible();
        await expect(mitmweb(page).locator("body")).toContainText(/mitmproxy|Flow List/i);
        for (const id of ["Browser", "Caddy", "MITM", "PG"]) {
          await hover(page, node(page, id));
          await page.waitForTimeout(250);
        }
        await park(page);
      },
      check: async (page) => {
        await expect(page.locator("#tab-pg")).toHaveClass(/active/);
        await expect(page.locator("#flow-control")).not.toHaveClass(/capturing/);
      },
      hold: 3500,
    },
    {
      caption: "Pick Electronics, and the shop finds nothing. No error, just an empty page.",
      act: async (page) => {
        await click(page, chip(page, "Electronics"));
      },
      check: async (page) => {
        await expect(app(page).locator("#results")).toContainText("No products found");
        await expect(tcpFlows(page)).toHaveCount(0);
      },
      hold: 3500,
      still: "sql-empty-shop",
    },
  ],
};

const oneClick: Scene = {
  title: "One click",
  steps: [
    {
      caption:
        "One click, and the library swaps Caddy's layer 4 route for one through mitmproxy. Postgres keeps running.",
      act: async (page) => {
        await click(page, page.locator("#mitm-node"));
      },
      check: async (page) => {
        await expect(page.locator("#flow-control")).toHaveClass(/capturing/);
        await expect(mitmweb(page).locator("body")).toContainText(/mitmproxy|Flow List/i);
      },
      hold: 3500,
    },
    {
      caption: "The same search again. This time the connection goes through mitmproxy.",
      act: async (page) => {
        await searchAgain(page);
      },
      check: async (page) => {
        await expect(app(page).locator("#results")).toContainText("No products found");
        await expect(tcpFlows(page)).toHaveCount(1);
      },
      hold: 3000,
    },
    {
      caption:
        "mitmproxy reads the Postgres protocol: the SQL, its parameter, and the result. The shop asked for electronics, in lower case, and got zero rows.",
      act: async (page) => {
        // Make room first, as a user would: the dashboard divider to the left,
        // then mitmweb's own splitter, so the SQL is not cut off.
        await dragTo(page, page.locator("#resize-handle"), 1280 * 0.3);
        await showInStream(page, tcpFlows(page).last(), /PARSE/);
        await dragTo(page, mitmweb(page).locator(".splitter-x").first(), 1280 * 0.45);
      },
      check: async (page) => {
        await expect(flowDetail(page)).toContainText("$1='electronics'");
        await expect(flowDetail(page)).toContainText("SELECT 0");
        const box = await flowDetail(page).boundingBox();
        expect(box?.width ?? 0).toBeGreaterThan(560);
      },
      hold: 5000,
      still: "sql-zero-rows",
    },
  ],
};

const bugs: Scene = {
  title: "Bugs on the wire",
  steps: [
    {
      caption: "Search for keyboard instead, without the category.",
      act: async (page) => {
        await click(page, app(page).locator("#searchInput"));
        await page.keyboard.type("keyboard", { delay: 60 });
        await page.waitForTimeout(600);
        // Clicking the active category again clears it, and searches.
        await click(page, chip(page, "Electronics"));
      },
      check: async (page) => {
        await expect(app(page).locator("#results")).toContainText("Mechanical Keyboard");
        await expect(tcpFlows(page)).toHaveCount(2);
      },
      hold: 2500,
    },
    {
      caption:
        "The row that comes back says Electronics, with a capital E. That is the bug: the category buttons send the wrong value.",
      act: async (page) => {
        await showInStream(page, tcpFlows(page).last(), /ROW/);
      },
      check: async (page) => {
        await expect(flowDetail(page)).toContainText("'Electronics'");
      },
      hold: 5000,
      still: "sql-capital-e",
    },
    {
      caption: "Now sort by rating. The shop only says that something went wrong.",
      act: async (page) => {
        const sort = app(page).locator("#sort");
        await hover(page, sort);
        await page.waitForTimeout(600);
        await sort.selectOption("rating");
      },
      check: async (page) => {
        await expect(app(page).locator("#results")).toContainText("Something went wrong");
        await expect(tcpFlows(page)).toHaveCount(3);
      },
      hold: 3500,
    },
    {
      caption:
        "On the wire, Postgres says why: the column rating does not exist. The option shipped, the column never did.",
      act: async (page) => {
        await showInStream(page, tcpFlows(page).last(), /ERROR/);
      },
      check: async (page) => {
        await expect(flowDetail(page)).toContainText('column "rating" does not exist');
      },
      hold: 5000,
      still: "sql-error",
    },
    {
      caption: "One more click, and the route points straight at Postgres again.",
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
      caption:
        "The demo registers Postgres once with the library's MitmproxyManager, as a TCP service on Caddy's layer 4 server.",
      act: async (page) => {
        await showCode(
          page,
          {
            file: "demo/api/server.ts",
            from: /^\/\/ Register Postgres/,
            to: /^\}\);$/,
            mark: [/protocol: "tcp"/, /match: "postgres"/],
          },
          "Register a TCP service"
        );
      },
      hold: 5000,
    },
    {
      caption:
        "Turning inspection on replaces that one route in place, by its ID, through Caddy's admin API. Connections that are already open keep their path; new ones go through mitmproxy.",
      act: async (page) => {
        await showCode(
          page,
          {
            file: "src/mitm/manager.ts",
            from: /^  private async routeTcp\(/,
            to: /^  \}$/,
            mark: [/putLayer4Route/],
          },
          "MitmproxyManager, TCP"
        );
      },
      hold: 5500,
    },
    {
      caption:
        "mitmproxy runs in reverse TCP mode, with the Postgres decoder that ships with the library.",
      act: async (page) => {
        await showCode(
          page,
          {
            file: "demo/docker-compose.yml",
            from: /^  mitmproxy-pg:/,
            to: /addons:ro$/,
            mark: [/reverse:tcp/, /pgwire\.py/],
          },
          "docker-compose.yml"
        );
      },
      hold: 5000,
    },
  ],
};

export const storyboard: Storyboard = {
  name: "caddy-sql",
  title: "Read the SQL on the wire with Caddy and mitmproxy",
  subtitle:
    "Swap a TCP route through mitmproxy and back at runtime, with @viaalink/caddy-api-client",
  byline: "by Viaalink",
  closing: [
    "npm   npmjs.com/package/@viaalink/caddy-api-client",
    "GitHub   github.com/viaalink/asd-caddy-api-client",
    "Viaalink CLI   viaalink.com",
  ],
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
  scenes: [why, theDemo, oneClick, bugs, theCode],
};
