// End-to-end PROOF that account creation works on the live portal.
//
// The owner's bug: "Firestore transactions require all reads to be executed
// before all writes." completeSignup created the Auth user first, then the
// transaction threw (tx.get after tx.set) -> half-made account every time.
// This signs up a phone number that provably belongs to nobody (verified
// free against all 229 student docs first), and asserts the redirect to the
// dashboard - i.e. the transaction committed.
//
// Run: node scripts/test-account-create-live.mjs
import { chromium } from "playwright-core";

const URL = "https://student.shreejilibrary.co.in/login.html";
const PHONE = "9009009011"; // verified FREE; 9009009009/9009009010 consumed by earlier failed runs
const PASS = "TestAcct#2026";

const results = [];
const push = (name, ok, detail = "") =>
  results.push({ name, ok: ok ? "PASS" : "FAIL", detail });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

// Record which version of onboardingService.js the browser actually ran.
const served = [];
page.on("response", async (res) => {
  if (/onboardingService\.js/.test(res.url())) {
    try {
      const body = await res.text();
      served.push({
        url: res.url(),
        status: res.status(),
        cache: res.headers()["x-cache"] || res.headers()["age"] || "-",
        hasFix: /oldDocsRef \? await tx\.get/.test(body),
        hasOldReadAfterWrite: /tx\.set\([\s\S]{0,900}?await tx\.get\(oldDocsRef\)/.test(body),
      });
    } catch {}
  }
});

const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
push("portal loads over the custom domain", (await page.title()).includes("Student Login"), await page.title());

await page.click("#tab-signup");
try {
  await page.waitForSelector("#su-name", { state: "visible", timeout: 15000 });
  push("signup form is reachable", true);
} catch {
  push(
    "signup form is reachable",
    false,
    `#signup-form display=${await page.evaluate(() => document.getElementById("signup-form")?.style.display || "unset")} | tab-active=${await page.evaluate(() => document.getElementById("tab-signup")?.classList.contains("active"))}`
  );
  console.log("\n--- captured page errors ---");
  for (const e of errors) console.log("  " + e.slice(0, 400));
  if (!errors.length) console.log("  (none)");
  console.log("\n--- onboardingService.js served ---");
  for (const s of served) console.log("  " + JSON.stringify(s));
  if (!served.length) console.log("  (never requested)");
  await browser.close();
  for (const r of results) console.log(`${r.ok.padEnd(5)} ${r.name}${r.detail ? `  -> ${r.detail}` : ""}`);
  process.exit(1);
}

await page.fill("#su-name", "Test Account Verify");
await page.fill("#su-identifier", PHONE);
await page.fill("#su-password", PASS);
await page.fill("#su-confirm", PASS);

const t0 = Date.now();
await page.click("#btn-signup");

// Either it redirects (transaction committed) or #error-message appears.
let landed = null, errText = "";
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(1000);
  const url = page.url();
  if (!url.includes("/login.html")) { landed = url; break; }
  const box = page.locator("#error-message");
  if ((await box.count()) > 0 && (await box.isVisible())) {
    errText = ((await box.textContent()) || "").trim();
    if (errText) break;
  }
}
const secs = ((Date.now() - t0) / 1000).toFixed(1);

push(
  "account created (redirected off the login page)",
  !!landed,
  landed ? `-> ${landed} in ${secs}s` : `stuck, error: ${errText || "(none)"}`
);

push(
  "no read-after-write transaction error",
  !/all reads to be executed before all writes/i.test(errText),
  errText ? errText.slice(0, 140) : "no error shown"
);

push(
  "no other signup error",
  !errText || /sign in/i.test(errText),
  errText ? errText.slice(0, 140) : "clean"
);

const jsErrors = errors.filter((e) => !/favicon|Failed to load resource/i.test(e));
push("no uncaught page errors", jsErrors.length === 0, jsErrors.slice(0, 2).join(" | "));

await browser.close();

console.log("\n--- onboardingService.js as actually served to the browser ---");
if (!served.length) console.log("  (module was never requested!)");
for (const s of served) console.log("  " + JSON.stringify(s));

let fails = 0;
for (const r of results) {
  if (r.ok === "FAIL") fails++;
  console.log(`${r.ok.padEnd(5)} ${r.name}${r.detail ? `  -> ${r.detail}` : ""}`);
}
console.log(`\n${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
