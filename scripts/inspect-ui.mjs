/**
 * Render the admin dashboard in a real browser and FIND THE OVERLAP.
 *
 *   node scripts/inspect-ui.mjs
 *
 * The auth guard (firebase-entry.js) redirects unauthenticated visitors to
 * /login.html, which is why nobody could see the broken dashboard in a test.
 * Here that one module is swapped for an empty stub — everything else (the
 * real HTML, real style.css, real app.js nav) is untouched, so what renders
 * is the actual layout a signed-in user gets, minus the Firestore-driven
 * content injection.
 *
 * Reports, for every sidebar page:
 *   - how many .page elements are visible (must be exactly 1)
 *   - whether the visible one is the nav target
 *   - any two visible blocks whose boxes intersect (the actual "overlap")
 * Screenshots each page for eyeballing.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SHOTS = "C:\\Users\\Asus\\AppData\\Local\\Temp\\opencode";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const STUB_ENTRY = `// auth/guard.js stubbed for layout inspection: initAuthGuard is a no-op so the
// real firebase-entry.js can boot (and every UI module can inject its markup)
// without bouncing an unauthenticated browser to /login.html.
export const initAuthGuard = () => {};\n`;

// Stub is only for the pre-authentication load. Once a real session exists we
// let the genuine guard run, because the thing under test is exactly the
// guard -> userRole -> initCrmModules -> notification-init chain.
const state = { stubGuard: true };

// Set ADMIN_TOKEN to inspect the dashboard as a signed-in admin with LIVE data.
const TOKEN = process.env.ADMIN_TOKEN || "";

function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    if (url === "/auth/guard.js" && state.stubGuard) {
      res.writeHead(200, { "Content-Type": MIME[".js"] });
      return res.end(STUB_ENTRY);
    }
    let file = path.join(ROOT, url.replace(/^\/+/, "")) || ROOT;
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("not found: " + url);
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(fs.readFileSync(file));
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

const intersects = (a, b) =>
  a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2;

const server = await serve();
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

const browser = await chromium.launch({ channel: "msedge", headless: true });
const W = +(process.env.W || 1600);
const H = +(process.env.H || 1000);
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

console.log(`\n=== ${base}/admin/dashboard.html @ ${W}x${H} ===\n`);
await page.goto(`${base}/admin/dashboard.html`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);

// Establish a real session, then reload so the REAL guard runs against it.
if (TOKEN) {
  try {
    await page.evaluate(async (t) => {
      const fb = await import("/firebase/firebase.js");
      const authMod = await import("firebase/auth");
      await authMod.signInWithCustomToken(fb.auth, t);
    }, TOKEN);
    await page.waitForTimeout(1200);
    state.stubGuard = false;
    await page.goto(`${base}/admin/dashboard.html`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);

    const who = await page.evaluate(async () => {
      const fb = await import("/firebase/firebase.js");
      const u = fb.auth && fb.auth.currentUser;
      return {
        uid: u ? u.uid : null,
        role: localStorage.getItem("userRole"),
        notifList: (document.querySelector("#page-notifications .notif-list")?.innerHTML || "").length,
        visitors: (document.getElementById("page-visitors")?.innerHTML || "").length,
        students: (document.getElementById("page-students")?.innerHTML || "").length,
        badges: [...document.querySelectorAll(".nav-badge")].map((b) => b.textContent),
      };
    });
    console.log(`authenticated as uid=${who.uid}`);
    console.log(`  userRole in localStorage : ${who.role}`);
    console.log(`  #page-visitors markup    : ${who.visitors} chars`);
    console.log(`  #page-students markup    : ${who.students} chars`);
    console.log(`  #page-notifications      : ${who.notifList} chars`);
    console.log(`  sidebar badges           : ${who.badges.join(", ") || "(none)"}\n`);
    // Errors from the signed-out bootstrap are expected; only count what the
    // authenticated session produces. (The existing pageerror listener survives
    // navigation, so clearing is enough — no need to attach a second one.)
    errors.length = 0;
  } catch (e) {
    console.log(`!! sign-in failed: ${e.message}`);
    state.stubGuard = true;
  }
} else {
  console.log("(no ADMIN_TOKEN — inspecting the signed-out shell; live data will not render)\n");
}

fs.mkdirSync(SHOTS, { recursive: true });

// What does the DEFAULT (dashboard) page look like?
const audit = async (label) => {
  const data = await page.evaluate(() => {
    const pages = [...document.querySelectorAll(".page")];
    const visible = pages.filter((p) => p.offsetParent !== null || getComputedStyle(p).display !== "none");
    const active = pages.filter((p) => p.classList.contains("active"));
    const boxes = visible.map((p, i) => {
      const r = p.getBoundingClientRect();
      return { id: p.id, idx: i, left: r.left, right: r.right, top: r.top, bottom: r.bottom,
               w: Math.round(r.width), h: Math.round(r.height) };
    });

    // Anything large and pinned over the content is a candidate "everything
    // is overlapping" culprit (a stuck modal/overlay with no backdrop).
    const CHROME = /sidebar|topbar|toast|global-loader|notif/i;
    const overlays = [...document.querySelectorAll("body *")].filter((el) => {
      if (CHROME.test(el.id || "") || CHROME.test(el.className || "")) return false;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity === 0) return false;
      if (cs.position !== "fixed" && cs.position !== "absolute") return false;
      const r = el.getBoundingClientRect();
      if (r.width < 240 || r.height < 160) return false;
      // only things actually sitting over the viewport centre
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      return cx >= 0 && cx <= innerWidth && cy >= 0 && cy <= innerHeight;
    }).map((el) => `${el.tagName.toLowerCase()}#${el.id || "?"}.${(typeof el.className === "string" ? el.className : "").split(/\s+/).filter(Boolean).slice(0, 2).join(".")}`);

    return { total: pages.length, visibleIds: visible.map((p) => p.id),
             activeIds: active.map((p) => p.id), boxes, overlays,
             content: visible.map((p) => ({
               id: p.id,
               len: (p.innerHTML || "").replace(/\s+/g, " ").trim().length,
             })) };
  });

  const overlaps = [];
  for (let i = 0; i < data.boxes.length; i++)
    for (let j = i + 1; j < data.boxes.length; j++)
      if (intersects(data.boxes[i], data.boxes[j])) overlaps.push(`${data.boxes[i].id} <> ${data.boxes[j].id}`);

  const ok = data.visibleIds.length === 1 && overlaps.length === 0;
  console.log(`${ok ? "OK  " : "BAD "} ${label}`);
  console.log(`      visible (${data.visibleIds.length}): ${data.visibleIds.join(", ") || "-"}`);
  console.log(`      active  (${data.activeIds.length}): ${data.activeIds.join(", ") || "-"}`);
  if (overlaps.length) console.log(`      OVERLAP: ${overlaps.join("  |  ")}`);
  if (data.overlays && data.overlays.length) console.log(`      OVERLAY: ${data.overlays.join("  |  ")}`);
  // A visible page with no content is a blank screen — the other failure mode
  // the owner reported alongside the overlap.
  const blank = (data.content || []).filter((c) => c.len === 0).map((c) => c.id);
  if (blank.length) console.log(`      BLANK : ${blank.join(", ")} (0 chars rendered)`);
  else if (data.content && data.content.length)
    console.log(`      content: ${data.content.map((c) => `${c.id}=${c.len}`).join(", ")}`);
  return { data, overlaps };
};

const results = [];
results.push(["default (dashboard)", await audit("default (dashboard)")]);

// Walk the sidebar.
const pages = await page.evaluate(() =>
  [...document.querySelectorAll(".nav-item[data-page]")]
    .map((n) => n.getAttribute("data-page"))
    .filter(Boolean)
);

const bad = [];
for (const p of pages) {
  const clicked = await page.evaluate((target) => {
    const item = [...document.querySelectorAll(".nav-item")].find((n) => n.getAttribute("data-page") === target);
    if (!item) return false;
    item.click();
    return true;
  }, p);
  if (!clicked) { console.log(`SKIP ${p} (no nav item)`); continue; }
  // Lazy pages boot their module on first navigate, so give the snapshot a
  // moment before asserting the page actually has content.
  await page.waitForTimeout(900);
  const r = await audit(p);
  if (r.overlaps.length || r.data.visibleIds.length !== 1) bad.push(p);
  if (["visitors", "seats", "notifications", "attendance", "payments", "complaints", "expenses"].includes(p)) {
    await page.screenshot({ path: path.join(SHOTS, `admin-page-${p}.png`) }).catch(() => {});
  }
}

console.log("\n=== summary ===");
console.log(`pages checked: ${pages.length + 1}`);
console.log(`problem pages: ${bad.length ? bad.join(", ") : "none"}`);
console.log(`pageerrors:    ${errors.length ? errors.slice(0, 5).join(" | ") : "none"}`);
console.log(`screenshots:   ${SHOTS}\\admin-page-*.png`);

await browser.close();
server.close();
