// Sign in with the account created by test-account-create-live.mjs and prove
// the dashboard renders - i.e. the account is fully usable, not half-made.
import { chromium } from "playwright-core";

const URL = "https://student.shreejilibrary.co.in/login.html";
const ID = "9009009011";
const PASS = "TestAcct#2026";

const results = [];
const push = (n, ok, d = "") => results.push({ n, ok: ok ? "PASS" : "FAIL", d });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const errs = [];
page.on("pageerror", (e) => errs.push(e.message));

await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
await page.fill("#email", ID);
await page.fill("#password", PASS);
await page.click("#login-form button[type='submit']");

let landed = "";
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(1000);
  if (!page.url().includes("/login.html")) { landed = page.url(); break; }
}
push("signed in (left the login page)", !!landed, landed || "still on login");

if (landed) {
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const title = await page.title();
  const body = await page.locator("body").innerText();
  push("dashboard rendered (page has content)", body.length > 200, `title="${title}" ${body.length} chars`);
  push("no 'User role not found' on a normal sign-in", !/User role not found/i.test(errs.join(" ")),
    errs.filter((e) => /role not found/i.test(e)).join(" | ") || "clean");
  push("stayed on the dashboard (not bounced back)", page.url().includes("dashboard"), page.url());
} else {
  const box = page.locator("#error-message");
  const t = (await box.count()) && (await box.isVisible()) ? await box.textContent() : "";
  push("signed in (left the login page)", false, `error: ${t}`);
}

await browser.close();
let f = 0;
for (const r of results) { if (r.ok === "FAIL") f++; console.log(`${r.ok.padEnd(5)} ${r.n}${r.d ? `  -> ${r.d}` : ""}`); }
console.log(`\n${results.length - f}/${results.length} passed`);
process.exit(f ? 1 : 0);
