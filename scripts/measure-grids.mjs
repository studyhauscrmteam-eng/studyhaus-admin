// Measure the injected metric grids on Payments/Expenses at desktop width.
// A grid that collapses to one column at 1600px would mean the responsive
// rule regressed the desktop layout (the point was to fix narrow screens,
// not to break wide ones).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const ROOT = path.resolve("D:/code/BBAACCKKUUPP/studyhaus-admin");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".jpg": "image/jpeg",
  ".png": "image/png", ".json": "application/json" };

const STUB = `export const initAuthGuard = () => {};`;
const TOKEN = fs.readFileSync(process.env.TOKEN_FILE, "utf8").trim();

// Only stub the guard for the signed-out bootstrap. Once a session exists we
// must let the REAL guard run, because that is what writes `userRole`, and
// firebase-entry.js will not install the lazy-page wrapper (or init the
// notification modules) until it sees a role.
const state = { stubGuard: true };

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  if (url === "/auth/guard.js" && state.stubGuard) {
    res.writeHead(200, { "Content-Type": MIME[".js"] });
    return res.end(STUB);
  }
  const f = path.join(ROOT, url.replace(/^\/+/, ""));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || !fs.statSync(f).isFile()) {    res.writeHead(404); return res.end("nope");
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
  res.end(fs.readFileSync(f));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto(`${base}/admin/dashboard.html`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(800);
await page.evaluate(async (t) => {
  const fb = await import("/firebase/firebase.js");
  const a = await import("firebase/auth");
  await a.signInWithCustomToken(fb.auth, t);
}, TOKEN);
await page.waitForTimeout(1000);
state.stubGuard = false;
await page.goto(`${base}/admin/dashboard.html`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);

for (const target of ["payments", "expenses", "visitors", "admissions"]) {
  const info = await page.evaluate((p) => {
    const item = [...document.querySelectorAll(".nav-item")].find((n) => n.dataset.page === p);
    if (!item) return { err: "no nav item" };
    item.click();
    return { p, href: typeof item.getAttribute("onclick") };
  }, target);
  if (info.err) { console.log(`${target}: ${info.err}`); continue; }
  // Lazy page modules boot on first navigate and then wait on a Firestore
  // snapshot, so give them room before measuring.
  await page.waitForTimeout(3500);

  const m = await page.evaluate(() => {
    const active = document.querySelector(".page.active");
    const actives = [...document.querySelectorAll(".page.active")].map((a) => a.id);
    const grids = [...(active ? active.querySelectorAll("[style*='grid-template-columns']") : [])]
      .filter((g) => g.getBoundingClientRect().height > 0)
      .slice(0, 3)
      .map((g) => {
        const cs = getComputedStyle(g);
        const r = g.getBoundingClientRect();
        return {
          cols: cs.gridTemplateColumns,
          width: Math.round(r.width),
          n: cs.gridTemplateColumns.split(" ").filter(Boolean).length,
        };
      });
    // Does a wide table spill out of its card, or is it clipped by a scroll
    // wrapper? Measure by walking up from the table: if any ancestor between
    // it and the card has overflow-x, the table is contained (it scrolls) even
    // though its own box is wider than the card.
    const card = document.querySelector(".page.active .card");
    const table = document.querySelector(".page.active table, .page.active .data-table");
    let spill = null;
    if (card && table) {
      const c = card.getBoundingClientRect();
      const t = table.getBoundingClientRect();
      let wrapper = null;
      for (let el = table.parentElement; el && el !== document.body; el = el.parentElement) {
        const ox = getComputedStyle(el).overflowX;
        if (ox === "auto" || ox === "scroll" || ox === "hidden") {
          wrapper = `${el.tagName.toLowerCase()}.${(typeof el.className === "string" ? el.className : "").split(/\s+/).filter(Boolean).join(".")} (overflow-x:${ox})`;
          break;
        }
        if (el === card) break;
      }
      spill = {
        tableW: Math.round(t.width),
        beyond: Math.round(t.right - c.right),
        wrapper,
        escapes: t.right > c.right + 2 && !wrapper,
      };
    }
    return { grids, spill, actives, len: active ? (active.innerHTML || "").replace(/\s+/g, " ").trim().length : -1 };
  });

  console.log(`\n${target}   active=[${m.actives.join(",")}] content=${m.len} chars`);
  for (const g of m.grids)
    console.log(`   grid  ${g.n} col(s)  container=${g.width}px  ->  ${g.cols}`);
  if (!m.grids.length) console.log(`   (no visible grid)`);
  if (m.spill)
    console.log(
      `   table  ${m.spill.tableW}px, overhangs card by ${m.spill.beyond}px  ` +
        `${m.spill.escapes ? "ESCAPES (no scroll wrapper)" : "contained by " + m.spill.wrapper}`
    );
}

await browser.close();
server.close();
