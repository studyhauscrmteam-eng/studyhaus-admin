import { createAnnouncement, listenToAnnouncements, deleteAnnouncement, getAllStudentsForDropdown, isAnnouncementLive } from "./announcementService.js";
import { markAllNotificationsRead, markNotificationRead } from "./notificationService.js";
import { isNotifRead, markNotifRead, markNotifsRead, countUnread } from "./notificationReadState.js";

// OWN copy of the tab title. This used to reference BASE_TITLE from
// adminNotificationUI.js — a module-scoped const that is NOT in scope here —
// so every render while the Notifications page was open threw
// "ReferenceError: BASE_TITLE is not defined" BEFORE the list was written and
// the page froze on "Loading announcements..." for ever.
const BASE_TITLE = document.title || "Studyhaus — Reading Space CRM";

// Cache of the latest announcements + whether read items are shown.
// Clicking a notification marks it read (persisted per user) so it stays
// gone; the badge counts only unread items.
let lastAnnouncements = [];
let showReadAdmin = false;
// Set by the announcements listener's error callback. Kept separate from the
// list so a failing feed can show WHY while the rest of the page keeps
// rendering (it used to replace the whole list and freeze every badge).
let annError = null;

/** Ids of every admission alert currently in the live pending queue. */
const admissionIds = () =>
  (Array.isArray(window.__pendingAdmissions) ? window.__pendingAdmissions : [])
    .map((r) => `adm_${r.id}`);

/**
 * Visit-to-clear session. Opening the Notifications page acknowledges
 * everything on sight (bell pill, sidebar pill and browser-tab counter all
 * drop to zero — no clicking, no Clear button), BUT the items stay on screen
 * for this visit so each one is still clickable: tapping one navigates to
 * its page (or pops its details) and it is gone afterwards. Leaving the
 * page ends the session — the next visit shows only what arrived since.
 */
const getSession = () => new Set(
  Array.isArray(window.__notifSession) ? window.__notifSession.map(String) : []
);
const inSession = (key) => getSession().has(String(key));

/** Every known notification id across all four sources. */
const allKnownIds = () => {
  const ids = (lastAnnouncements || []).map((a) => `ann_${a.id}`);
  for (const n of systemNotifs()) ids.push(`sys_${n.id}`);
  for (const k of admissionIds()) ids.push(k);
  return ids;
};

/**
 * Acknowledge the whole page at once. Called automatically while the
 * Notifications page is open (see renderAnnouncementList) — never wired to
 * any button. Persists two ways so "gone" survives sign-in and reopen:
 * device-local read-state (announcements, alerts, leads) plus the
 * server-side `read` flag for system notifications (all devices).
 */
