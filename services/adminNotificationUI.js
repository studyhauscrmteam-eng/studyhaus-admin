import { listenToPendingAdmissions } from "./admissionService.js";
import { listenToAdminNotifications } from "./notificationService.js";
import { isNotifRead } from "./notificationReadState.js";
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

/** Turn the topbar dot into a WhatsApp-style count pill. */
const paintBell = (unread) => {
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
  document.title = unread > 0 ? `(${unread > 9 ? "9+" : unread}) ${BASE_TITLE}` : BASE_TITLE;
};

/**
 * Single entry point for the bell pill + tab title. announcementAdminUI owns
 * the ONE unread total (announcements + activity + leads + admission alerts)
 * and hands it here, so sidebar, bell and tab can never disagree.
 */
window.__paintNotifBadges = (n) => { paintBell(n); paintTab(n); };

const fmtWhen = (r) => {
  try {
    const v = r.createdAt;
    if (!v) return "Date unavailable";
    const t = typeof v.toMillis === "function" ? v.toMillis()
      : typeof v.seconds === "number" ? v.seconds * 1000
        : (typeof v === "string" || v instanceof Date ? new Date(v).getTime() : NaN);
    // Never render "Invalid Date" — say so plainly instead.
    return Number.isFinite(t) ? new Date(t).toLocaleString() : "Date unavailable";
  } catch (_) {
    return "Date unavailable";
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
    // Approved / Rejected / Dismissed / Expired — show what actually happened.
    const decision = h.decision || "Rejected";
    const approved = decision === "Approved";
    const neutral = decision === "Dismissed" || decision === "Expired";
    const icon = approved
      ? `<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>`
      : neutral
        ? `<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>`
        : `<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>`;
    const meta = [
      h.planName ? esc(h.planName) : "",
      h.seat ? `Seat ${esc(h.seat)}` : "",
      h.reason ? `Reason: ${esc(h.reason)}` : "",
    ].filter(Boolean).join(" · ");
    return `
      <div class="notif-item">
        <div class="notif-icon ${approved ? "green" : neutral ? "amber" : "red"}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">${icon}</svg>
        </div>
        <div class="notif-content" style="flex:1;">
          <div class="notif-title">${esc(h.name || "Admission")} — ${esc(decision)}</div>
          <div class="notif-body">${meta || (h.phone ? esc(h.phone) : "Admission decision recorded")}</div>
          <div class="notif-time">${new Date(h.at).toLocaleString()}${h.by ? ` · ${esc(h.by)}` : ""}</div>
        </div>
      </div>`;
  }).join("");
  return `
    <div style="font-size:12px; font-weight:700; letter-spacing:.04em; color:var(--text-muted); padding:.75rem .25rem .5rem;">
      RECENT DECISIONS · ${list.length} (last 50 kept on this device)
    </div>
    ${items}`;
};

/**
 * HTML block for the Notifications page (rendered above announcements).
 * Returned as a string so announcementAdminUI can embed it in one pass —
 * no two writers fighting over .notif-list.
 */
