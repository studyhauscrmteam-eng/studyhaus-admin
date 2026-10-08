import { listenToPendingAdmissions } from "./admissionService.js";
import { listenToAdminNotifications } from "./notificationService.js";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/firebase.js";

const BASE_TITLE = document.title || "Studyhaus — Reading Space CRM";
let firstSnapshot = true;
let knownIds = new Set();

const esc = (v) =>
  String(v == null ? "" : v).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));

/** Short WhatsApp-style double beep. Silent if audio is blocked. */
const beep = () => {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [0, 0.18].forEach((delay, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = i === 0 ? 880 : 660;
      osc.type = "sine";
      const t = ctx.currentTime + delay;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      osc.start(t);
      osc.stop(t + 0.16);
    });
    setTimeout(() => ctx.close().catch(() => {}), 600);
  } catch (_) { /* autoplay blocked or no audio — skip */ }
};

/** True while the Notifications page is on screen. */
const notifPageOpen = () => {
  const p = document.getElementById("page-notifications");
  return !!(p && p.getClientRects().length);
};

/** Turn the topbar dot into a WhatsApp-style count pill. */
const paintBell = (unread) => {
  // Auto-clear: being on the Notifications page always paints zero, no matter
  // which listener asked — a live Firestore snapshot must not re-raise the
  // badge while the owner is looking at the list.
  if (notifPageOpen()) unread = 0;
  const dot = document.getElementById("topbar-notif-dot");
  if (!dot) return;
  if (unread > 0) {
    dot.style.display = "flex";
    dot.style.width = "auto";
    dot.style.height = "16px";
    dot.style.minWidth = "16px";
    dot.style.padding = "0 4px";
    dot.style.alignItems = "center";
    dot.style.justifyContent = "center";
    dot.style.top = "0px";
    dot.style.right = "0px";
    dot.style.fontSize = "10px";
    dot.style.fontWeight = "700";
    dot.style.color = "#fff";
    dot.style.backgroundColor = "#ef4444";
    dot.style.borderRadius = "999px";
    dot.textContent = unread > 9 ? "9+" : String(unread);
  } else {
    dot.style.display = "none";
    dot.textContent = "";
  }
};

/** Browser tab badge: "(3) Studyhaus — Reading Space CRM". */
const paintTab = (unread) => {
  if (notifPageOpen()) unread = 0;
  document.title = unread > 0 ? `(${unread > 9 ? "9+" : unread}) ${BASE_TITLE}` : BASE_TITLE;
};

const fmtWhen = (r) => {
  try {
    const t = r.createdAt && typeof r.createdAt.toMillis === "function"
      ? r.createdAt.toMillis()
      : (r.createdAt ? new Date(r.createdAt).getTime() : Date.now());
    return new Date(t).toLocaleString();
  } catch (_) {
    return "Just now";
  }
};

// ---------- Decision history (Approve / Reject log) ----------
// The ADMISSION ALERTS block above is the LIVE pending queue, so an item
// necessarily disappears the moment it is decided. This log keeps a local
// record of each decision so the Notifications page still shows what
// happened afterwards. Local-only on purpose: no DB writes, no new
// collections, firestore.rules untouched.
const HISTORY_KEY = "sh_admission_decision_history_v1";

const readDecisionHistory = () => {
  try {
    const list = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch (_) {
    return [];
  }
};

/** Called by approveStudent / rejectStudent after a successful decision. */
window.recordAdmissionDecision = (entry) => {
  try {
    const list = readDecisionHistory();
    list.unshift({
      admissionId: (entry && entry.admissionId) || "",
      name: (entry && entry.name) || "Admission",
      phone: (entry && entry.phone) || "",
      planName: (entry && entry.planName) || "",
      seat: (entry && entry.seat) || "",
      decision: (entry && entry.decision) || "",
      reason: (entry && entry.reason) || "",
      by: localStorage.getItem("userRole") || "Staff",
      at: Date.now(),
    });
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 50)));
    if (typeof window.__refreshNotifBadges === "function") window.__refreshNotifBadges();
  } catch (_) { /* storage blocked/full — the decision itself still stands */ }
};

