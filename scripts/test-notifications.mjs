/**
 * Notification system — real-browser acceptance test.
 *
 *   node scripts/test-notifications.mjs
 *
 * Boots the REAL announcementAdminUI.js + adminNotificationUI.js +
 * notificationReadState.js in Edge (msedge channel) against the real style.css
 * and the real index.html DOM, with only the four Firestore-backed data
 * services swapped for stubs (scripts/stubs/notif-*).
 *
 * What it proves, end to end:
 *   1. the Notifications page renders cards instead of freezing on
 *      "Loading announcements..." (the BASE_TITLE ReferenceError regression)
 *   2. sidebar pill + topbar bell + browser-tab title all show ONE number
 *   3. clicking a notification makes it disappear and drops all three badges
 *   4. that click SURVIVES a refresh, and opening the page clears NOTHING
 *   5. admission alerts are plain cards — no Review button anywhere — and
 *      clicking one dismisses it exactly like any other notification
 *   6. a brand-new arrival raises all three badges again
 *   7. no uncaught page errors at any point
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};

/** Route overrides: only the data services are replaced, never the UI. */
const ROUTES = {
  "/services/announcementService.js": "scripts/stubs/notif-announcementService.js",
  "/services/notificationService.js": "scripts/stubs/notif-notificationService.js",
  "/services/admissionService.js": "scripts/stubs/notif-admissionService.js",
  "/firebase/firebase.js": "scripts/stubs/notif-firebase.js",
};

const results = [];
const ok = (label) => { results.push(label); console.log(`  PASS  ${label}`); };
const bad = (label, detail) => {
  results.push(null);
  console.log(`  FAIL  ${label}\n        ${JSON.stringify(detail)}`);
};

const check = (label, condition, detail) => (condition ? ok(label) : bad(label, detail));

function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    const mapped = ROUTES[url];
    let file = path.resolve(ROOT, (mapped || url).replace(/^\/+/, ""));
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    // path.resolve FIRST, then the containment check — a raw startsWith on an
    // un-resolved path silently 404s every module on Windows.
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("not found: " + url);
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

/** One consistent read of every badge surface. */
const snapshot = (page) =>
  page.evaluate(() => {
    const list = document.querySelector("#page-notifications .notif-list");
    const navBadges = [...document.querySelectorAll(".nav-badge")].map((b) => ({
      text: b.textContent.trim(),
      display: getComputedStyle(b).display,
    }));
    const dot = document.getElementById("topbar-notif-dot");
    return {
      stuck: !!list && list.textContent.includes("Loading announcements"),
      cards: [...document.querySelectorAll(".notif-item")].map((el) => el.dataset.notifId || "history"),
      navBadges,
      bell: dot ? { text: dot.textContent.trim(), display: getComputedStyle(dot).display } : null,
      title: document.title,
      reviewButtons: [...document.querySelectorAll("button")]
        .filter((b) => /^review$/i.test(b.textContent.trim())).length,
      admButtons: [...document.querySelectorAll('.notif-item[data-notif-id^="adm_"]')]
        .reduce((n, el) => n + el.querySelectorAll("button").length, 0),
      listHtml: list ? list.innerHTML : "",
    };
  });

/** All three surfaces must report the same number. */
const surfaces = (s) => ({
  nav: s.navBadges.length ? s.navBadges[0].text : "(none)",
  bell: s.bell ? s.bell.text : "(none)",
  tab: /^\(\d+\)/.test(s.title) || /^\(9\+\)/.test(s.title) ? s.title.match(/^\(([^)]+)\)/)[1] : "0",
});

