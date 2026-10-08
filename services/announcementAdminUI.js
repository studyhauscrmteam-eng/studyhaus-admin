import { createAnnouncement, listenToAnnouncements, deleteAnnouncement, getAllStudentsForDropdown, isAnnouncementLive } from "./announcementService.js";
import { isNotifRead, markNotifRead, markAllNotifsRead, countUnread } from "./notificationReadState.js";

// Cache of the latest announcements + whether read items are shown.
// Clicking a notification marks it read (persisted per user) so it stays
// gone; the badge counts only unread items.
let lastAnnouncements = [];
let showReadAdmin = false;

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
  if (b.length === 0) return a;
  return [...a, ...b].sort(
    (x, y) => (y.createdAt?.seconds || 0) - (x.createdAt?.seconds || 0)
  );
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

const renderSystemNotifs = () => {
  const items = systemNotifs();
  if (items.length === 0) return { html: "", unread: 0 };

  let unread = 0;
  const html =
    `<div style="font-size:11px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--text-muted); padding:0.4rem 0.2rem 0.5rem;">Activity</div>` +
    items.map((n) => {
      const key = `sys_${n.id}`;
      const isUnread = !isNotifRead(key);
      if (isUnread) unread++;
      const ms = tsMs(n.createdAt);
      // Never claim "Just now" for a record we couldn't read a date from —
      // that made a page of old entries look like they all just fired.
      const when = ms ? new Date(ms).toLocaleString() : "Date unavailable";
      return `
        <div class="notif-item" data-notif-id="${key}" title="Click to mark as read" style="opacity:${isUnread ? 1 : 0.62};">
          <div class="notif-icon ${n.type === "new-admission" || n.type === "new-lead" ? "amber" : "green"}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          </div>
          <div class="notif-content" style="flex:1;">
            <div class="notif-title">${n.title || "Notification"}${isUnread ? ' <span style="font-size:9px; font-weight:800; background:var(--primary); color:#fff; padding:1px 6px; border-radius:999px; vertical-align:middle;">NEW</span>' : ""}</div>
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
  // marks it read so it disappears; Delete still deletes permanently.
  if (!notifList.dataset.wired) {
    notifList.dataset.wired = "1";
    notifList.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      const item = e.target.closest("[data-notif-id]");
      if (!item) return;
      markNotifRead(item.dataset.notifId);
      renderAnnouncementList();
    });
  }

  listenToAnnouncements(
    (announcements) => {
      lastAnnouncements = Array.isArray(announcements) ? announcements : [];
      renderAnnouncementList();
    },
    (error) => {
      lastAnnouncements = [];
      const list = document.querySelector("#page-notifications .notif-list");
      if (list) {
        list.innerHTML = `<div style="text-align:center; padding:2rem; color:var(--danger);">
          Announcements could not load (${error?.code || "permission denied"}). Check Firestore rules or the composite index.
        </div>`;
      }
    }
  );
};

const renderAnnouncementList = () => {
  const notifList = document.querySelector("#page-notifications .notif-list");
  if (!notifList) return;

  const announcements = lastAnnouncements;
  const unreadIds = announcements.map(a => `ann_${a.id}`);
  const unread = countUnread(unreadIds);
  const readCount = announcements.length - unread;

  // Admission alerts (website form submissions) share the same bell.
  const admissionUnread = window.__admissionUnread || 0;
  // Approval decisions / new admission requests written to `notifications`
  // by notifyAdmins() — these were subscribed by nobody until now.
  const sys = renderSystemNotifs();
  const alertsBlock = typeof window.__renderAdmissionAlerts === "function"
    ? window.__renderAdmissionAlerts()
    : "";

  // ── Auto-clear (owner's choice): opening this page IS the ack. ──────────
  // Every counter drops to zero immediately and every id on screen is written
  // to the read store, so the badge cannot come back after a refresh or a page
  // switch — nothing is left sitting unread.
  const notifPageEl = document.getElementById("page-notifications");
  const onNotifPage = !!(notifPageEl && notifPageEl.getClientRects().length);
  if (onNotifPage) {
    markAllNotifsRead([
      ...unreadIds,
      ...systemNotifs().map((n) => `sys_${n.id}`),
      ...(Array.isArray(window.__leadNotifs) ? window.__leadNotifs : []).map((n) => n.id),
      ...(Array.isArray(window.__pendingAdmissions) ? window.__pendingAdmissions : []).map((r) => `adm_${r.id}`),
    ]);
  }
  const total = onNotifPage ? 0 : unread + admissionUnread + sys.unread;

  // Update badges AND the topbar bell dot with the UNREAD count only.
  // Both start hidden in the template, so zero means zero everywhere.
  document.querySelectorAll('.nav-badge').forEach(badge => {
    badge.textContent = total > 9 ? "9+" : String(total);
    badge.style.display = total > 0 ? 'inline-block' : 'none';
  });
  // The bell pill itself is painted by adminNotificationUI (count bubble);
  // only fall back to the plain dot when that module hasn't run.
  if (!window.__admissionBadgesLive) {
    const bellDot = document.getElementById("topbar-notif-dot");
    if (bellDot) bellDot.style.display = total > 0 ? "" : "none";
  }
  // Reading this page clears the tab counter too.
  if (onNotifPage && document.title.indexOf(BASE_TITLE) !== -1) document.title = BASE_TITLE;

  if (announcements.length === 0 && !alertsBlock && !sys.html) {
    notifList.innerHTML = `<div style="text-align:center; padding: 2rem; color: var(--text-muted);">No announcements scheduled.</div>`;
    renderDashboardBanner([]);
    return;
  }

  // On the Notifications page everything is already acknowledged, so the list
  // must keep showing its items (they are read, not deleted) and the
  // hide-read toggle would be pure noise.
  const visible = (showReadAdmin || onNotifPage)
    ? announcements
    : announcements.filter(a => !isNotifRead(`ann_${a.id}`));
  const toggle = (readCount > 0 && !onNotifPage)
    ? `<div style="text-align:center; padding:0.5rem;"><button class="btn btn-ghost btn-sm" onclick="window.toggleReadAnnouncements()">${showReadAdmin ? "Hide read" : `Show read (${readCount})`}</button></div>`
    : "";

  if (visible.length === 0 && !alertsBlock && !sys.html) {
    notifList.innerHTML = `<div style="text-align:center; padding: 2rem; color: var(--text-muted);">All caught up — no unread announcements.</div>` + toggle;
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
        <div class="notif-item" data-notif-id="ann_${a.id}" title="Click to mark as read">
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
    notifList.innerHTML = alertsBlock + sys.html + html + toggle;
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
