import { testFirebaseConnection } from "./firebase/testConnection.js";
import { initAuthGuard } from "./auth/guard.js";
import { enforceModulePermissions } from "./auth/middleware.js";
import { handleLogout } from "./auth/logout.js";
import { initDashboardListeners } from "./services/dashboardService.js";
import { initMembershipPlans } from "./services/membershipService.js";
import { initAdmissionsUI } from "./services/admissionService.js";
import { initStudentManagementUI } from "./services/studentProfile.js";
import { initAttendanceAdminUI } from "./services/attendanceAdminUI.js";
import { initPaymentAdminUI } from "./services/paymentAdminUI.js";
import { initComplaintAdminUI } from "./services/complaintAdminUI.js";
import { initSeatMapUI } from "./services/seatMapUI.js";
import { initLiveSeatMapUI } from "./services/liveSeatMapUI.js";
import { initExpenseAdminUI } from "./services/expenseAdminUI.js";
import { initVisitorAdminUI } from "./services/visitorAdminUI.js";
import { initMessageLogAdminUI } from "./services/messageLogAdminUI.js";
import { initOldStudentAdminUI } from "./services/oldStudentAdminUI.js";
import { initDashboardReminders } from "./services/dashboardReminderUI.js";
import { initRenewalAdminUI, renderRenewalForm, renderRenewalHistory } from "./services/renewalAdminUI.js";
import { websiteAdminUI } from "./services/websiteAdminUI.js";
import { openReportViewer, closeReportViewer } from "./services/reportAdminUI.js";
import { initAnalyticsUI } from "./services/analyticsService.js";
import { initAnnouncementAdminUI } from "./services/announcementAdminUI.js";
import { initAdminNotificationUI } from "./services/adminNotificationUI.js";
import { initStaffAdminUI } from "./services/staffAdminUI.js";
import { initTasksAdminUI } from "./services/tasksAdminUI.js";
import { initSettingsAdminUI } from "./services/settingsAdminUI.js";
import "./services/translationService.js";
import "./services/whatsappModalUI.js"; // Auto-injects modal styles and functions

// Expose the test function to the global window object
window.runFirebaseTest = testFirebaseConnection;

// Expose logout function globally so it can be called from onclick handlers in the UI
window.logout = handleLogout;

// Expose renewal form logic globally
window.renderRenewalForm = renderRenewalForm;
window.renderRenewalHistory = renderRenewalHistory;

// Expose Report Viewer logic globally
window.openReportViewer = openReportViewer;
window.closeReportViewer = closeReportViewer;

// Expose Document Upload logic globally
import { uploadGlobalDocument, loadGlobalDocuments, loadAllStudentDocuments, downloadBase64File } from "./services/documentUploadService.js";
window.uploadGlobalDocument = uploadGlobalDocument;
window.loadGlobalDocuments = loadGlobalDocuments;
window.loadAllStudentDocuments = loadAllStudentDocuments;
window.downloadBase64File = downloadBase64File;

