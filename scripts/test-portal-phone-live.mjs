// Live browser test: Student Portal login phone handling.
//
// The owner reported being blocked by a first-digit rule. The portal's rule is
// `normalizePhone(p).length === 10` (no prefix check) - this proves that on
// the deployed site: an 8-starting 10-digit number must get PAST validation
// and fail only on the password, while a too-short number must be rejected
// as invalid. No account is created; sign-in only, wrong password on purpose.
//
// Run: node scripts/test-portal-phone-live.mjs
import { chromium } from "playwright-core";

const URL = "https://studyhaus-crm-student.web.app/login.html";
// Covers every way the portal says "that is not a usable login id": not a
// 10-digit phone AND not a valid email address.
const INVALID_RE = /invalid phone|valid 10-digit|Login ID must be|valid email address/i;

const results = [];
const push = (name, ok, detail = "") =>
  results.push({ name, ok: ok ? "PASS" : "FAIL", detail });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
push("portal login page loads", (await page.title()).includes("Student Login"), await page.title());

async function attempt(id, password) {
  await page.fill("#email", "");
  await page.fill("#password", "");
  await page.fill("#email", id);
  await page.fill("#password", password);
  await page.click("#login-form button[type='submit'], #login-form .btn-submit, #btn-signin");
  // wait for the auth layer to answer
  await page.waitForTimeout(4500);
  const box = page.locator("#error-message");
  const visible = (await box.count()) > 0 && (await box.isVisible());
  return visible ? ((await box.textContent()) || "").trim() : "";
}

// 8-starting 10-digit number + wrong password -> must NOT be "invalid phone"
const e1 = await attempt("8888888888", "definitely-wrong-1");
push(
  '8-starting 10-digit phone passes validation (reaches auth)',
  !INVALID_RE.test(e1),
  e1 ? `got: ${e1.slice(0, 90)}` : "no validation error shown"
);

// too short -> must be rejected as invalid
const e2 = await attempt("88888", "definitely-wrong-1");
push(
  "9-or-fewer digits is rejected as invalid",
  INVALID_RE.test(e2),
  e2 ? `got: ${e2.slice(0, 90)}` : "no error shown"
);

// 8-starting must be treated exactly like a 6-starting number
const e3 = await attempt("6123456789", "definitely-wrong-1");
push(
  "6-starting number behaves the same way (no prefix preference)",
  !INVALID_RE.test(e3),
  e3 ? `got: ${e3.slice(0, 90)}` : "no validation error shown"
);

push("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));

await browser.close();

let fails = 0;
for (const r of results) {
  if (r.ok === "FAIL") fails++;
  console.log(`${r.ok.padEnd(5)} ${r.name}${r.detail ? `  -> ${r.detail}` : ""}`);
}
console.log(`\n${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