window.clearAdmissionDecisionHistory = () => {
  try { localStorage.removeItem(HISTORY_KEY); } catch (_) {}
  if (typeof window.__refreshNotifBadges === "function") window.__refreshNotifBadges();
};

const historyHtml = () => {
  const list = readDecisionHistory();
  if (list.length === 0) return "";
  const items = list.slice(0, 15).map((h) => {
    const approved = h.decision === "Approved";
    const icon = approved
      ? `<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>`
      : `<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>`;
    const meta = [
      h.planName ? esc(h.planName) : "",
      h.seat ? `Seat ${esc(h.seat)}` : "",
      h.reason ? `Reason: ${esc(h.reason)}` : "",
    ].filter(Boolean).join(" · ");
    return `
      <div class="notif-item">
        <div class="notif-icon ${approved ? "green" : "red"}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">${icon}</svg>
        </div>
        <div class="notif-content" style="flex:1;">
          <div class="notif-title">${esc(h.name || "Admission")} — ${approved ? "Approved" : "Rejected"}</div>
          <div class="notif-body">${meta || (h.phone ? esc(h.phone) : "Admission decision recorded")}</div>
          <div class="notif-time">${new Date(h.at).toLocaleString()}${h.by ? ` · ${esc(h.by)}` : ""}</div>
        </div>
      </div>`;
  }).join("");
  return `
    <div style="font-size:12px; font-weight:700; letter-spacing:.04em; color:var(--text-muted); padding:.75rem .25rem .5rem;">
      RECENT DECISIONS · ${list.length} (last 50 kept on this device)
      <button class="btn btn-ghost" style="padding:1px 8px; font-size:11px; margin-left:8px; color:var(--text-muted);" onclick="window.clearAdmissionDecisionHistory()">Clear</button>
    </div>
    ${items}`;
};

/**
 * HTML block for the Notifications page (rendered above announcements).
 * Returned as a string so announcementAdminUI can embed it in one pass —
 * no two writers fighting over .notif-list.
 */
const alertsHtml = () => {
  const pending = window.__pendingAdmissions || [];
  const decided = historyHtml();
  if (pending.length === 0) return decided;
  const role = localStorage.getItem("userRole");
  const canReview = role === "Owner/Admin" || role === "Manager";
  const items = pending.slice(0, 10).map((r) => `
      <div class="notif-item unread">
        <div class="notif-icon red">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        </div>
        <div class="notif-content" style="flex:1;">
          <div style="display:flex; justify-content:space-between; gap:.5rem; align-items:flex-start;">
            <div class="notif-title">${esc(r.name || "New admission request")}</div>
            ${canReview ? `<button class="btn btn-secondary btn-sm" style="padding:4px 10px; font-size:12px; white-space:nowrap;" onclick="window.reviewAdmissionAlert()">Review</button>` : ""}
          </div>
          <div class="notif-body">${esc(r.phone || "")}${r.planName ? ` · ${esc(r.planName)}` : ""} — waiting for approval</div>
          <div class="notif-time">${esc(fmtWhen(r))}</div>
        </div>
      </div>`).join("");
  return `
    <div style="font-size:12px; font-weight:700; letter-spacing:.04em; color:var(--text-muted); padding:.25rem .25rem .5rem;">
      ADMISSION ALERTS · ${pending.length} WAITING
    </div>
    ${items}${decided}`;
};

window.reviewAdmissionAlert = () => {
  if (typeof navigate === "function") navigate("admissions");
  if (typeof window.switchAdmissionTab === "function") {
    setTimeout(() => window.switchAdmissionTab("pending"), 150);
  }
};

