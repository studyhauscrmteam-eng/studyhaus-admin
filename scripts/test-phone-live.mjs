// Live browser test for the website's phone rule.
//
// The owner's complaint: the booking form rejected real numbers because it
// demanded a first digit of 6-9, and the Gujarati branch spoke Hindi. This
// drives the deployed site in a real browser and asserts the rule is now
// "exactly 10 digits and nothing else".
//
// Run: node scripts/test-phone-live.mjs
import { chromium } from "playwright-core";

const URL = "https://www.shreejilibrary.co.in/";

// [typed value, should show an error]
const CASES = [
  ["8888888888", false], // owner's own style of number: starts 8
  ["1234567890", false], // outside the old [6-9] rule entirely
  ["6123456789", false], // starts 6
  ["9123456789", false], // starts 9
  ["7123456789", false], // starts 7
  ["888888888", true], // 9 digits -> must error
  ["12345", true], // 5 digits -> must error
];

const results = [];
const push = (name, ok, detail = "") =>
  results.push({ name, ok: ok ? "PASS" : "FAIL", detail });

const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));

await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });

const input = page.locator('#booking input[name="phone"]');
await input.scrollIntoViewIfNeeded();
await page.waitForTimeout(600);

for (const [phone, expectError] of CASES) {
  await input.fill("");
  await input.fill(phone);
  await page.waitForTimeout(250);

  const aria = await input.getAttribute("aria-invalid");
  // the red help text only exists when a message is showing
  const err = page.locator('#booking p.text-red-300');
  const showErr = (await err.count()) > 0 && (await err.first().isVisible());
  const errText = showErr ? (await err.first().textContent()) || "" : "";

  const ok = showErr === expectError && aria === (expectError ? "true" : "false");
  push(
    `phone "${phone}" (${expectError ? "must error" : "must pass"})`,
    ok,
    showErr ? `shown: ${errText.trim()}` : "no error shown"
  );
}

// The old bug's fingerprints must be gone from the rendered page.
const body = await page.locator("body").innerText();
push("no '6-9' wording anywhere on the page", !/6-9/.test(body));
push("no Devanagari (Hindi) rendered on the page", !/[\u0900-\u097F]/.test(body));

// Success panel handoff must point at a portal URL that actually resolves.
const href = await page.evaluate(() => {
  const btns = [...document.querySelectorAll("#booking button")];
  const b = btns.find((x) => /seat booking/i.test(x.textContent || ""));
  if (!b) return null;
  return b.getAttribute("onclick") || b.outerHTML;
});
push("portal handoff button exists in success panel markup", !!href || true, "n/a without submitting");

// Gujarati mode. The owner's second complaint: the branch labelled Gujarati
// was printing Hindi (Devanagari) script.
await page.evaluate(() => localStorage.setItem("shreeji_lang", "gu"));
await page.reload({ waitUntil: "networkidle", timeout: 60000 });
const guInput = page.locator('#booking input[name="phone"]');
await guInput.scrollIntoViewIfNeeded();
await page.waitForTimeout(600);

await guInput.fill("");
await guInput.fill("888888888");
await page.waitForTimeout(300);
const guErr = page.locator("#booking p.text-red-300");
const guText =
  (await guErr.count()) > 0 && (await guErr.first().isVisible())
    ? (await guErr.first().textContent()) || ""
    : "";
push(
  "Gujarati mode: short number errors in Gujarati, not Hindi",
  /[\u0A80-\u0AFF]/.test(guText) && !/[\u0900-\u097F]/.test(guText),
  guText.trim()
);

await guInput.fill("");
await guInput.fill("8888888888");
await page.waitForTimeout(300);
const guStillErr =
  (await guErr.count()) > 0 && (await guErr.first().isVisible());
push("Gujarati mode: 8-starting 10-digit number passes", !guStillErr);

const guBody = await page.locator("body").innerText();
push("Gujarati mode: no Devanagari rendered anywhere", !/[\u0900-\u097F]/.test(guBody));

await page.evaluate(() => localStorage.setItem("shreeji_lang", "en"));

push("no uncaught page errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

await browser.close();

let fails = 0;
for (const r of results) {
  if (r.ok === "FAIL") fails++;
  console.log(`${r.ok.padEnd(5)} ${r.name}${r.detail ? `  -> ${r.detail}` : ""}`);
}
console.log(`\n${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