window.__ackNotificationsPage = () => {
  try {
    const ids = allKnownIds();
    if (ids.length === 0) return;
    markNotifsRead(ids);
    const s = getSession();
    for (const id of ids) s.add(String(id));
    window.__notifSession = [...s].slice(-150);
  } catch (_) { /* storage blocked — badges just stay until clicked */ }
  // Server flag is best-effort and never blocks the instant local clear.
  // Filtered out of systemNotifs() once read, so the echo from the
  // listener below can never resurrect the badge (no ack loop).
  try {
    const p = markAllNotificationsRead();
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch (_) {}
};

const isNotifPageActive = () => {
  try {
    const el = document.getElementById("page-notifications");
    return !!(el && el.classList.contains("active"));
  } catch (_) {
    return false;
  }
};

/**
 * System notifications (approval decisions, new admission requests) are written
 * to the `notifications` collection by notifyAdmins(), but nothing ever
 * subscribed to that collection — so those events produced no visible message.
 * adminNotificationUI.js pushes the live list here; we render it above the
 * announcements so both share one bell and one list.
 */
const systemNotifs = () => {
  const a = Array.isArray(window.__systemNotifs) ? window.__systemNotifs : [];
  const b = Array.isArray(window.__leadNotifs) ? window.__leadNotifs : [];
  const all = b.length === 0 ? a : [...a, ...b].sort(
    (x, y) => (y.createdAt?.seconds || 0) - (x.createdAt?.seconds || 0)
  );
  // Server-acknowledged items stay gone on every device and every sign-in —
  // the listener keeps delivering them (latest-20 query), so drop them here.
  return all.filter((n) => n && n.read !== true);
};

/** Normalise a Firestore Timestamp / ISO string / {value} into epoch ms. */
const tsMs = (v) => {
  if (v == null) return null;
  if (typeof v.seconds === "number") return v.seconds * 1000;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string") { const t = Date.parse(v); return Number.isNaN(t) ? null : t; }
  if (typeof v.value === "string") { const t = Date.parse(v.value); return Number.isNaN(t) ? null : t; }
  return null;
};

/**
 * Clicking a notification must TAKE YOU THERE (owner: "if an admission alert
 * comes I click on it so it takes me to the Pending approval") and then the
 * item disappears.
 *
 * Each kind maps to the page that actually owns it:
 *   new admission request / admission alert -> Admissions → Pending approval,
 *        with that applicant's Details panel already open,
 *   website enquiry                        -> Visitors,
 *   approved student                       -> Students,
 *   rejected applicant                     -> nothing left to open (the record
 *        is purged); its entry lives in the decision log right here,
 *   announcement                           -> nothing to open; it just clears.
 */
const gotoPage = (page) => {
  if (typeof window.navigate === "function") window.navigate(page);
};

const openPendingApplicant = (id) => {
  gotoPage("admissions");
  // navigate() mounts synchronously, but the admissions page is lazily
  // initialised — give it a frame before driving its tab switcher.
  const run = () => {
    try {
      if (typeof window.switchAdmissionTab === "function") window.switchAdmissionTab("pending");
      if (id && typeof window.viewApplicantDetails === "function") window.viewApplicantDetails(id);
      const view = document.getElementById("view-pending-approval");
      if (view) view.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (_) { /* navigation already succeeded */ }
  };
  requestAnimationFrame(() => setTimeout(run, 60));
};

const routeNotification = (key) => {
  try {
    const n = systemNotifs().find((x) => `sys_${x.id}` === key);
    if (n) {
      const t = n.type || "";
      if (t === "new-lead") return gotoPage("visitors");
      if (t === "new-admission") return openPendingApplicant(n.admissionId || n.studentId || "");
      if (t === "admission-approved") return gotoPage("students");
      if (t === "admission-rejected") return null; // record is gone; log stays here
      return null;
    }
    if (key.indexOf("adm_") === 0) return openPendingApplicant(key.slice(4));
    if (key.indexOf("lead_") === 0) return gotoPage("visitors");
    return null; // announcements and the decision log have no target page
  } catch (_) {
    return null;
  }
};

const renderSystemNotifs = () => {
  const items = systemNotifs();
  // Clicked = read = GONE from the list (the owner's rule: click it and it
  // disappears). Items acknowledged by merely opening the page stay visible
  // for that visit (session) so they can still be tapped through.
  const live = items.filter((n) => !isNotifRead(`sys_${n.id}`) || inSession(`sys_${n.id}`));
  if (live.length === 0) return { html: "", unread: 0 };

  let unread = 0;
  const html =
    `<div style="font-size:11px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--text-muted); padding:0.4rem 0.2rem 0.5rem;">Activity</div>` +
    live.map((n) => {
      const key = `sys_${n.id}`;
      unread++;
      const ms = tsMs(n.createdAt);
      // Never claim "Just now" for a record we couldn't read a date from —
      // that made a page of old entries look like they all just fired.
      const when = ms ? new Date(ms).toLocaleString() : "Date unavailable";
      return `
        <div class="notif-item" data-notif-id="${key}" title="Click to open">
          <div class="notif-icon ${n.type === "new-admission" || n.type === "new-lead" ? "amber" : "green"}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          </div>
          <div class="notif-content" style="flex:1;">
            <div class="notif-title">${n.title || "Notification"}</div>
            <div class="notif-body">${n.body || ""}</div>
            <div class="notif-time">${when}</div>
          </div>
        </div>`;
    }).join("");

  return { html, unread };
};

/**
 * Initializes the announcements UI listener
 */
export const initAnnouncementAdminUI = () => {
  const notifList = document.querySelector("#page-notifications .notif-list");
  if (!notifList) return; // not on a dashboard with notifications

  notifList.innerHTML = `<div style="text-align:center; padding: 2rem;">Loading announcements...</div>`;

  // One delegated click handler: clicking a notification (not its buttons)
  // marks it read so it disappears, THEN takes you to the page that owns it.
  if (!notifList.dataset.wired) {
    notifList.dataset.wired = "1";
    notifList.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      const item = e.target.closest("[data-notif-id]");
      if (!item) return;
      const key = item.dataset.notifId;
      markNotifRead(key);
      // System items also flip the server `read` flag so the tap stays
      // gone on other devices and after re-login. (In-memory lead pings
      // have no server doc — local state is their only home.)
      try {
        if (key.indexOf("sys_") === 0 && key.indexOf("sys_lead_") !== 0) {
          const p = markNotificationRead(key.slice(4));
          if (p && typeof p.catch === "function") p.catch(() => {});
        }
      } catch (_) {}
      // Out of this visit's session too — clicked means gone, immediately,
      // whether it navigates away or just clears in place. No save, no Clear.
      try {
        window.__notifSession = (Array.isArray(window.__notifSession) ? window.__notifSession : [])
          .filter((id) => String(id) !== String(key));
      } catch (_) {}
      renderAnnouncementList();
      routeNotification(key);
    });
  }

  listenToAnnouncements(
    (announcements) => {
      annError = null;
      lastAnnouncements = Array.isArray(announcements) ? announcements : [];
      renderAnnouncementList();
    },
    (error) => {
      lastAnnouncements = [];
      // The announcement feed failing must NOT freeze the page. The other
      // sources (activity, website leads, admission alerts) and every badge
      // still have to render — so record the message and keep going.
      annError = `Announcements could not load (${error?.code || "permission denied"}). ` +
        `Check Firestore rules or the composite index. Everything else below is live.`;
      renderAnnouncementList();
    }
  );
};

