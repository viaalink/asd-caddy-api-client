/**
 * The shop on a database: ?db=postgres (default), mysql, mariadb or redis.
 * The filters go to the backend (/api/db/search), which builds the SQL or the
 * Redis commands. The page never sees the query; mitmproxy does.
 *
 * Two bugs, on purpose, the kind you only find on the wire:
 *   - the category buttons send a lower-case slug ("electronics"), the column
 *     (or Redis key) holds "Electronics": zero rows, no error;
 *   - "Sort by Rating" asks for a column that was never added: the page only
 *     hears "something went wrong" (Redis: an index that was never built,
 *     so again nothing).
 */

const DATABASES = {
  postgres: { name: "Postgres", subtitle: "Postgres, queried by the backend from your filters" },
  mysql: { name: "MySQL", subtitle: "MySQL 8, queried by the backend from your filters" },
  mariadb: { name: "MariaDB", subtitle: "MariaDB 11, queried by the backend from your filters" },
  redis: { name: "Redis", subtitle: "Redis 7, read by the backend from your filters" },
};
const dbParam = new URLSearchParams(location.search).get("db");
const db = dbParam && dbParam in DATABASES ? dbParam : "postgres";
document.getElementById("subtitle").textContent = DATABASES[db].subtitle;
document.title = `Shop on ${DATABASES[db].name} - Database Traffic Inspection`;
for (const a of document.querySelectorAll("#dbSwitch a")) {
  a.classList.toggle("active", a.dataset.db === db);
}

const statusIndicator = document.getElementById("statusIndicator");
const statusText = document.getElementById("statusText");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const resultsDiv = document.getElementById("results");
const statsDiv = document.getElementById("stats");
const maxPrice = document.getElementById("maxPrice");
const sort = document.getElementById("sort");
const categoryButtons = [...document.querySelectorAll("#categories [data-category]")];

let category = "";

function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function message(text, className = "placeholder") {
  clear(resultsDiv);
  const p = document.createElement(className === "error" ? "div" : "p");
  p.className = className;
  p.textContent = text;
  resultsDiv.appendChild(p);
}

function card(product) {
  const el = document.createElement("div");
  el.className = "product-card";
  const cat = document.createElement("div");
  cat.className = "product-category";
  cat.textContent = product.category;
  const name = document.createElement("div");
  name.className = "product-name";
  name.textContent = product.name;
  const description = document.createElement("div");
  description.className = "product-description";
  description.textContent = product.description ?? "";
  const price = document.createElement("div");
  price.className = "product-price";
  price.textContent = `$${Number(product.price).toFixed(2)}`;
  el.append(cat, name, description, price);
  return el;
}

async function search() {
  const params = new URLSearchParams();
  if (searchInput.value.trim()) params.set("q", searchInput.value.trim());
  if (category) params.set("category", category);
  if (maxPrice.value) params.set("maxPrice", maxPrice.value);
  params.set("sort", sort.value);
  params.set("db", db);

  message("Searching...");
  try {
    const res = await fetch(`/api/db/search?${params}`);
    const data = await res.json();
    if (!res.ok) {
      message(data.error ?? `Search failed (${res.status})`, "error");
      statsDiv.textContent = "";
      return;
    }
    clear(resultsDiv);
    if (data.count === 0) {
      message("No products found");
    } else {
      for (const row of data.rows) resultsDiv.appendChild(card(row));
    }
    statsDiv.textContent = `Found ${data.count} products in ${data.ms}ms`;
  } catch (e) {
    message(`Search failed: ${e.message}`, "error");
  }
}

async function status() {
  try {
    const res = await fetch("/api/monitoring/status");
    const data = await res.json();
    const on = data.services?.[db]?.enabled === true;
    statusIndicator.className = `status-indicator ${on ? "proxied" : "direct"}`;
    const name = DATABASES[db].name;
    statusText.textContent = on
      ? `${name}: Capturing via MITMproxy`
      : `${name}: Direct (not capturing)`;
  } catch {
    statusText.textContent = "Error: Cannot connect to API";
  }
}

for (const button of categoryButtons) {
  button.addEventListener("click", () => {
    const same = category === button.dataset.category;
    category = same ? "" : button.dataset.category;
    for (const b of categoryButtons) b.classList.toggle("active", !same && b === button);
    search();
  });
}
searchBtn.addEventListener("click", search);
searchInput.addEventListener("keydown", (e) => e.key === "Enter" && search());
maxPrice.addEventListener("change", search);
sort.addEventListener("change", search);

status();
setInterval(status, 3000);
