/**
 * Analytics page (`#page-analytics`) — live numbers from Firestore.
 *
 * Replaces the old hardcoded "July 2024 / ₹71,000 / 8 / 68% / 72%" figures with:
 *   Revenue        -> sum of approved payments in the selected range
 *   New Students   -> students whose createdAt falls in the range
 *   Avg Occupancy  -> seats with status "Occupied" / total seats (current)
 *   Attendance     -> unique students who checked in during the range
 *   Bar chart      -> approved revenue for the last 6 months
 *   Plan split     -> active students grouped by planName
 *
 * Range tabs: This Month | Last Month | Quarter.
 * Works on every page that contains `#page-analytics` (admin/manager/index/...).
 */
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase/firebase.js";
import { isAdmitted } from "./studentProfile.js";

const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const BAR_COLORS = ["var(--accent-emerald)", "var(--accent-violet)", "var(--accent-blue)",
  "var(--accent-amber)", "var(--accent-teal)", "var(--danger)"];

// English fallback strings (used only if the translation bundle hasn't
// loaded yet — window.t falls back to the raw key in that case).
const EN_FALLBACK = {
  "analytics.subtitle": "{{label}} performance overview",
  "analytics.legendRevenue": "Revenue · peak {{amount}}",
  "analytics.revUp": "↑ {{pct}}% vs {{prev}}",
  "analytics.revDown": "↓ {{pct}}% vs {{prev}}",
  "analytics.revSame": "Same as {{prev}}",
  "analytics.revFirst": "First revenue in {{label}}",
  "analytics.revNone": "No revenue in {{label}}",
  "analytics.stuNone": "No new students in {{label}}",
  "analytics.stuUp": "↑ {{diff}} vs {{prev}}",
  "analytics.stuDown": "↓ {{diff}} vs {{prev}}",
  "analytics.stuSame": "Same as {{prev}}",
  "analytics.seatsOccupied": "{{occupied}} of {{total}} seats occupied",
  "analytics.noSeats": "No seats configured",
  "analytics.noActive": "No active students",
  "analytics.checkedIn": "{{count}} students checked in",
  "analytics.noCheckins": "No check-ins in this period",
  "analytics.loadError": "Could not load Firestore data",
  "analytics.noStudents": "No students yet — plan split appears once students are added.",
};

/** Translated string with English fallback (translation bundle may lag). */
const T = (key, args) => {
  try {
    if (typeof window !== "undefined" && typeof window.t === "function") {
      const out = window.t(key, args || {});
      if (out !== key) return out;
    }
  } catch (_) {}
  let s = EN_FALLBACK[key] || key;
  const a = args || {};
  for (const k of Object.keys(a)) s = s.split(`{{${k}}}`).join(String(a[k]));
  return s;
};

/** Active UI locale for month names (Gujarati when the app is in Gujarati). */
const activeLocale = () => {
  try {
    const l = String(localStorage.getItem("appLanguage") || "en").toLowerCase();
    return l.startsWith("gu") ? "gu-IN" : "en-IN";
  } catch (_) {
    return "en-IN";
  }
};

const monthName = (y, m, style) => {
  try {
    return new Intl.DateTimeFormat(activeLocale(), { month: style }).format(new Date(y, m, 1));
  } catch (_) {
    return (style === "long" ? MONTHS_LONG : MONTHS_SHORT)[m];
  }
};

const pad = n => String(n).padStart(2, "0");
const dateStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const inr = n => "₹" + Math.round(n).toLocaleString("en-IN");
const esc = s => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

let rangeKey = "month";
let cache = null;          // { payments, students, seats, attendance, at }
let rendering = false;

/** Timestamp | {seconds} | ISO string | "YYYY-MM-DD" -> local Date (or null) */
function toDate(v) {
  if (v == null || v === "") return null;
  if (typeof v.toDate === "function") return v.toDate();
  if (typeof v === "object" && typeof v.seconds === "number") return new Date(v.seconds * 1000);
  const s = String(v);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + "T00:00:00") : new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** Normalise any date-ish value to a comparable local "YYYY-MM-DD" string. */
function dateKey(v) {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const d = toDate(v);
  return d ? dateStr(d) : "";
}

function monthLabel(y, m) {
  return `${monthName(y, m, "long")} ${new Date(y, m, 1).getFullYear()}`;
}