const renderAnnouncementList = () => {
  const notifList = document.querySelector("#page-notifications .notif-list");
  if (!notifList) return;

  // Visit-to-clear: while the Notifications page is open, everything on
  // sight is acknowledged at once — bell pill, sidebar pill and tab counter
  // drop to zero with no clicking and no buttons. Items stay on screen for
  // this visit (session) so each can still be tapped through to its page.
  if (isNotifPageActive()) {
    try {
      const ids = allKnownIds();
      if (countUnread(ids) > 0) window.__ackNotificationsPage();
    } catch (_) {}
  }

  const announcements = lastAnnouncements;
  const unreadIds = announcements.map(a => `ann_${a.id}`);
  const unread = countUnread(unreadIds);
  const readCount = announcements.length - unread;

  // Approval decisions / new admission requests written to `notifications`
  // by notifyAdmins().
  const sys = renderSystemNotifs();
  const alertsBlock = typeof window.__renderAdmissionAlerts === "function"
    ? window.__renderAdmissionAlerts()
    : "";
  // Admission alerts are counted by their own read-state, NOT by the raw
  // queue length — that is what made the badge impossible to clear.
  const admissionUnread = countUnread(admissionIds());

  // ── ONE number for every surface. ────────────────────────────────────────
  // Visiting this page acknowledges everything on sight (auto-ack above),
  // and tapping any item clears that item and takes you to its page.
  // No Save, no Clear button, nothing else to press — ever.
  const total = unread + admissionUnread + sys.unread;

  // Sidebar pill (and every other .nav-badge in the shell).
  document.querySelectorAll('.nav-badge').forEach(badge => {
    badge.textContent = total > 9 ? "9+" : String(total);
    badge.style.display = total > 0 ? 'inline-block' : 'none';
  });
  // Topbar bell pill + browser-tab counter — same number, one writer.
  if (typeof window.__paintNotifBadges === "function") {
    window.__paintNotifBadges(total);
  } else if (!window.__admissionBadgesLive) {
    const bellDot = document.getElementById("topbar-notif-dot");
    if (bellDot) bellDot.style.display = total > 0 ? "" : "none";
  }

  // A broken announcements feed is reported ABOVE the list, never instead of
  // it — activity, leads, admission alerts and every badge stay live.
  const errBlock = annError
    ? `<div style="margin:0 0 .8rem; padding:.7rem .9rem; border:1px solid var(--danger); border-radius:9px; background:rgba(244,63,94,.08); color:var(--danger); font-size:12.5px; line-height:1.5;">` +
      `${String(annError).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]))}</div>`
    : "";

  if (announcements.length === 0 && !alertsBlock && !sys.html) {
    notifList.innerHTML = errBlock + `<div style="text-align:center; padding: 2rem; color: var(--text-muted);">No announcements scheduled.</div>`;
    renderDashboardBanner([]);
    return;
  }

  // Read items are hidden — tapping a notification makes it disappear.
  // Items acknowledged by the page visit stay for this visit (session) so
  // they remain tappable; leaving the page ends the session.
  // The toggle below brings read items back deliberately.
  const visible = showReadAdmin
    ? announcements
    : announcements.filter(a => !isNotifRead(`ann_${a.id}`) || inSession(`ann_${a.id}`));
  const toggle = readCount > 0
    ? `<div style="text-align:center; padding:0.5rem;"><button class="btn btn-ghost btn-sm" onclick="window.toggleReadAnnouncements()">${showReadAdmin ? "Hide read" : `Show read (${readCount})`}</button></div>`
    : "";

  if (visible.length === 0 && !alertsBlock && !sys.html) {
    notifList.innerHTML = errBlock + `<div style="text-align:center; padding: 2rem; color: var(--text-muted);">All caught up — no unread announcements.</div>` + toggle;
    return;
  }

    let html = "";
    visible.forEach(a => {
      // Icon depending on type
      let iconHtml = "";
      let iconClass = "";
      if (a.type === "warning") {
        iconClass = "red";
        iconHtml = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
      } else if (a.type === "success") {
        iconClass = "green";
        iconHtml = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
      } else {
        iconClass = "amber";
        iconHtml = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;
      }

      const dateStr = a.createdAt?.seconds
        ? new Date(a.createdAt.seconds * 1000).toLocaleString()
        : "Just now";

      const scheduledStr = a.scheduledFor ? `Scheduled for: ${new Date(a.scheduledFor).toLocaleString()}` : "";
      // Admins see everything (they manage the schedule); future items get a
      // chip so it's obvious they are NOT live for students yet.
      const live = isAnnouncementLive(a);
      const schedChip = !live
        ? `<span style="font-size:10px; font-weight:700; padding:2px 8px; background:rgba(245,158,11,.15); color:var(--accent-amber); border:1px solid rgba(245,158,11,.4); border-radius:999px; margin-left:6px;">⏳ SCHEDULED</span>`
        : "";

      html += `
        <div class="notif-item" data-notif-id="ann_${a.id}" title="Click to dismiss">
          <div class="notif-icon ${iconClass}">${iconHtml}</div>
          <div class="notif-content" style="flex: 1;">
            <div style="display:flex; justify-content:space-between;">
              <div class="notif-title">${a.title}</div>
              <button class="btn btn-ghost" style="padding:2px 5px; color:var(--danger);" onclick="event.stopPropagation(); window.deleteAnnouncementHandler('${a.id}')" data-i18n="btn.delete">${window.t ? window.t("btn.delete") : "Delete"}</button>
            </div>
            <div class="notif-body">${a.message}</div>
            <div class="notif-time">${scheduledStr ? scheduledStr : 'Sent: ' + dateStr} · Audience: ${a.audience}${schedChip}</div>
          </div>
        </div>
      `;
    });
    notifList.innerHTML = errBlock + alertsBlock + sys.html + html + toggle;
  renderDashboardBanner(announcements);
};

