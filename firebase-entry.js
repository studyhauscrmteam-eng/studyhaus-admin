import { testFirebaseConnection } from "./firebase/testConnection.js";
import { initAuthGuard } from "./auth/guard.js";
import { enforceModulePermissions } from "./auth/middleware.js";
import { handleLogout } from "./auth/logout.js";
import { initDashboardListeners } from "./services/dashboardService.js";
import { initMembershipPlans } from "./services/membershipService.js";
import { initAdmissionsUI } from "./services/admissionService.js?v=ui1";
import { initStudentManagementUI } from "./services/studentProfile.js?v=ui2";
import { initAttendanceAdminUI } from "./services/attendanceAdminUI.js?v=seat1";
import { initPaymentAdminUI } from "./services/paymentAdminUI.js";
import { initComplaintAdminUI } from "./services/complaintAdminUI.js?v=ui2";
import { initSeatMapUI } from "./services/seatMapUI.js?v=ui1";
import { initLiveSeatMapUI } from "./services/liveSeatMapUI.js?v=play3";
import { initExpenseAdminUI } from "./services/expenseAdminUI.js";
import { initVisitorAdminUI } from "./services/visitorAdminUI.js";
import { initMessageLogAdminUI } from "./services/messageLogAdminUI.js";
import { initOldStudentAdminUI } from "./services/oldStudentAdminUI.js?v=ui2";
import { initDashboardReminders } from "./services/dashboardReminderUI.js";
import { initRenewalAdminUI, renderRenewalForm, renderRenewalHistory } from "./services/renewalAdminUI.js";
import { websiteAdminUI } from "./services/websiteAdminUI.js";
import { openReportViewer, closeReportViewer } from "./services/reportAdminUI.js";
import { initAnalyticsUI } from "./services/analyticsService.js";
import { initAnnouncementAdminUI } from "./services/announcementAdminUI.js";
import { initAdminNotificationUI } from "./services/adminNotificationUI.js";
import { initStaffAdminUI } from "./services/staffAdminUI.js";
import { initTasksAdminUI } from "./services/tasksAdminUI.js";
import { initSettingsAdminUI } from "./services/settingsAdminUI.js?v=ui1";
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
import { uploadGlobalDocument, loadGlobalDocuments, downloadBase64File } from "./services/documentUploadService.js";
window.uploadGlobalDocument = uploadGlobalDocument;
window.loadGlobalDocuments = loadGlobalDocuments;
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
const initCrmModules = () => {
  if (__crmInitDone) return;
  __crmInitDone = true;
  // Move all dialogs to body to prevent them from failing to open if their parent page is hidden
  document.querySelectorAll("dialog").forEach((d) => document.body.appendChild(d));

  const role = localStorage.getItem("userRole");
  if (!role) return;
  enforceModulePermissions(role);

  // Admin-only copy: no student portal bootstrap.
  // Block any legacy Student role from loading staff modules.
  if (role === "Student") return;

    // Initialize real-time dashboard listeners if we're on the dashboard
    initDashboardListeners();
    // Initialize the new unified Dashboard Reminders
    initDashboardReminders();
    // Admissions flow (Pending queue + bell badge stay live)
    initAdmissionsUI();
    // Core student table (live)
    initStudentManagementUI();
    // Announcements + admission-alert bell (live)
    initAnnouncementAdminUI();
    // Admin admission-alert bell: count pill, tab badge, in-portal alerts
    initAdminNotificationUI();

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