// Ensure downloadBase64File is available immediately (fallback)
if (typeof window.downloadBase64File !== 'function') {
  window.downloadBase64File = (base64Data, fileName) => {
    try {
      const matches = base64Data.match(/^data:([^;]+);base64,(.+)$/);
      if (!matches) {
        const link = document.createElement('a');
        link.href = base64Data;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return;
      }
      const mimeType = matches[1];
      const base64 = matches[2];
      const byteString = atob(base64);
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }
      const blob = new Blob([ia], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Download failed:", e);
      const link = document.createElement('a');
      link.href = base64Data;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };
}

// Initialize Authentication Guard
initAuthGuard();

import { onAuthStateChanged } from "./services/authService.js";

let __crmInitDone = false;
// Lazy page modules: initialised on FIRST open, not at login. Opening a
// page you never visit used to still cost its Firestore listeners.
const __pageInited = {};
const __pageInitMap = {
  "old-students": () => initOldStudentAdminUI(),
  "attendance": () => initAttendanceAdminUI(),
  "payments": () => { initPaymentAdminUI(); initRenewalAdminUI(); },
  "complaints": () => initComplaintAdminUI(),
  "seats": () => { initSeatMapUI(); initLiveSeatMapUI(); },
  "live-seat-map": () => { initLiveSeatMapUI(); },
  "expenses": () => initExpenseAdminUI(),
  "visitors": () => initVisitorAdminUI(),
  "message-logs": () => initMessageLogAdminUI(),
  "memberships": () => initMembershipPlans(),
  "staff": () => initStaffAdminUI(),
  "tasks": () => initTasksAdminUI(),
  "analytics": () => initAnalyticsUI(),
  "settings": () => initSettingsAdminUI(),
  "website-manager": () => websiteAdminUI.init(),
  // (alias — never used by nav, kept so the key can't be missed again)
  "website": () => websiteAdminUI.init(),
};
const initPageModule = (page) => {
  if (!page || __pageInited[page]) return;
  const fn = __pageInitMap[page];
  if (!fn) return;
  __pageInited[page] = true;
  try {
    fn();
  } catch (e) {
    __pageInited[page] = false;
    console.error(`Page module '${page}' failed to init:`, e);
  }
};
// Role is written asynchronously by auth/guard.js (onAuthStateChanged -> Firestore
// profile read -> localStorage). Counted so a login that never resolves a role
// gives up instead of rescheduling forever.
let __crmInitAttempts = 0;

const initCrmModules = () => {
  if (__crmInitDone) return;

  const role = localStorage.getItem("userRole");
  if (!role) {
    // Re-arm instead of latching. The old code set __crmInitDone = true FIRST and
    // then bailed here, so on a fresh login the guard was still resolving the role
    // when this ran: the latch was burnt and every module below was skipped for
    // the whole session — no bell/badges, and the lazy-page wrapper never installed
    // (so Visitors/Seats/Payments/Attendance/Expenses/Complaints stayed blank).
    if (__crmInitAttempts++ < 80) setTimeout(initCrmModules, 150);
    return;
  }

  __crmInitDone = true;
  // Move all dialogs to body to prevent them from failing to open if their parent page is hidden
  document.querySelectorAll("dialog").forEach((d) => document.body.appendChild(d));

  enforceModulePermissions(role);

  // Admin-only copy: no student portal bootstrap.
  // Block any legacy Student role from loading staff modules.
  if (role === "Student") return;

  // Each init is isolated: one throwing module used to abort the rest of the list,
  // which left the app looking half-alive with no error the user could act on.
  const safe = (label, fn) => {
    try { fn(); } catch (e) { console.error(`[init] ${label} failed:`, e); }
  };

    // Initialize real-time dashboard listeners if we're on the dashboard
    safe("initDashboardListeners", initDashboardListeners);
    // Initialize the new unified Dashboard Reminders
    safe("initDashboardReminders", initDashboardReminders);
    // Admissions flow (Pending queue + bell badge stay live)
    safe("initAdmissionsUI", initAdmissionsUI);
    // Core student table (live)
    safe("initStudentManagementUI", initStudentManagementUI);
    // Announcements + admission-alert bell (live)
    safe("initAnnouncementAdminUI", initAnnouncementAdminUI);
    // Admin admission-alert bell: count pill, tab badge, in-portal alerts
    safe("initAdminNotificationUI", initAdminNotificationUI);

    // Everything else boots on first page open (see __pageInitMap) so login
    // stays fast no matter how much data grows. Wrap navigate() once.
    if (!window.__lazyPagesWired && typeof window.navigate === "function") {
      window.__lazyPagesWired = true;
      const __origNavigate = window.navigate;
      window.navigate = (page, ...rest) => {
        const out = __origNavigate(page, ...rest);
        try { initPageModule(page); } catch (_) {}
        return out;
      };
    }
    // The default page was already shown before this ran — init it now.
    try {
      const active = document.querySelector(".page.active");
      if (active && active.id && active.id.startsWith("page-")) {
        initPageModule(active.id.slice(5));
      }
    } catch (_) {}
};

// Wait for real Firebase Auth (not just localStorage) before attaching
// any Firestore snapshot listeners. Starting them with request.auth == null
// is what caused the flood of permission-denied errors.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    onAuthStateChanged((user) => {
      if (user) initCrmModules();
    });
  });
} else {
  onAuthStateChanged((user) => {
    if (user) initCrmModules();
  });
}

// console.log("Firebase setup complete. Guard active.");