/** Range bounds + the equivalent preceding period, as local date strings. */
function rangeBounds(key) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  let s, e, ps, pe, label, prevLabel, unit;

  if (key === "last") {
    s = new Date(y, m - 1, 1); e = new Date(y, m, 0);
    ps = new Date(y, m - 2, 1); pe = new Date(y, m - 1, 0);
    label = monthLabel(y, m - 1); prevLabel = monthLabel(y, m - 2); unit = "month";
  } else if (key === "quarter") {
    const q = Math.floor(m / 3);
    s = new Date(y, q * 3, 1); e = new Date(y, q * 3 + 3, 0);
    ps = new Date(y, q * 3 - 3, 1); pe = new Date(y, q * 3, 0);
    label = `Q${q + 1} ${y}`;
    const pd = new Date(y, q * 3 - 3, 1);
    prevLabel = `Q${Math.floor(pd.getMonth() / 3) + 1} ${pd.getFullYear()}`;
    unit = "quarter";
  } else {                                    // this month (default)
    s = new Date(y, m, 1); e = new Date(y, m + 1, 0);
    ps = new Date(y, m - 1, 1); pe = new Date(y, m, 0);
    label = monthLabel(y, m); prevLabel = monthLabel(y, m - 1); unit = "month";
  }

  return {
    start: dateStr(s), end: dateStr(e),
    prevStart: dateStr(ps), prevEnd: dateStr(pe),
    label, prevLabel, unit,
    // 6 calendar months ending with the range's final month (for the bar chart)
    endMonth: { y: e.getFullYear(), m: e.getMonth() },
  };
}

/** Each collection is read independently so one denied read can't blank the page.
 *  Students never have access to these staff-only aggregates — skip the reads
 *  entirely so the console isn't flooded with permission-denied warnings. */
async function loadData(force) {
  if (cache && !force && Date.now() - cache.at < 30000) return cache;
  try {
    if (typeof localStorage !== "undefined" && localStorage.getItem("userRole") === "Student") {
      cache = { payments: [], students: [], seats: [], attendance: [], at: Date.now(), _staffOnly: true };
      return cache;
    }
  } catch (_) {}
  const grab = name => getDocs(collection(db, name))
    .then(s => s.docs.map(d => d.data()))
    .catch(err => {
      const msg = (err && (err.message || err.code)) || "";
      // Permission errors are expected for non-staff roles — don't spam the console.
      if (/permission|insufficient/i.test(String(msg))) return null;
      console.warn(`[analytics] cannot read "${name}":`, err.message || err);
      return null;
    });

  const [payments, students, seats, attendance] = await Promise.all([
    grab("payments"), grab("students"), grab("seats"), grab("attendance"),
  ]);
  cache = { payments, students, seats, attendance, at: Date.now() };
  return cache;
}

function sumApprovedIn(payments, from, to) {
  if (!payments) return 0;
  return payments.reduce((total, p) => {
    if (p.status !== "approved" && p.status !== "Completed") return total;
    const d = dateKey(p.paymentDate || p.date || p.createdAt);
    return d && d >= from && d <= to ? total + (Number(p.amount) || 0) : total;
  }, 0);
}