async function main() {
  const server = await serve();
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  console.log(`\n=== notification harness · ${base}/scripts/notif-harness.html ===\n`);

  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e && e.message ? e.message : e)));

  const boot = async () => {
    await page.goto(`${base}/scripts/notif-harness.html`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__harnessReady === true, null, { timeout: 10000 });
    await page.waitForFunction(
      () => document.querySelectorAll("#page-notifications .notif-item").length > 0,
      null,
      { timeout: 10000 }
    );
  };

  /* ---------------------------------------------------- 1. first paint --- */
  await boot();
  let s = await snapshot(page);
  let surf = surfaces(s);

  check("page is NOT stuck on 'Loading announcements...'", s.stuck === false, s);
  check("all 7 notifications render (3 announcements + 2 activity + 2 admission alerts)",
    s.cards.length === 7, s.cards);
  check("sidebar pill shows 7", surf.nav === "7", surf);
  check("topbar bell shows 7", surf.bell === "7", surf);
  check("browser tab title shows 7", surf.tab === "7", { title: s.title });
  check("all three surfaces agree", surf.nav === surf.bell && surf.bell === surf.tab, surf);
  check("NO Review button anywhere on the page", s.reviewButtons === 0, { reviewButtons: s.reviewButtons });
  check("admission alert cards carry NO buttons at all", s.admButtons === 0, { admButtons: s.admButtons });
  check("admission alerts are real dismissible cards (data-notif-id present)",
    s.cards.filter((c) => c.startsWith("adm_")).length === 2, s.cards);

  /* ------------------------------------------- 2. click an announcement -- */
  await page.click('.notif-item[data-notif-id="ann_ann-a"] .notif-title');
  await page.waitForFunction(() => {
    const b = document.querySelector(".nav-badge");
    return b && b.textContent.trim() === "6";
  }, null, { timeout: 5000 });
  s = await snapshot(page);
  surf = surfaces(s);
  check("clicking a notification makes it disappear", !s.cards.includes("ann_ann-a"), s.cards);
  check("badges all drop to 6", surf.nav === "6" && surf.bell === "6" && surf.tab === "6", surf);

  /* --------------------------------------- 3. click an admission alert --- */
  await page.click('.notif-item[data-notif-id="adm_f3B3XTYQ3Xy6vH6EsPzI"]');
  await page.waitForFunction(() => {
    const b = document.querySelector(".nav-badge");
    return b && b.textContent.trim() === "5";
  }, null, { timeout: 5000 });
  s = await snapshot(page);
  surf = surfaces(s);
  check("clicking the admission alert dismisses it like any other card",
    !s.cards.includes("adm_f3B3XTYQ3Xy6vH6EsPzI"), s.cards);
  check("badges all drop to 5", surf.nav === "5" && surf.bell === "5" && surf.tab === "5", surf);

  /* ------------------------------- 4. refresh: click persists, no auto-clear */
  await boot();
  s = await snapshot(page);
  surf = surfaces(s);
  check("clicked notifications stay gone after a refresh", !s.cards.includes("ann_ann-a")
    && !s.cards.includes("adm_f3B3XTYQ3Xy6vH6EsPzI"), s.cards);
  check("opening the page clears NOTHING (5 still unread)",
    surf.nav === "5" && surf.bell === "5" && surf.tab === "5", surf);

  /* ------------------------------------- 5. a brand-new arrival raises it */
  // The live query hands back the WHOLE queue every time, so this must too:
  // the surviving pending record plus the brand-new arrival.
  await page.evaluate(() => window.__pushPending([
    { id: "fVRJzTlv9cogXP1Yrd5D", name: "Soumyarajsinh Zala", phone: "9000000002", planName: "Monthly ₹1000", createdAt: 1759680000000 },
    { id: "new_arrival_1", name: "Ishita Desai", phone: "9000000003", planName: "Quarterly ₹3000", createdAt: Date.now() - 60000 },
  ]));
  try {
    await page.waitForFunction(() => {
      const b = document.querySelector(".nav-badge");
      return b && b.textContent.trim() === "6";
    }, null, { timeout: 5000 });
  } catch (e) {
    bad("a NEW admission request raises all three badges to 6", await snapshot(page));
    throw e;
  }
  s = await snapshot(page);
  surf = surfaces(s);
  check("a NEW admission request raises all three badges to 6",
    surf.nav === "6" && surf.bell === "6" && surf.tab === "6", surf);
  check("the new request is on screen as a card", s.cards.includes("adm_new_arrival_1"), s.cards);

  /* ------------------------------------------------ 6. no page errors --- */
  const fatal = pageErrors.filter((e) => !/favicon|Autoplay|AudioContext|fonts\.gstatic/i.test(e));
  check("no uncaught page errors (the BASE_TITLE crash would show here)",
    fatal.length === 0, fatal);

  await browser.close();
  server.close();

  const failed = results.filter((r) => r === null).length;
  console.log(`\n=== ${results.length - failed} passed, ${failed} failed ===\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error("\nHarness error:", e);
  process.exit(2);
});