// Single entry point for badge/list refresh (called by adminNotificationUI
// when admission alerts change, so two listeners never fight over badges).
window.__refreshNotifBadges = () => { try { renderAnnouncementList(); } catch (_) {} };

/**
 * Dashboard banner shows the latest LIVE announcement, or hides entirely
 * when there is nothing to show (no more hardcoded "Diwali" text).
 */
const renderDashboardBanner = (announcements) => {
  const card = document.getElementById("dashboard-announcement");
  if (!card) return;
  const live = (announcements || []).filter(isAnnouncementLive);
  if (live.length === 0) {
    card.style.display = "none";
    return;
  }
  const latest = live[0];
  // textContent (not innerHTML) so announcement text can never inject markup.
  const titleEl = document.getElementById("dash-ann-title");
  const textEl = document.getElementById("dash-ann-text");
  if (titleEl) titleEl.textContent = latest.title || "Announcement";
  if (textEl) textEl.textContent = latest.message || "";
  card.style.display = "";
};

window.toggleReadAnnouncements = () => {
  showReadAdmin = !showReadAdmin;
  renderAnnouncementList();
};

// Re-render once a minute so ⏳ SCHEDULED chips clear on time without refresh.
if (typeof window !== "undefined" && !window.__adminAnnTimer) {
  window.__adminAnnTimer = setInterval(() => { try { renderAnnouncementList(); } catch (_) {} }, 60000);
}

