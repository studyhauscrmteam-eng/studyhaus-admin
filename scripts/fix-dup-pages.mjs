// Remove the dead SECOND copy of each duplicated `page-*` section.
//
// Every dashboard ships an empty placeholder as the FIRST element with a given
// id (`<div class="page" id="page-visitors"></div>`) which is what app.js shows
// and what visitorAdminUI/seatMapUI/attendanceAdminUI/paymentAdminUI/
// expenseAdminUI/complaintAdminUI write into. The SECOND element with the same
// id is a static mockup (fake rows, "+ Log Visitor", hardcoded seat grid) that
// can never be reached: getElementById returns the first match, and .page{display:none}
// only .page.active gets shown.
//
// Duplicated ids are also invalid HTML, so browsers resolve every lookup to the
// placeholder while the mockup just inflates the DOM and confuses selectors
// like app.js's load-time `.filter-tab` / `.btn-primary` scans.
//
//   node scripts/fix-dup-pages.mjs           dry run (prints what would go)
//   node scripts/fix-dup-pages.mjs --apply   actually rewrite the files
import fs from "node:fs";

const APPLY = process.argv.includes("--apply");
const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const FILES = [
  "admin/dashboard.html",
  "index.html",
  "manager/dashboard.html",
  "employee/dashboard.html",
];
const IDS = [
  "page-seats",
  "page-attendance",
  "page-payments",
  "page-expenses",
  "page-complaints",
  "page-visitors",
];

/** Bounds of the whole `<div ...>` element whose tag contains `idPos`. */
function elementBounds(src, idPos) {
  const start = src.lastIndexOf("<div", idPos);
  if (start < 0) return null;
  const tagEnd = src.indexOf(">", start);
  if (tagEnd < 0 || idPos > tagEnd) return null; // not the same tag

  const re = /<div\b[^>]*>|<\/div>/g;
  re.lastIndex = start;
  let depth = 0;
  let m;
  while ((m = re.exec(src))) {
    if (m[0].startsWith("</")) {
      if (--depth === 0) return { start, end: m.index + m[0].length };
    } else {
      depth++;
    }
  }
  return null;
}

/** Grow bounds outward to swallow whole lines. */
function toLines(src, b) {
  let start = b.start;
  while (start > 0 && src[start - 1] !== "\n") start--;
  let end = b.end;
  while (end < src.length && src[end] !== "\n") end++;
  if (end < src.length) end++; // include the newline itself
  return { start, end };
}

const lineOf = (src, i) => src.slice(0, i).split("\n").length;

for (const rel of FILES) {
  const path = ROOT + rel;
  let src = fs.readFileSync(path, "utf8");
  const original = src;
  let removed = 0;

  for (const id of IDS) {
    const needle = `id="${id}"`;
    const first = src.indexOf(needle);
    if (first < 0) continue;
    const second = src.indexOf(needle, first + needle.length);
    if (second < 0) continue; // already cleaned

    const b = elementBounds(src, second);
    if (!b) {
      console.log(`  !! ${rel}: could not balance ${id}, skipped`);
      continue;
    }
    const span = toLines(src, b);
    const preview = src.slice(span.start, span.end);
    const from = lineOf(src, span.start);
    const to = lineOf(src, span.end);
    const lines = preview.split("\n").length;

    if (!APPLY) {
      const head = preview.split("\n").find((l) => l.trim()) || "";
      console.log(
        `  DRY ${rel}: ${id}  lines ${from}-${to} (${lines} lines)  starts: ${head.trim().slice(0, 72)}`
      );
    }

    src = src.slice(0, span.start) + src.slice(span.end);
    removed++;
  }

  if (APPLY) {
    fs.writeFileSync(path, src, "utf8");
    const delta = original.length - src.length;
    console.log(`OK   ${rel}: removed ${removed} dead block(s), -${delta} chars`);
  } else {
    console.log(`--   ${rel}: ${removed} dead block(s) would be removed\n`);
  }
}
