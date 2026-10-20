import { createAnnouncement, listenToAnnouncements, deleteAnnouncement, getAllStudentsForDropdown, isAnnouncementLive } from "./announcementService.js";
import { discardNotification, discardAllNotifications } from "./notificationService.js";

const BASE_TITLE = document.title || "Studyhaus — Reading Space CRM";
let lastAnnouncements = [];
let annError = null;
let currentNotifTab = "alerts"; // 'alerts' | 'broadcasts'

const esc = (v) =>
  String(v == null ? "" : v).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));

/** Normalise a Firestore Timestamp / ISO string / {value} into epoch ms. */
const tsMs = (v) => {
  if (v == null) return null;
  if (typeof v.seconds === "number") return v.seconds * 1000;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string") { const t = Date.parse(v); return Number.isNaN(t) ? null : t; }
  if (typeof v.value === "string") { const t = Date.parse(v.value); return Number.isNaN(t) ? null : t; }
  return null;
};

const gotoPage = (page) => {
  if (typeof window.navigate === "function") window.navigate(page);
};

const openPendingApplicant = (id) => {
  gotoPage("admissions");
  const run = () => {
    try {
      if (typeof window.switchAdmissionTab === "function") window.switchAdmissionTab("pending");
      if (id && typeof window.viewApplicantDetails === "function") window.viewApplicantDetails(id);
      const view = document.getElementById("view-pending-approval");
      if (view) view.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (_) {}
  };
  requestAnimationFrame(() => setTimeout(run, 60));
};

/** System notifications loaded from Firestore collection `notifications` */
const systemNotifs = () => {
  const sys = Array.isArray(window.__systemNotifs) ? window.__systemNotifs : [];
  return [...sys]
    .filter((n) => n && n.read !== true && n.discarded !== true)
    .sort((x, y) => (tsMs(y.createdAt) || 0) - (tsMs(x.createdAt) || 0));
};

const routeNotification = (key, item) => {
  try {
    const all = systemNotifs();
    const cleanId = key.startsWith("sys_") ? key.slice(4) : key;
    const n = item || all.find((x) => x.id === cleanId || `sys_${x.id}` === key || x.id === key);
    if (n) {
      const t = n.type || "";
      if (t === "new-lead") return gotoPage("visitors");
      if (t === "new-admission") return openPendingApplicant(n.admissionId || n.studentId || "");
      if (t === "admission-approved") return gotoPage("students");
      if (t === "admission-rejected") return null;
      if (t === "complaint") return gotoPage("complaints");
      return null;
    }
    if (key.indexOf("adm_") === 0) return openPendingApplicant(key.slice(4));
    if (key.indexOf("lead_") === 0) return gotoPage("visitors");
    if (key.indexOf("comp_") === 0) return gotoPage("complaints");
    return null;
  } catch (_) {
    return null;
  }
};

window.switchNotifTab = (tab) => {
  currentNotifTab = tab;
  renderAnnouncementList();
};

const renderSystemNotifs = () => {
  const unreadItems = systemNotifs();
  if (unreadItems.length === 0) {
    return {
      html: `
        <div style="text-align:center; padding:4rem 1.5rem; color:var(--text-muted);">
          <div style="width:44px; height:44px; border-radius:50%; background:var(--bg-hover, #f1f5f9); border:1px solid var(--border, #e2e8f0); display:inline-flex; align-items:center; justify-content:center; margin-bottom:0.85rem; color:var(--text-muted);">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="20" height="20">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              <line x1="2" y1="2" x2="22" y2="22"/>
            </svg>
          </div>
          <div style="font-weight:600; font-size:14px; color:var(--text-primary); margin-bottom:4px;">No unread notifications</div>
          <div style="font-size:12.5px; color:var(--text-muted); max-width:320px; margin:0 auto; line-height:1.45;">
            When new activity occurs, alerts will appear here. Clicking an alert navigates to the page and marks it done.
          </div>
        </div>`,
      unread: 0
    };
  }

  const header = `
    <div style="display:flex; justify-content:space-between; align-items:center; padding:0.2rem 0.2rem 0.75rem; margin-bottom:0.25rem;">
      <div style="font-size:11.5px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; color:var(--text-muted);">
        Active Alerts (${unreadItems.length})
      </div>
      <button class="btn btn-ghost btn-sm" onclick="window.handleMarkAllNotifsRead()" style="font-size:11.5px; padding:3px 10px; color:var(--primary); font-weight:600; border-radius:6px; display:inline-flex; align-items:center; gap:4px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polyline points="20 6 9 17 4 12"/></svg>
        Clear all
      </button>
    </div>`;

  const cards = unreadItems.map((n) => {
    const key = `sys_${n.id}`;
    const ms = tsMs(n.createdAt);
    const when = ms ? new Date(ms).toLocaleString() : "Just now";
    const isComplaint = n.type === "complaint";
    const isLead = n.type === "new-lead";
    const isAdmission = n.type === "new-admission";

    let iconSvg = "";
    let iconClass = "amber";
    let tagLabel = "Alert";
    let tagBg = "rgba(245,158,11,0.12)";
    let tagColor = "var(--accent-amber, #d97706)";

    if (isComplaint) {
      iconClass = "red";
      tagLabel = "Complaint";
      tagBg = "rgba(239,68,68,0.12)";
      tagColor = "var(--danger, #ef4444)";
      iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
    } else if (isLead) {
      iconClass = "blue";
      tagLabel = "Website Lead";
      tagBg = "rgba(59,130,246,0.12)";
      tagColor = "#2563eb";
      iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
    } else if (isAdmission) {
      iconClass = "amber";
      tagLabel = "Admission";
      tagBg = "rgba(245,158,11,0.12)";
      tagColor = "var(--accent-amber, #d97706)";
      iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>`;
    } else if (n.type === "admission-approved") {
      iconClass = "green";
      tagLabel = "Approved";
      tagBg = "rgba(16,185,129,0.12)";
      tagColor = "var(--success, #10b981)";
      iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
    } else {
      iconClass = "amber";
      iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;
    }

    return `
      <div class="notif-item unread" data-notif-id="${key}" title="Click to view & discard" style="
        cursor:pointer; display:flex; align-items:flex-start; justify-content:space-between; gap:0.85rem;
        padding:0.9rem 1rem; margin-bottom:0.5rem; border:1px solid var(--border, #e2e8f0);
        border-radius:8px; background:var(--card-bg, #ffffff); transition:background 0.15s, border-color 0.15s;
      ">
        <div style="display:flex; gap:0.85rem; flex:1; align-items:flex-start; min-width:0;">
          <div class="notif-icon ${iconClass}" style="flex-shrink:0; margin-top:1px; width:32px; height:32px; border-radius:7px;">
            ${iconSvg}
          </div>
          <div class="notif-content" style="flex:1; min-width:0;">
            <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap; margin-bottom:3px;">
              <span style="font-size:13px; font-weight:600; ${isComplaint ? 'color:var(--danger, #ef4444);' : 'color:var(--text-primary);'}">
                ${esc(n.title || "Notification")}
              </span>
              <span style="font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:0.03em; padding:1px 6px; border-radius:4px; background:${tagBg}; color:${tagColor};">
                ${tagLabel}
              </span>
            </div>
            <div class="notif-body" style="font-size:12.5px; color:var(--text-secondary); line-height:1.45; word-break:break-word;">
              ${esc(n.body || "")}
            </div>
            <div class="notif-time" style="font-size:11px; color:var(--text-muted); margin-top:4px;">
              ${when}
            </div>
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation(); window.handleDiscardNotification('${n.id}', event)" title="Dismiss alert" style="
          padding:4px 8px; font-size:11.5px; color:var(--text-muted); flex-shrink:0; border-radius:6px; display:inline-flex; align-items:center; gap:3px;
        ">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          Dismiss
        </button>
      </div>`;
  }).join("");

  return { html: header + cards, unread: unreadItems.length };
};

/**
 * Discard a single notification immediately without saving
 */
window.handleDiscardNotification = async (docId, event) => {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }
  const cleanId = docId.startsWith("sys_") ? docId.slice(4) : docId;

  if (Array.isArray(window.__systemNotifs)) {
    window.__systemNotifs = window.__systemNotifs.filter(x => x.id !== cleanId && x.id !== docId);
  }
  renderAnnouncementList();

  if (cleanId) {
    discardNotification(cleanId).catch(() => {});
  }
};

/**
 * Global helper to mark all Firestore notifications read/discarded permanently
 */
window.handleMarkAllNotifsRead = async () => {
  try {
    window.__systemNotifs = [];
    renderAnnouncementList();
    await discardAllNotifications();
    if (typeof window.showToast === "function") {
      window.showToast("All notifications cleared", "success");
    }
  } catch (e) {
    console.error("[notifications] mark all read failed:", e);
  }
};

/**
 * Initializes the announcements UI listener
 */
export const initAnnouncementAdminUI = () => {
  const notifList = document.querySelector("#page-notifications .notif-list");
  if (!notifList) return; // not on a dashboard with notifications

  notifList.innerHTML = `<div style="text-align:center; padding: 2rem;">Loading notifications...</div>`;

  // Delegated click handler: clicking a notification card takes action & discards it immediately
  if (!notifList.dataset.wired) {
    notifList.dataset.wired = "1";
    notifList.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      const item = e.target.closest("[data-notif-id]");
      if (!item) return;
      const key = item.dataset.notifId;
      if (!key || key.startsWith("ann_")) return; // broadcast announcements do not route or discard on click

      const cleanId = key.startsWith("sys_") ? key.slice(4) : key;
      const all = systemNotifs();
      const notifObj = all.find(x => x.id === cleanId || `sys_${x.id}` === key || x.id === key);

      // Discard immediately from memory & UI before navigating
      if (Array.isArray(window.__systemNotifs)) {
        window.__systemNotifs = window.__systemNotifs.filter(x => x.id !== cleanId && `sys_${x.id}` !== key);
      }

      // Discard from Firestore
      if (cleanId) {
        discardNotification(cleanId).catch(() => {});
      }

      renderAnnouncementList();
      routeNotification(key, notifObj);
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
      annError = `Announcements could not load (${error?.code || "permission denied"}). ` +
        `Check Firestore rules or the composite index. Everything else below is live.`;
      renderAnnouncementList();
    }
  );
};

const renderAnnouncementList = () => {
  const notifList = document.querySelector("#page-notifications .notif-list");
  if (!notifList) return;

  const announcements = lastAnnouncements;
  const sys = renderSystemNotifs();

  const isNotifActive = document.getElementById("page-notifications")?.classList.contains("active");
  const isComplaintsActive = document.getElementById("page-complaints")?.classList.contains("active");

  if (isNotifActive) window.__notificationsSeen = true;
  if (isComplaintsActive) window.__complaintsSeen = true;

  // Real-time unread actionable notifications
  const total = isNotifActive ? 0 : sys.unread;

  // Update notifications nav badges
  document.querySelectorAll('[data-page="notifications"] .nav-badge, .nav-badge:not(.complaints-nav-badge)').forEach(badge => {
    badge.textContent = total > 9 ? "9+" : String(total);
    badge.style.display = total > 0 ? 'inline-block' : 'none';
  });

  // Topbar bell pill + browser tab title
  if (typeof window.__paintNotifBadges === "function") {
    window.__paintNotifBadges(total);
  } else if (!window.__admissionBadgesLive) {
    const bellDot = document.getElementById("topbar-notif-dot");
    if (bellDot) bellDot.style.display = total > 0 ? "" : "none";
  }

  const errBlock = annError
    ? `<div style="margin:0 0 .8rem; padding:.7rem .9rem; border:1px solid var(--danger); border-radius:9px; background:rgba(244,63,94,.08); color:var(--danger); font-size:12.5px; line-height:1.5;">` +
      `${esc(annError)}</div>`
    : "";

  const unreadCount = sys.unread;
  const annCount = announcements.length;

  // Sleek Segmented Switcher: Alerts vs Broadcast Announcements (No Emojis, Crisp SVGs)
  const tabsHtml = `
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:1.25rem; border-bottom:1px solid var(--border, #e2e8f0); padding-bottom:0.85rem; flex-wrap:wrap; gap:0.75rem;">
      <div style="display:inline-flex; background:var(--bg-hover, #f1f5f9); padding:3px; border-radius:8px; gap:2px; border:1px solid var(--border, #e2e8f0);">
        <button type="button" onclick="window.switchNotifTab('alerts')" style="
          display:inline-flex; align-items:center; gap:6px; padding:6px 14px; font-size:12.5px; font-weight:${currentNotifTab === 'alerts' ? '600' : '500'};
          border:none; border-radius:6px; cursor:pointer; transition:all 0.15s ease; font-family:inherit;
          background:${currentNotifTab === 'alerts' ? 'var(--card-bg, #ffffff)' : 'transparent'};
          color:${currentNotifTab === 'alerts' ? 'var(--text-primary, #0f172a)' : 'var(--text-secondary, #64748b)'};
          ${currentNotifTab === 'alerts' ? 'box-shadow:0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);' : ''}
        ">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="flex-shrink:0;">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          <span>Alerts</span>
          ${unreadCount > 0 ? `
            <span style="font-size:10px; font-weight:700; padding:1px 6px; border-radius:999px; line-height:1.3; background:var(--danger, #ef4444); color:#ffffff;">
              ${unreadCount}
            </span>
          ` : ''}
        </button>
        <button type="button" onclick="window.switchNotifTab('broadcasts')" style="
          display:inline-flex; align-items:center; gap:6px; padding:6px 14px; font-size:12.5px; font-weight:${currentNotifTab === 'broadcasts' ? '600' : '500'};
          border:none; border-radius:6px; cursor:pointer; transition:all 0.15s ease; font-family:inherit;
          background:${currentNotifTab === 'broadcasts' ? 'var(--card-bg, #ffffff)' : 'transparent'};
          color:${currentNotifTab === 'broadcasts' ? 'var(--text-primary, #0f172a)' : 'var(--text-secondary, #64748b)'};
          ${currentNotifTab === 'broadcasts' ? 'box-shadow:0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);' : ''}
        ">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="flex-shrink:0;">
            <path d="M11 5L6 9H2v6h4l5 4V5z"/>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
          </svg>
          <span>Broadcast Announcements</span>
          ${annCount > 0 ? `
            <span style="font-size:10px; font-weight:600; padding:1px 6px; border-radius:999px; line-height:1.3; background:rgba(100,116,139,0.18); color:var(--text-secondary, #475569);">
              ${annCount}
            </span>
          ` : ''}
        </button>
      </div>
    </div>`;

  let contentHtml = "";

  if (currentNotifTab === "alerts") {
    // Only real actionable notifications are displayed here!
    contentHtml = sys.html;
  } else {
    // Broadcast Announcements tab
    if (announcements.length === 0) {
      contentHtml = `
        <div style="text-align:center; padding:3.5rem 1.5rem; color:var(--text-muted);">
          <div style="width:44px; height:44px; border-radius:50%; background:var(--bg-hover, #f1f5f9); border:1px solid var(--border, #e2e8f0); display:inline-flex; align-items:center; justify-content:center; margin-bottom:0.85rem; color:var(--text-muted);">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="20" height="20">
              <path d="M11 5L6 9H2v6h4l5 4V5z"/>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
            </svg>
          </div>
          <div style="font-weight:600; font-size:14px; color:var(--text-primary); margin-bottom:4px;">No broadcast announcements</div>
          <div style="font-size:12.5px; color:var(--text-muted); max-width:320px; margin:0 auto; line-height:1.45;">
            Use "+ Schedule Announcement" to post notices to students.
          </div>
        </div>`;
    } else {
      contentHtml = `
        <div style="font-size:11.5px; font-weight:700; letter-spacing:.05em; color:var(--text-muted); padding:0.2rem 0.2rem 0.75rem; text-transform:uppercase;">
          Broadcast Announcements (${announcements.length})
        </div>` + announcements.map(a => {
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
            : "Date unavailable";

          const scheduledStr = a.scheduledFor ? `Scheduled for: ${new Date(a.scheduledFor).toLocaleString()}` : "";
          const live = isAnnouncementLive(a);
          const schedChip = !live
            ? `<span style="font-size:10px; font-weight:600; padding:2px 7px; background:rgba(245,158,11,.12); color:var(--accent-amber); border:1px solid rgba(245,158,11,.3); border-radius:999px; margin-left:6px; display:inline-flex; align-items:center; gap:4px; vertical-align:middle;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="10" height="10"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>SCHEDULED</span>`
            : "";

          return `
            <div class="notif-item" data-notif-id="ann_${a.id}" style="border:1px solid var(--border, #e2e8f0); border-radius:8px; background:var(--card-bg, #ffffff); padding:0.9rem 1rem; margin-bottom:0.5rem;">
              <div class="notif-icon ${iconClass}" style="width:32px; height:32px; border-radius:7px;">${iconHtml}</div>
              <div class="notif-content" style="flex: 1; min-width:0;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:0.5rem;">
                  <div class="notif-title" style="font-size:13px; font-weight:600;">${esc(a.title)}</div>
                  <button class="btn btn-ghost" style="padding:2px 8px; color:var(--danger); font-size:11.5px; border-radius:5px;" onclick="event.stopPropagation(); window.deleteAnnouncementHandler('${a.id}')" data-i18n="btn.delete">Delete</button>
                </div>
                <div class="notif-body" style="font-size:12.5px; color:var(--text-secondary); line-height:1.45; word-break:break-word; margin-top:2px;">${esc(a.message)}</div>
                <div class="notif-time" style="font-size:11px; color:var(--text-muted); margin-top:4px;">${scheduledStr ? scheduledStr : 'Sent: ' + dateStr} · Audience: ${esc(a.audience)}${schedChip}</div>
              </div>
            </div>
          `;
        }).join("");
    }
  }

  notifList.innerHTML = errBlock + tabsHtml + contentHtml;
  renderDashboardBanner(announcements);
};

// Single entry point for badge/list refresh
window.__refreshNotifBadges = () => { try { renderAnnouncementList(); } catch (_) {} };

/**
 * Dashboard banner shows the latest LIVE announcement, or hides entirely when none.
 */
const renderDashboardBanner = (announcements) => {
  const card = document.getElementById("dashboard-announcement");
  if (!card) return;
  const live = (announcements || []).filter(a => isAnnouncementLive(a));
  if (live.length === 0) {
    card.style.display = "none";
    return;
  }
  const latest = live[0];
  const titleEl = document.getElementById("dash-ann-title");
  const textEl = document.getElementById("dash-ann-text");
  if (titleEl) titleEl.textContent = latest.title || "Announcement";
  if (textEl) textEl.textContent = latest.message || "";
  card.style.display = "";
};

// Re-render once a minute so scheduled announcements chips update on time
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
              <label for="ann-std-${s.id}" style="cursor:pointer; display:block; margin:0; line-height:1.2;">${esc(s.name)} ${s.phone ? `(${esc(s.phone)})` : ''}</label>
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