export const initAdminNotificationUI = () => {
  const list = document.querySelector("#page-notifications .notif-list");
  if (!list) return; // not on a dashboard with notifications
  const role = localStorage.getItem("userRole");
  if (role === "Student") return;

  window.__renderAdmissionAlerts = alertsHtml;
  window.__admissionBadgesLive = true; // bell pill painted here; don't reset it
  window.__pendingAdmissions = [];
  window.__admissionUnread = 0;
  paintTab(0);

  // The `notifications` collection (approval decisions + new admission
  // requests written by notifyAdmins()) had no reader anywhere in the app —
  // events were recorded but never surfaced. Subscribe here and hand the list
  // to the announcements renderer so both share one bell and one list.
  window.__systemNotifs = [];
  window.__leadNotifs = [];
  try {
    listenToAdminNotifications((records) => {
      window.__systemNotifs = Array.isArray(records) ? records : [];
      if (typeof window.__refreshNotifBadges === "function") window.__refreshNotifBadges();
    });
  } catch (e) {
    console.error("[notifications] list listener failed:", e);
  }

  // New website enquiries. The public form writes `visitors` straight from the
  // browser, so no admin module ever runs on that path and notifyAdmins() never
  // fired for it — which is why the owner saw nothing when someone signed up.
  // Watch the lead queue itself so a fresh enquiry still rings the bell.
  try {
    let knownLeads = null;
    onSnapshot(
      query(collection(db, "visitors"), where("source", "==", "Website")),
      (snap) => {
        const live = new Set();
        const fresh = [];
        snap.forEach((d) => {
          const v = d.data() || {};
          if ((v.leadStatus || "New") !== "New") return;
          live.add(d.id);
          if (knownLeads && !knownLeads.has(d.id)) fresh.push({ id: d.id, ...v });
        });
        const first = knownLeads === null;
        knownLeads = live;
        if (first || fresh.length === 0) return;

        beep();
        const n = fresh[0];
        const extra = fresh.length > 1 ? ` (+${fresh.length - 1} more)` : "";
        if (typeof window.showToast === "function") {
          window.showToast(
            `🌐 New website enquiry: ${n.visitorName || n.phone || "someone"}${extra} — open Visitors.`,
            "info"
          );
        }
        window.__leadNotifs = [
          ...fresh.map((v) => ({
            id: "lead_" + v.id,
            type: "new-lead",
            title: "New website enquiry",
            body: `${v.visitorName || ""}${v.phone ? " · " + v.phone : ""}${v.planName ? " · " + v.planName : ""}`,
            createdAt: v.createdAt,
          })),
          ...(window.__leadNotifs || []),
        ].slice(0, 20);
        if (typeof window.__refreshNotifBadges === "function") window.__refreshNotifBadges();
      },
      (e) => console.error("[notifications] lead watch failed:", e?.message || e)
    );
  } catch (e) {
    console.error("[notifications] lead watch setup failed:", e);
  }

  // Source of truth = the live Pending-approval queue itself. Works no
  // matter how the admission was created (portal, admin, or the website
  // writing to `admissions` directly). Badge clears when you Approve/Reject.
  listenToPendingAdmissions(
    (records) => {
      window.__pendingAdmissions = records;
      window.__admissionUnread = records.length;

      // New arrivals (skip the very first snapshot): toast + beep.
      if (!firstSnapshot) {
        const fresh = records.filter((r) => !knownIds.has(r.id));
        if (fresh.length > 0) {
          const first = fresh[0];
          const extra = fresh.length > 1 ? ` (+${fresh.length - 1} more)` : "";
          beep();
          if (typeof window.showToast === "function") {
            window.showToast(`🔔 New admission: ${first.name || "Student"}${extra} — tap the bell to review.`, "info");
          }
        }
      }
      firstSnapshot = false;
      knownIds = new Set(records.map((r) => r.id));

      paintBell(records.length);
      paintTab(records.length);
      // Re-render badges + list through the single announcements renderer
      // so the sidebar badge never flaps between two writers.
      if (typeof window.__refreshNotifBadges === "function") window.__refreshNotifBadges();
    },
    () => {
      window.__pendingAdmissions = [];
      window.__admissionUnread = 0;
      paintBell(0);
      paintTab(0);
      if (typeof window.__refreshNotifBadges === "function") window.__refreshNotifBadges();
    }
  );
};
