/**
 * Real-browser verification of the admin portal changes (owner items 1, 3, 4,
 * 5, 6, 7, 8, 9) against LIVE Firestore with a signed-in Owner session.
 *
 *   node scripts/verify-changes.mjs
 *
 * Signs in with a minted custom token (mint-token.mjs) the same way
 * inspect-ui.mjs does — real HTML, real style.css, real modules, real data.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SHOTS = "C:\\Users\\Asus\\AppData\\Local\\Temp\\opencode";
const TOKEN = fs.readFileSync(path.join(SHOTS, "admin-token.txt"), "utf8").trim();

const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("playwright-core");

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".ico": "image/x-icon",
};

const STUB_ENTRY = `export const initAuthGuard = () => {};\n`;
const state = { stubGuard: true };

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  if (url === "/auth/guard.js" && state.stubGuard) {
    res.writeHead(200, { "Content-Type": MIME[".js"] });
    return res.end(STUB_ENTRY);
  }
  let file = path.join(ROOT, url.replace(/^\/+/, ""));
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("not found: " + url);
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok, extra });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`);
};
const shot = (n) => page.screenshot({ path: path.join(SHOTS, `admin-${n}.png`) }).catch(() => {});

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String((e && e.message) || e)));

/* ------------------------------------------------------------- sign in */
await page.goto(`${base}/admin/dashboard.html`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
await page.evaluate(async (t) => {
  const fb = await import("/firebase/firebase.js");
  const authMod = await import("firebase/auth");
  await authMod.signInWithCustomToken(fb.auth, t);
}, TOKEN);
await page.waitForTimeout(1200);
state.stubGuard = false;
errors.length = 0;
await page.goto(`${base}/admin/dashboard.html`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);

const who = await page.evaluate(() => ({
  uid: (window.firebase && window.firebase.auth && window.firebase.auth.currentUser && window.firebase.auth.currentUser.uid) || localStorage.getItem("userId"),
  role: localStorage.getItem("userRole"),
}));
check("signed in as Owner", !!who.uid, `uid=${who.uid} role=${who.role}`);
check("no page errors after signed-in boot", errors.length === 0, errors.slice(0, 3).join(" | "));

const nav = async (pageName) => {
  await page.evaluate((p) => {
    const item = [...document.querySelectorAll(".nav-item")].find((n) => n.getAttribute("data-page") === p);
    if (item) item.click();
  }, pageName);
  await page.waitForTimeout(2500);
};

/* ============================ A · Admissions (items 1, 3, 4) ========== */
await nav("admissions");

const tabCls = (await page.locator("#tab-pending-approval").getAttribute("class")) || "";
check("item 4 · pending tab uses the class-driven pill", tabCls.includes("adm-tab"), tabCls);
const tabCount = (await page.locator("#tab-pending-approval .adm-tab-count").count())
  ? (await page.locator("#tab-pending-approval .adm-tab-count").innerText()).trim()
  : "(none)";
check("item 4 · pending tab badge shows the live count", tabCount === "2", `badge="${tabCount}"`);
check("item 4 · pending tab carries has-pending", tabCls.includes("has-pending"), tabCls);

await page.evaluate(() => window.switchAdmissionTab("pending"));
await page.waitForTimeout(2500);
await shot("admissions-pending");

const tabCls2 = (await page.locator("#tab-pending-approval").getAttribute("class")) || "";
check("item 4 · active tab gets is-active (no inline style)", tabCls2.includes("is-active"), tabCls2);
const inlineCss = (await page.locator("#tab-pending-approval").evaluate((e) => e.style.cssText)) || "";
check("item 4 · active tab has no inline style left", inlineCss.trim() === "", JSON.stringify(inlineCss));

const rows = await page.locator("#pending-admissions-body tr").count();
check("pending queue renders rows", rows >= 1, `${rows} row(s)`);

const rowButtons = await page.evaluate(() =>
  [...document.querySelectorAll("#pending-admissions-body tr")].map((tr) => {
    const btns = [...tr.querySelectorAll("button")].map((b) => b.textContent.trim());
    const cell = tr.querySelector("td:last-child");
    const wrap = cell ? cell.querySelector(".approval-actions") : null;
    return { btns, cellCls: cell ? cell.className : "", wrapCls: wrap ? wrap.className : "", hasWrap: !!wrap };
  })
);
check("item 1 · every row is Approve / Reject / Details / Dismiss",
  rowButtons.length > 0 && rowButtons.every((r) =>
    r.btns.length === 4 &&
    r.btns[0] === "Approve" && r.btns[1] === "Reject" && r.btns[2] === "Details" && r.btns[3] === "Dismiss"),
  JSON.stringify(rowButtons[0] || {}));
check("item 1 · action cell wraps its buttons in .approval-actions",
  rowButtons.every((r) => r.hasWrap && r.wrapCls.includes("approval-actions")),
  rowButtons[0] ? `${rowButtons[0].cellCls} > ${rowButtons[0].wrapCls}` : "");
const flat = rowButtons.flatMap((r) => r.btns);
check("item 3 · NO Open button anywhere", !flat.some((b) => /open/i.test(b)));
check("item 3 · NO Docs button anywhere", !flat.some((b) => /^docs$/i.test(b)));

/* ------------------------- item 3: Details panel ---------------------- */
await page.locator("#pending-admissions-body .btn-info").first().click();
await page.waitForTimeout(1800);

const panel = await page.evaluate(() => {
  const d = document.getElementById("adm-details-modal");
  if (!d) return null;
  return {
    open: d.open,
    cls: d.className,
    isDialog: d.tagName === "DIALOG",
    headings: [...d.querySelectorAll(".ad-panel h3")].map((h) => h.textContent.trim().split(" ")[0]),
    foot: [...d.querySelectorAll(".ad-foot button")].map((b) => b.textContent.trim()),
    name: (d.querySelector(".ad-head h2") || {}).textContent || "",
    docButtons: d.querySelectorAll(".ad-doc").length,
    hasNone: !!d.querySelector(".ad-none"),
  };
});
check("item 3 · Details opens as a top-layer <dialog>", !!panel && panel.open && panel.isDialog && panel.cls === "adm-details",
  panel ? `${panel.cls} open=${panel.open}` : "missing");
check("item 3 · panels: Contact / Admission / Payment / Documents",
  !!panel && panel.headings.join(",").startsWith("Contact,Admission,Payment,Documents"),
  panel ? panel.headings.join(",") : "");
check("item 3 · footer is Approve / Reject / Dismiss / Close",
  !!panel && panel.foot.join(",") === "Approve,Reject,Dismiss,Close", panel ? panel.foot.join(",") : "");
check("item 3 · identity header shows the applicant",
  !!panel && panel.name.trim().length > 0, panel ? panel.name : "");
await shot("admission-details");

/* Esc closes the panel */
await page.keyboard.press("Escape");
await page.waitForTimeout(500);
check("item 3 · Esc closes the Details panel",
  !(await page.evaluate(() => { const d = document.getElementById("adm-details-modal"); return d && d.open; })));

/* --------------------- item 3: big-company lightbox ------------------- */
// The two live applicants have no uploads yet, so drive the panel with a
// student that DOES have documents — same code path, real base64 images.
const DOCS_STUDENT = "NOAqzUpuV3YH5NXiaL2nS2a6s9n2";
await page.evaluate((id) => window.viewApplicantDetails(id), DOCS_STUDENT);
await page.waitForTimeout(2500);
const docState = await page.evaluate(() => {
  const d = document.getElementById("adm-details-modal");
  return {
    open: !!(d && d.open),
    name: (d && d.querySelector(".ad-head h2") ? d.querySelector(".ad-head h2").textContent.trim() : ""),
    cards: d ? d.querySelectorAll(".ad-doc").length : 0,
    empty: !!(d && d.querySelector(".ad-none")),
    err: d ? (d.querySelector(".ad-error") || {}).textContent || "" : "",
  };
});
check("item 3 · Details opens for a student that has documents", docState.open && docState.name.length > 0,
  `open=${docState.open} name=${docState.name}`);
const docsBefore = docState.cards;
check("item 3 · document strip renders thumbnails",
  docsBefore >= 1 && !docState.empty, `${docsBefore} card(s) empty=${docState.empty} ${docState.err}`);
if (docsBefore > 0) {
  await page.locator(".ad-doc").first().click();
  await page.waitForTimeout(900);
  const lb = await page.evaluate(() => {
    const d = document.getElementById("adm-lightbox");
    return {
      open: !!(d && d.open),
      isDialog: !!d && d.tagName === "DIALOG",
      counter: d ? (d.querySelector(".lb-count") || {}).textContent || "" : "",
      detailsOpen: !!(document.getElementById("adm-details-modal") || {}).open,
      navBtns: d ? d.querySelectorAll("button").length : 0,
    };
  });
  check("item 3 · document opens in a full-screen lightbox over the panel",
    lb.open && lb.isDialog && lb.detailsOpen, `open=${lb.open} details=${lb.detailsOpen}`);
  check("item 3 · lightbox shows a 1 / N counter", /\d+\s*\/\s*\d+/.test(lb.counter), JSON.stringify(lb.counter));
  check("item 3 · lightbox has prev/next/close controls", lb.navBtns >= 3, `${lb.navBtns} button(s)`);
  await shot("admission-lightbox");

  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  const afterEsc = await page.evaluate(() => ({
    lb: !!(document.getElementById("adm-lightbox") || {}).open,
    details: !!(document.getElementById("adm-details-modal") || {}).open,
  }));
  check("item 3 · Esc closes ONLY the lightbox (panel stays)", !afterEsc.lb && afterEsc.details,
    JSON.stringify(afterEsc));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
}
check("admissions section produced no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));

/* ================================ B · Visitors (items 5, 6) ========== */
await nav("visitors");
const vis = await page.evaluate(() => {
  const p = document.getElementById("page-visitors");
  const list = document.getElementById("vis-list");
  const add = document.getElementById("btn-add-visitor");
  const toolbar = document.querySelector("#page-visitors .vis-toolbar");
  const cards = [...document.querySelectorAll("#vis-list .vis-card")];
  const wrap = document.querySelector("#page-visitors .table-container") || list;
  const text = (p ? p.innerText : "");
  return {
    cards: cards.length,
    purposeWord: /\bpurpose\b/i.test(text),
    text: text.slice(0, 400),
    addRight: add ? Math.round(add.getBoundingClientRect().right) : -1,
    vw: innerWidth,
    addVisible: add ? add.offsetParent !== null : false,
    listOverflow: list ? list.scrollWidth - list.clientWidth : -1,
    toolbarOverflow: toolbar ? toolbar.scrollWidth - toolbar.clientWidth : -1,
    cardW: cards[0] ? Math.round(cards[0].getBoundingClientRect().width) : 0,
    cols: list ? getComputedStyle(list).gridTemplateColumns.split(" ").length : 0,
  };
});
check("item 5 · visitors render as CARDS, not a row of buttons", vis.cards >= 1, `${vis.cards} card(s)`);
check("item 5 · cards are wide blocks (not a cramped strip)", vis.cardW >= 260, `${vis.cardW}px wide`);
check("item 5 · + Add Visitor is on screen without scrolling",
  vis.addVisible && vis.addRight <= vis.vw, `right=${vis.addRight} vw=${vis.vw}`);
check("item 5 · the toolbar row does not overflow horizontally", vis.toolbarOverflow <= 0, `overflow=${vis.toolbarOverflow}px`);
check("item 6 · NO purpose column / filter / word anywhere", !vis.purposeWord,
  vis.purposeWord ? vis.text.replace(/\s+/g, " ").slice(0, 200) : "clean");
check("item 5 · grid reflows into multiple columns", vis.cols >= 1, `${vis.cols} column(s)`);
await shot("visitors");

/* ================================ C · Students (items 7, 8) ========== */
await nav("students");
// Force the DAY theme, which is what the owner complained about.
await page.evaluate(() => {
  if (!document.body.classList.contains("light-mode")) window.toggleTheme();
});
await page.waitForTimeout(1200);

const stu = await page.evaluate(() => {
  const p = document.getElementById("page-students");
  const table = p ? p.querySelector(".data-table") : null;
  const th = table ? table.querySelector("thead th") : null;
  const rows = table ? [...table.querySelectorAll("tbody tr")] : [];
  const even = rows[1] ? rows[1].querySelector("td") : null; // stripe sits on the td
  const avatar = p ? p.querySelector(".avatar-sm") : null;
  const statusCell = rows.map((r) => [...r.querySelectorAll("td")].find((td) => td.querySelector(".st")))[0];
  const st = p ? p.querySelector(".st") : null;
  const pills = p ? p.querySelectorAll(".st.pill, .badge.status-badge").length : 0;
  return {
    light: document.body.classList.contains("light-mode"),
    tableW: table ? Math.round(table.getBoundingClientRect().width) : 0,
    thBg: th ? getComputedStyle(th).backgroundColor : "",
    evenBg: even ? getComputedStyle(even).backgroundColor : "",
    avatarBg: avatar ? getComputedStyle(avatar).backgroundColor : "",
    avatarTint: avatar ? avatar.className : "",
    hasAvatar: !!avatar,
    stPresent: !!st,
    stHtml: st ? st.outerHTML.slice(0, 220) : "",
    stDot: !!(st && st.querySelector(".st-dot")),
    pills,
    rejectedVisible: /Rahul gandhi/i.test(p ? p.innerText : ""),
    rowCount: rows.length,
    text: p ? p.innerText.replace(/\s+/g, " ").slice(0, 300) : "",
  };
});
check("item 7 · day theme active for the check", stu.light);
check("item 7 · table header has a real tinted background in day mode",
  stu.thBg !== "rgba(0, 0, 0, 0)" && stu.thBg !== "transparent", stu.thBg);
check("item 7 · zebra stripes are visible in day mode",
  stu.evenBg && stu.evenBg !== "rgba(0, 0, 0, 0)" && stu.evenBg !== "transparent", stu.evenBg);
check("item 7 · avatar rendered with an explicit tint", stu.hasAvatar && !!stu.avatarTint.match(/avatar-tint|avatar-sm/),
  `${stu.avatarBg} / ${stu.avatarTint}`);
check("item 7 · status is a dot + coloured text (not a pill)", stu.stPresent && stu.stDot && stu.pills === 0,
  stu.stHtml || "(no .st)");
check("item 7 · student rows render", stu.rowCount >= 1, `${stu.rowCount} row(s)`);
check("item 8 · the rejected applicant is GONE from the list", !stu.rejectedVisible,
  stu.rejectedVisible ? "still visible" : "absent");
await shot("students-day");

/* ============================ D · notification click-through (item 9) = */
await nav("notifications");
const before = await page.evaluate(() =>
  [...document.querySelectorAll('#page-notifications [data-notif-id]')].map((n) => n.dataset.notifId)
);
const admKey = before.find((k) => k.startsWith("adm_"));
check("item 9 · an admission alert is waiting in the bell list", !!admKey, before.slice(0, 4).join(", ") || "(none)");

if (admKey) {
  await page.evaluate((k) => {
    const el = document.querySelector(`#page-notifications [data-notif-id="${k}"]`);
    if (el) el.click();
  }, admKey);
  await page.waitForTimeout(3000);

  const after = await page.evaluate((key) => ({
    pageVisible: (() => {
      const p = document.getElementById("page-admissions");
      return !!p && (p.offsetParent !== null || getComputedStyle(p).display !== "none");
    })(),
    tabActive: ((document.getElementById("tab-pending-approval") || {}).className || "").includes("is-active"),
    viewOpen: (() => {
      const v = document.getElementById("view-pending-approval");
      return !!v && getComputedStyle(v).display !== "none";
    })(),
    detailsOpen: !!(document.getElementById("adm-details-modal") || {}).open,
    detailsName: document.querySelector("#adm-details-modal .ad-head h2")
      ? document.querySelector("#adm-details-modal .ad-head h2").textContent.trim() : "",
    stillListed: !!document.querySelector(`#page-notifications [data-notif-id="${key}"]`),
    keys: [...document.querySelectorAll("#page-notifications [data-notif-id]")].map((n) => n.dataset.notifId),
  }), admKey);
  check("item 9 · clicking lands on the Admissions page", after.pageVisible);
  check("item 9 · …and selects the Pending approval tab", after.tabActive && after.viewOpen,
    `active=${after.tabActive} view=${after.viewOpen}`);
  check("item 9 · …and opens that applicant's Details panel", after.detailsOpen && after.detailsName.length > 0,
    after.detailsName);
  check("item 9 · …and the notification disappears", !after.stillListed,
    after.keys.slice(0, 5).join(", ") || "list empty");
  await shot("notification-routing");
}

/* -------------------------------------------------------------- wrap up */
const authErr = errors.length;
console.log(`\npage errors: ${authErr ? errors.slice(0, 5).join(" | ") : "none"}`);
const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - failed.length} passed, ${failed.length} failed ===`);
if (failed.length) failed.forEach((f) => console.log(`  FAIL  ${f.name}  (${f.extra})`));

await browser.close();
server.close();
process.exit(failed.length ? 1 : 0);
