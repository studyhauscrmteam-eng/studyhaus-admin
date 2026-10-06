import { listenToAllStudents } from "./studentService.js";
import { listenToPendingPayments } from "./paymentService.js";
import { listenToReminderOverrides, markReminderCompleted, rescheduleReminder } from "./reminderService.js";
import { generateReminders } from "./reminderEngine.js";

let allStudents = [];
let pendingPayments = [];
let allOverrides = {};
let currentRole = "Employee";

export const initDashboardReminders = () => {
  currentRole = localStorage.getItem("userRole");
  if (currentRole === "Student") return;

  const currentContainer = document.getElementById("current-reminders-list");
  const oldContainer = document.getElementById("old-reminders-list");
  if (!currentContainer || !oldContainer) return;

  // Render placeholders initially
  currentContainer.innerHTML = `<div style="padding:1rem; text-align:center; color:var(--text-muted);">Loading...</div>`;
  oldContainer.innerHTML = `<div style="padding:1rem; text-align:center; color:var(--text-muted);">Loading...</div>`;

  // Define actions globally for inline onclick handlers
  window.handleCompleteReminder = async (studentId, type) => {
    const confirmed = await window.showCustomConfirm("Complete Reminder", `Mark this ${type} reminder as completed?`);
    if (confirmed) {
      await markReminderCompleted(studentId, type);
    }
  };

  window.handleRescheduleReminder = async (studentId, type) => {
    const newDate = await window.showCustomPrompt("Reschedule", `Enter new date for ${type} reminder (YYYY-MM-DD):`, "Reschedule");
    if (newDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
        return window.showToast("Invalid format. Please use YYYY-MM-DD.", "warning");
      }
      await rescheduleReminder(studentId, type, newDate);
    }
  };

  // Start combined listeners
  listenToAllStudents(students => {
    allStudents = students;
    triggerRender();
  });

  listenToPendingPayments(data => {
    pendingPayments = data.pendingList;
    triggerRender();
  });

  listenToReminderOverrides(overrides => {
    allOverrides = overrides;
    triggerRender();
  });
};

const triggerRender = () => {
  const { currentReminders, oldReminders } = generateReminders(allStudents, pendingPayments, allOverrides);
  renderCurrentReminders(currentReminders);
  renderOldReminders(oldReminders);
};

const formatDaysRemaining = (days) => {
  if (days < 0) return "Overdue";
  if (days === 0) return "Today";
  return `In ${days} Days`;
};

const renderCurrentReminders = (reminders) => {
  const container = document.getElementById("current-reminders-list");
  if (!container) return;

  // Filter based on search/dropdown if needed, assuming no UI for that on small widget, but we can add if needed.
  if (reminders.length === 0) {
    container.innerHTML = `<div style="padding:2rem; text-align:center; color:var(--text-muted);">No current reminders.</div>`;
    return;
  }

  let html = "";
  const canUpdate = (currentRole === "Owner/Admin" || currentRole === "Manager");

  reminders.forEach(r => {
    const initials = r.name ? r.name.substring(0, 2).toUpperCase() : "??";
    html += `
      <div class="attendance-item" style="align-items: center; border-bottom: 1px solid var(--border); padding: 0.75rem 0;">
        <div class="avatar-sm" style="background:#9ca3af; min-width:32px;">${initials}</div>
        <div class="att-info" style="flex:1;">
          <div class="att-name">${r.name}</div>
          <div class="att-time">${r.type} · Seat: ${r.seatNumber || "N/A"}</div>
        </div>
        <div style="text-align:right; margin-right: 1rem;">
          <span class="badge ${r.badgeClass}">${formatDaysRemaining(r.daysRemaining)}</span>
          <div style="font-size: 0.75rem; color: var(--text-muted); margin-top:0.25rem;">${r.dueDateStr}</div>
        </div>
        
        <div style="display:flex; gap:0.25rem;">
          <button class="icon-btn-sm" title="WhatsApp" onclick="window.triggerWhatsAppModal('${r.studentId}')" style="color:#25D366; background:transparent;">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
          ${canUpdate ? `
          <button class="icon-btn-sm" title="Mark Completed" onclick="window.handleCompleteReminder('${r.studentId}', '${r.type}')" style="color:var(--success); background:transparent;">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
          </button>
          <button class="icon-btn-sm" title="Reschedule" onclick="window.handleRescheduleReminder('${r.studentId}', '${r.type}')" style="color:var(--primary); background:transparent;">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </button>
          ` : ""}
        </div>
      </div>
    `;
  });
  container.innerHTML = html;
};

const renderOldReminders = (reminders) => {
  const container = document.getElementById("old-reminders-list");
  if (!container) return;

  if (reminders.length === 0) {
    container.innerHTML = `<div style="padding:2rem; text-align:center; color:var(--text-muted);">No follow-ups due.</div>`;
    return;
  }

  let html = "";
  const canUpdate = (currentRole === "Owner/Admin" || currentRole === "Manager");

  reminders.forEach(r => {
    const initials = r.name ? r.name.substring(0, 2).toUpperCase() : "??";
    html += `
      <div class="attendance-item" style="align-items: center; border-bottom: 1px solid var(--border); padding: 0.75rem 0;">
        <div class="avatar-sm" style="background:#9ca3af; min-width:32px;">${initials}</div>
        <div class="att-info" style="flex:1;">
          <div class="att-name">${r.name}</div>
          <div class="att-time">Left: ${r.exitDate || "N/A"} · Reason: ${r.exitReason || "Other"}</div>
        </div>
        <div style="text-align:right; margin-right: 1rem;">
          <span class="badge ${r.badgeClass}">${formatDaysRemaining(r.daysRemaining)}</span>
          <div style="font-size: 0.75rem; color: var(--text-muted); margin-top:0.25rem;">${r.dueDateStr}</div>
        </div>
        
        <div style="display:flex; gap:0.25rem;">
          <button class="icon-btn-sm" title="WhatsApp" onclick="window.triggerWhatsAppModal('${r.studentId}')" style="color:#25D366; background:transparent;">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
          ${canUpdate ? `
          <button class="icon-btn-sm" title="Mark Completed" onclick="window.handleCompleteReminder('${r.studentId}', '${r.type}')" style="color:var(--success); background:transparent;">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
          </button>
          <button class="icon-btn-sm" title="Reschedule" onclick="window.handleRescheduleReminder('${r.studentId}', '${r.type}')" style="color:var(--primary); background:transparent;">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </button>
          ` : ""}
        </div>
      </div>
    `;
  });
  container.innerHTML = html;
};