function computeMetrics(data, b) {
  // Only people who are actually admitted count as active students — a
  // surviving Rejected / never-admitted doc (or a legacy "Old Student") must
  // not inflate new-student counts, attendance rate or the plan split.
  const active = (data.students || []).filter(s => isAdmitted(s) && s.status !== "Inactive");

  // Revenue
  const revenue = sumApprovedIn(data.payments, b.start, b.end);
  const prevRevenue = sumApprovedIn(data.payments, b.prevStart, b.prevEnd);

  // New students (needs createdAt — imported rows without a join date don't count,
  // and "Old"/"Inactive" members are excluded so an import can't look like admissions)
  const studentsCreatedIn = (from, to) => active.reduce((n, s) => {
    const d = dateKey(s.createdAt);
    return d && d >= from && d <= to ? n + 1 : n;
  }, 0);
  const newStudents = studentsCreatedIn(b.start, b.end);
  const prevNewStudents = studentsCreatedIn(b.prevStart, b.prevEnd);

  // Occupancy (current snapshot)
  const seats = data.seats || [];
  const occupied = seats.filter(s => s.status === "Occupied").length;
  const occupancy = seats.length ? Math.round((occupied / seats.length) * 100) : 0;

  // Attendance rate = unique attendees in range / active students
  const attendees = new Set();
  (data.attendance || []).forEach(a => {
    const d = dateKey(a.date);
    if (d && d >= b.start && d <= b.end && a.studentId) attendees.add(a.studentId);
  });
  const attendanceRate = active.length ? Math.min(100, Math.round((attendees.size / active.length) * 100)) : 0;

  // Monthly revenue for the bar chart (6 months ending at the range's last month)
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(b.endMonth.y, b.endMonth.m - i, 1);
    months.push({ key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`, label: monthName(d.getFullYear(), d.getMonth(), "short") });
  }
  const monthly = months.map(mo => ({
    ...mo,
    value: (data.payments || []).reduce((t, p) => {
      if (p.status !== "approved" && p.status !== "Completed") return t;
      const d = dateKey(p.paymentDate || p.date || p.createdAt);
      return d.slice(0, 7) === mo.key ? t + (Number(p.amount) || 0) : t;
    }, 0),
  }));

  // Plan distribution across non-old students
  const planMap = new Map();
  active.forEach(s => {
    const name = s.planName || "No Plan";
    planMap.set(name, (planMap.get(name) || 0) + 1);
  });
  const plans = [...planMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b2) => b2.count - a.count)
    .slice(0, 6);

  return { revenue, prevRevenue, newStudents, prevNewStudents, occupancy, occupied, seatTotal: seats.length, attendees: attendees.size, attendanceRate, monthly, plans, activeCount: active.length };
}

function change(cls, text) {
  return { cls: `metric-change ${cls}`, text };
}

function revenueChange(m, b) {
  if (m.prevRevenue > 0) {
    const pct = Math.round(((m.revenue - m.prevRevenue) / m.prevRevenue) * 100);
    if (pct > 0) return change("positive", T("analytics.revUp", { pct, prev: b.prevLabel }));
    if (pct < 0) return change("negative", T("analytics.revDown", { pct: Math.abs(pct), prev: b.prevLabel }));
    return change("neutral", T("analytics.revSame", { prev: b.prevLabel }));
  }
  if (m.revenue > 0) return change("positive", T("analytics.revFirst", { label: b.label }));
  return change("neutral", T("analytics.revNone", { label: b.label }));
}

function studentChange(m, b) {
  const diff = m.newStudents - m.prevNewStudents;
  if (m.prevNewStudents === 0 && m.newStudents === 0) return change("neutral", T("analytics.stuNone", { label: b.label }));
  if (diff > 0) return change("positive", T("analytics.stuUp", { diff, prev: b.prevLabel }));
  if (diff < 0) return change("negative", T("analytics.stuDown", { diff: Math.abs(diff), prev: b.prevLabel }));
  return change("neutral", T("analytics.stuSame", { prev: b.prevLabel }));
}

function renderBars(chart, monthly) {
  if (!chart) return;
  if (!monthly.length) { chart.innerHTML = ""; return; }
  const max = Math.max(...monthly.map(x => x.value), 1);
  chart.innerHTML = monthly.map((x, i) => {
    const pct = x.value > 0 ? Math.max(8, Math.round((x.value / max) * 100)) : 5;
    const active = i === monthly.length - 1 ? " active-bar" : "";
    return `<div class="bar-group">
      <div class="bar${active}" title="${esc(x.label)}: ${inr(x.value)}" style="--h:${pct}%"><span class="bar-label">${esc(x.label)}</span></div>
    </div>`;
  }).join("");
  if (typeof window !== "undefined" && typeof window.animateBars === "function") window.animateBars();
}

function renderPlanDist(box, plans) {
  if (!box) return;
  if (!plans.length) {
    box.innerHTML = `<div style="font-size:13px; color:var(--text-muted); padding:0.5rem 0;">${esc(T("analytics.noStudents"))}</div>`;
    return;
  }
  const max = Math.max(...plans.map(p => p.count), 1);
  box.innerHTML = plans.map((p, i) => `
    <div class="dist-row">
      <div class="dist-label" title="${esc(p.name)}" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(p.name)}</div>
      <div class="dist-bar-wrap"><div class="dist-bar" style="width:${Math.round((p.count / max) * 100)}%; background:${BAR_COLORS[i % BAR_COLORS.length]}"></div></div>
      <div class="dist-val">${p.count}</div>
    </div>`).join("");
}

function setMetric(card, value, chg) {
  const v = card.querySelector(".metric-value");
  const c = card.querySelector(".metric-change");
  if (v) v.textContent = value;
  if (c) { c.textContent = chg.text; c.className = chg.cls; }
}

async function renderAnalytics() {
  const page = document.getElementById("page-analytics");
  if (!page || rendering) return;
  // Analytics is a staff-only module. The student portal ships the same HTML
  // shell, so bail out quietly instead of firing denied reads.
  try {
    if (typeof localStorage !== "undefined" && localStorage.getItem("userRole") === "Student") return;
  } catch (_) {}
  rendering = true;

  const b = rangeBounds(rangeKey);
  const subtitle = page.querySelector(".page-subtitle");
  if (subtitle) subtitle.textContent = T("analytics.subtitle", { label: b.label });

  page.querySelectorAll(".metric-card").forEach(card => {
    const v = card.querySelector(".metric-value");
    if (v) v.textContent = "…";            // never leave the old hardcoded figures visible
  });

  try {
    const data = await loadData(false);
    const m = computeMetrics(data, b);

    // Cards carry data-metric in the template; DOM order is the fallback,
    // English label text the last resort (breaks once labels are translated,
    // so it stays last).
    const METRIC_ORDER = ["revenue", "students", "occupancy", "attendance"];
    const guessMetric = (card, i) => {
      if (card.dataset && card.dataset.metric) return card.dataset.metric;
      if (METRIC_ORDER[i]) return METRIC_ORDER[i];
      const label = (card.querySelector(".metric-label") || {}).textContent || "";
      if (/revenue/i.test(label)) return "revenue";
      if (/new student/i.test(label)) return "students";
      if (/occup/i.test(label)) return "occupancy";
      if (/attendance/i.test(label)) return "attendance";
      return "";
    };

    page.querySelectorAll(".metric-card").forEach((card, i) => {
      const key = guessMetric(card, i);
      if (key === "revenue") setMetric(card, inr(m.revenue), revenueChange(m, b));
      else if (key === "students") setMetric(card, String(m.newStudents), studentChange(m, b));
      else if (key === "occupancy") {
        setMetric(card, `${m.occupancy}%`,
          m.seatTotal ? change("neutral", T("analytics.seatsOccupied", { occupied: m.occupied, total: m.seatTotal }))
                      : change("neutral", T("analytics.noSeats")));
      } else if (key === "attendance") {
        setMetric(card, `${m.attendanceRate}%`,
          !m.activeCount ? change("neutral", T("analytics.noActive"))
            : m.attendees ? change("neutral", T("analytics.checkedIn", { count: m.attendees }))
              : change("neutral", T("analytics.noCheckins")));
      }
    });

    renderBars(page.querySelector(".bar-chart"), m.monthly);
    const legend = page.querySelector(".chart-legend");
    if (legend) {
      const peak = Math.max(...m.monthly.map(x => x.value), 0);
      legend.innerHTML = `<span class="legend-box emerald"></span> ${esc(T("analytics.legendRevenue", { amount: inr(peak) }))}`;
    }
    renderPlanDist(page.querySelector(".plan-dist"), m.plans);
  } catch (err) {
    console.warn("[analytics] render failed:", err);
    page.querySelectorAll(".metric-value").forEach(v => { v.textContent = "—"; });
    page.querySelectorAll(".metric-change").forEach(c => { c.textContent = T("analytics.loadError"); c.className = "metric-change neutral"; });
  } finally {
    rendering = false;
  }
}

let initialized = false;
export const initAnalyticsUI = () => {
  if (initialized) return;
  const page = document.getElementById("page-analytics");
  if (!page) return;                       // page not present on this screen
  try {
    // Never wire analytics for students — every collection read would be denied.
    if (typeof localStorage !== "undefined" && localStorage.getItem("userRole") === "Student") return;
  } catch (_) {}
  initialized = true;

  page.querySelectorAll(".filter-tabs .filter-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      // data-range survives translation; label text does not.
      const r = tab.dataset && tab.dataset.range;
      if (r === "last" || r === "quarter" || r === "month") {
        rangeKey = r;
      } else {
        const t = tab.textContent.trim().toLowerCase();
        rangeKey = t.includes("last") ? "last" : t.includes("quarter") ? "quarter" : "month";
      }
      renderAnalytics();
    });
  });

  // Re-render translated numbers/texts whenever the app language changes.
  window.addEventListener("languageChanged", () => {
    try { renderAnalytics(); } catch (_) {}
  });

  window.__renderAnalytics = renderAnalytics;   // called by navigate("analytics")
  renderAnalytics();                            // prime the page with real numbers
};

// Auto-init when this module lands on a page without firebase-entry wiring.
// Skipped for students so their console stays clean.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => setTimeout(() => {
    try { if (typeof localStorage !== "undefined" && localStorage.getItem("userRole") === "Student") return; } catch (_) {}
    initAnalyticsUI();
  }, 0));
} else {
  setTimeout(() => {
    try { if (typeof localStorage !== "undefined" && localStorage.getItem("userRole") === "Student") return; } catch (_) {}
    initAnalyticsUI();
  }, 0);
}