/**
 * Handles Audience Dropdown Change
 */
window.handleAudienceChange = async () => {
  const audience = document.getElementById("ann-audience").value;
  const group = document.getElementById("ann-specific-students-group");
  const listDiv = document.getElementById("ann-specific-students-list");
  
  if (audience === "Specific Students") {
    group.style.display = "block";
    if (listDiv.children.length === 0) {
      listDiv.innerHTML = `<div style="text-align:center; padding: 10px;">Loading students...</div>`;
      const students = await getAllStudentsForDropdown();
      if (students.length === 0) {
        listDiv.innerHTML = `<div style="color:var(--text-muted); padding:10px;">No active students found.</div>`;
      } else {
        let checkboxesHtml = "";
        students.forEach(s => {
          checkboxesHtml += `
            <div style="display:flex; align-items:center; margin-bottom:8px;">
              <input type="checkbox" id="ann-std-${s.id}" value="${s.id}" class="ann-student-cb" style="margin-right:10px; width:18px; height:18px; cursor:pointer; -webkit-appearance:checkbox; appearance:checkbox;" />
              <label for="ann-std-${s.id}" style="cursor:pointer; display:block; margin:0; line-height:1.2;">${s.name} ${s.phone ? `(${s.phone})` : ''}</label>
            </div>
          `;
        });
        listDiv.innerHTML = checkboxesHtml;
      }
    }
  } else {
    group.style.display = "none";
  }
};

/**
 * Handles the submission of the announcement form
 */
window.submitAnnouncement = async () => {
  const btn = document.getElementById("btn-schedule-announcement");
  if (btn) { btn.disabled = true; btn.textContent = "Scheduling..."; }

  const data = {
    title: document.getElementById("ann-title").value,
    message: document.getElementById("ann-message").value,
    type: document.getElementById("ann-type").value,
    audience: document.getElementById("ann-audience").value,
    scheduledFor: document.getElementById("ann-date").value || null,
    createdBy: localStorage.getItem("userName") || "Admin"
  };

  if (data.audience === "Specific Students") {
    const checkboxes = document.querySelectorAll(".ann-student-cb:checked");
    data.targetStudentIds = Array.from(checkboxes).map(cb => cb.value);
    if (data.targetStudentIds.length === 0) {
      window.showToast(window.t ? window.t('Please select at least one student.') || "Please select at least one student." : "Please select at least one student.", "error");
      if (btn) { btn.disabled = false; btn.textContent = "Schedule"; }
      return;
    }
  }

  const res = await createAnnouncement(data);
  
  if (btn) { btn.disabled = false; btn.textContent = "Schedule"; }

  if (res.success) {
    window.showToast(window.t ? window.t('Announcement scheduled successfully!') || "Announcement scheduled successfully!" : "Announcement scheduled successfully!", "success");
    
    document.getElementById("announcement-modal").close();
    document.getElementById("announcement-form").reset();
  } else {
    window.showToast(window.t ? window.t('Error: ') || "Error: " : "Error: " + res.error, "error");
  }
};

/**
 * Handles deleting an announcement
 */
window.deleteAnnouncementHandler = async (id) => {
  const confirmed = await window.showCustomConfirm("Delete Announcement", "Are you sure you want to delete this announcement?", "Delete", true);
  if (confirmed) {
    const res = await deleteAnnouncement(id);
    if (res.success) {
      window.showToast(window.t ? window.t('Announcement deleted') || "Announcement deleted" : "Announcement deleted", "success");
    } else {
      window.showToast(window.t ? window.t('Error deleting announcement: ') || "Error deleting announcement: " : "Error deleting announcement: " + res.error, "error");
    }
  }
};
