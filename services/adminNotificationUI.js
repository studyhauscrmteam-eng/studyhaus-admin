import { listenToPendingAdmissions } from "./admissionService.js";

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

/**
 * HTML block for the Notifications page (rendered above announcements).
 * Returned as a string so announcementAdminUI can embed it in one pass —
 * no two writers fighting over .notif-list.
 */
const alertsHtml = () => {
  const pending = window.__pendingAdmissions || [];
  if (pending.length === 0) return "";
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
    ${items}`;
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