const alertsHtml = () => {
  const all = window.__pendingAdmissions || [];
  // Clicked alerts leave the list (exactly like every other notification) —
  // but ONLY the clicked one. Merely opening the Notifications page clears
  // the badges (seen-state) and never dismisses alerts. The applicant is
  // untouched until Approved/Rejected in Pending approval.
  const pending = all.filter((r) => !isNotifRead(`adm_${r.id}`));
  const decided = historyHtml();
  if (pending.length === 0) return decided;
  // Plain cards like every other notification: no Review button, the whole
  // card is the click target and it disappears when tapped.
  const items = pending.slice(0, 10).map((r) => `
      <div class="notif-item unread" data-notif-id="adm_${r.id}" title="Click to open Pending approval">
        <div class="notif-icon red">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        </div>
        <div class="notif-content" style="flex:1;">
          <div class="notif-title">${esc(r.name || "New admission request")}</div>
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

/**
 * Seat-change request block for the Notifications page. Buttons (not the
 * card) decide — Approve/Reject run inline and the request leaves the queue.
 * Decided on the Seats page instead? It disappears here too (same queue).
 */
const seatAlertsHtml = () => {
  const all = window.__pendingSeatRequests || [];
  if (all.length === 0) return "";
  const items = all.slice(0, 10).map((r) => `
      <div class="notif-item unread">
        <div class="notif-icon amber">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M5 11a2 2 0 0 1 2 2v2h10v-2a2 2 0 1 1 4 0v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2z"/><path d="M5 11V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4"/></svg>
        </div>
        <div class="notif-content" style="flex:1;">
          <div class="notif-title">${esc(r.studentName || "Student")} wants seat ${esc(r.toSeat || "?")}</div>
          <div class="notif-body">Now ${esc(r.fromSeat || "?")} · ${esc(r.toFloor || "")}${r.reason ? ` · “${esc(r.reason)}”` : ""} — decide on the Seats page</div>
          <div style="display:flex; gap:.4rem; margin-top:.4rem;">
            <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); window.approveSeatChange('${r.id}')">Approve</button>
            <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation(); window.rejectSeatChange('${r.id}')">Reject</button>
          </div>
        </div>
      </div>`).join("");
  return `
    <div style="font-size:12px; font-weight:700; letter-spacing:.04em; color:var(--text-muted); padding:.75rem .25rem .5rem;">
      SEAT CHANGES · ${all.length} WAITING
    </div>
    ${items}`;
};

export const initAdminNotificationUI = () => {
  const list = document.querySelector("#page-notifications .notif-list");
  if (!list) return; // not on a dashboard with notifications
  const role = localStorage.getItem("userRole");
  if (role === "Student") return;

  window.__renderAdmissionAlerts = alertsHtml;
  window.__renderSeatAlerts = seatAlertsHtml;
  window.__admissionBadgesLive = true; // bell pill painted here; don't reset it
  window.__pendingAdmissions = [];
  window.__pendingSeatRequests = [];
  paintTab(0);

  // Student seat-change requests: same live-queue treatment as admissions —
  // bell rings on arrival, badge clears on Approve/Reject.
  import("./seatRequestService.js").then(({ listenToPendingSeatRequests, wireSeatRequestActions }) => {
    try { wireSeatRequestActions(); } catch (_) {}
    let knownSeatReqs = null;
    try {
      listenToPendingSeatRequests((records) => {
        window.__pendingSeatRequests = Array.isArray(records) ? records : [];
        if (knownSeatReqs !== null) {
          const fresh = window.__pendingSeatRequests.filter((r) => !knownSeatReqs.has(r.id));
          if (fresh.length > 0) {
            beep();
            const f = fresh[0];
            const extra = fresh.length > 1 ? ` (+${fresh.length - 1} more)` : "";
            if (typeof window.showToast === "function") {
              window.showToast(`🪑 Seat change: ${f.studentName || "A student"} wants seat ${f.toSeat || "?"}${extra} — open Seats.`, "info");
            }
          }
        }
        knownSeatReqs = new Set(window.__pendingSeatRequests.map((r) => r.id));
        if (typeof window.__refreshNotifBadges === "function") window.__refreshNotifBadges();
      });
    } catch (e) {
      console.error("[notifications] seat-request watch failed:", e);
    }
  }).catch(() => {});

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
        const allNew = [];
        snap.forEach((d) => {
          const v = d.data() || {};
          if ((v.leadStatus || "New") !== "New") return;
          live.add(d.id);
          allNew.push({ id: d.id, ...v });
          if (knownLeads && !knownLeads.has(d.id)) fresh.push({ id: d.id, ...v });
        });
        const first = knownLeads === null;
        knownLeads = live;
        // The list is the LIVE New-lead queue (not just arrivals this session),
        // so an enquiry stays until it is Converted/Closed or clicked away.
        // Clicked-away leads stay gone via the shared read-state (sys_lead_*).
        window.__leadNotifs = allNew
          .sort((a, b) => {
            const ta = (a.createdAt && (a.createdAt.seconds || 0)) || 0;
            const tb = (b.createdAt && (b.createdAt.seconds || 0)) || 0;
            return tb - ta;
          })
          .slice(0, 20)
          .map((v) => ({
            id: "lead_" + v.id,
            type: "new-lead",
            title: "New website enquiry",
            body: `${v.visitorName || ""}${v.phone ? " · " + v.phone : ""}${v.planName ? " · " + v.planName : ""}`,
            createdAt: v.createdAt,
          }));
        if (first || fresh.length === 0) {
          if (typeof window.__refreshNotifBadges === "function") window.__refreshNotifBadges();
          return;
        }

        beep();
        const n = fresh[0];
        const extra = fresh.length > 1 ? ` (+${fresh.length - 1} more)` : "";
        if (typeof window.showToast === "function") {
          window.showToast(
            `🌐 New website enquiry: ${n.visitorName || n.phone || "someone"}${extra} — open Visitors.`,
            "info"
          );
        }
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

      // Re-render the list AND all three badges through the single renderer,
      // which owns the one unread total (this module no longer paints the
      // bell or the tab title itself — two writers made them disagree).
      if (typeof window.__refreshNotifBadges === "function") window.__refreshNotifBadges();
    },
    () => {
      window.__pendingAdmissions = [];
      if (typeof window.__refreshNotifBadges === "function") window.__refreshNotifBadges();
    }
  );
};
