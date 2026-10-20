import { processRenewal, listenToRenewalHistory } from "./renewalService.js";
import { fetchPlansForDropdown } from "./admissionService.js";
import { listenToMyPayments } from "./paymentService.js";
import { db } from "../firebase/firebase.js";
import { collection, addDoc, setDoc, deleteDoc, getDocs, query, where, doc, getDoc, serverTimestamp } from "firebase/firestore";

let availablePlans = [];

/**
 * Initializes the renewal system (called from firebase-entry)
 */
export const initRenewalAdminUI = async () => {
  availablePlans = await fetchPlansForDropdown();
};

/**
 * Renders the renewal form inside a container
 */
/**
 * Helper to format date into "15 Oct 2026"
 */
const fmtDispDate = (dateStr) => {
  if (!dateStr) return "—";
  const [y, m, d] = String(dateStr).split("T")[0].split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

/**
 * Add days to a YYYY-MM-DD date string (inclusive-safe)
 */
const addDaysToStr = (dateStr, days) => {
  if (!dateStr) return "";
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + Number(days));
  return d.toISOString().split("T")[0];
};

/**
 * Renders the renewal form inside a container
 */
export const renderRenewalForm = async (student, containerId, userRole) => {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!availablePlans || availablePlans.length === 0) {
    try {
      availablePlans = await fetchPlansForDropdown();
    } catch (_) {}
  }

  const canEditAmount = (userRole === "Owner/Admin" || userRole === "Manager");
  
  // Previous subscription dates
  const lastStart = student.startDate || "";
  const lastEnd = student.endDate || student.paymentDueDate || "";
  const hasLastSub = !!(lastStart || lastEnd);
  const lastSubStr = hasLastSub 
    ? `${fmtDispDate(lastStart)} — ${fmtDispDate(lastEnd)}` 
    : "No previous subscription found";

  // Calculate default Start Date:
  // If student has an existing end date / due date, start the day AFTER it.
  // If overdue by more than 30 days or no date exists, start today.
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  let defaultStartStr = todayStr;
  
  if (lastEnd) {
    const lastEndDate = new Date(`${lastEnd}T00:00:00`);
    if (!isNaN(lastEndDate.getTime())) {
      lastEndDate.setDate(lastEndDate.getDate() + 1);
      const diffDays = Math.round((lastEndDate - today) / (1000 * 60 * 60 * 24));
      if (diffDays >= -30) {
        defaultStartStr = lastEndDate.toISOString().split("T")[0];
      }
    }
  }

  // 1 month = 30 days. Oct 15 -> Nov 13 inclusive = 30 days (15 Oct + 29 days)
  const defaultEndStr = addDaysToStr(defaultStartStr, 29);

  let planOptions = `<option value="">Select Plan...</option>`;
  availablePlans.forEach(p => {
    const selected = (p.id === student.planId || (!student.planId && p.planName?.toLowerCase().includes("month"))) ? "selected" : "";
    planOptions += `<option value="${p.id}" data-price="${p.price}" ${selected}>${p.planName} (₹${p.price})</option>`;
  });

  const photoUrl = student.photoUrl || student.selfieUrl || student.photo || "";
  const initials = (student.name || "S").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const seatVal = student.seatNumber || student.seatAssigned || "";
  const seatFloorVal = student.seatFloor || student.floor || (seatVal ? "Ground Floor" : "");
  const seatDisplay = seatVal ? `${seatVal} (${seatFloorVal})` : "None";

  container.innerHTML = `
    <style>
      .rn-wrap { font-family: inherit; color: var(--text-primary); }
      .rn-student-card {
        display: flex; align-items: center; gap: 14px;
        background: var(--bg-hover); border: 1px solid var(--border);
        border-radius: 12px; padding: 12px 16px; margin-bottom: 14px;
      }
      .rn-avatar {
        width: 48px; height: 48px; border-radius: 10px; overflow: hidden;
        background: var(--bg-card); border: 1px solid var(--border);
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0; font-weight: 700; color: var(--primary);
      }
      .rn-avatar img { width: 100%; height: 100%; object-fit: cover; }
      .rn-student-info h3 { margin: 0 0 2px 0; font-size: 1.05rem; font-weight: 700; }
      .rn-student-meta { font-size: 0.83rem; color: var(--text-secondary); display: flex; gap: 14px; flex-wrap: wrap; }
      
      .rn-last-sub {
        display: flex; align-items: center; gap: 8px;
        background: var(--bg-hover); border: 1px solid var(--border);
        border-radius: 10px; padding: 9px 14px; margin-bottom: 16px;
        font-size: 0.82rem; color: var(--text-secondary);
      }
      .rn-last-sub strong { color: var(--text-primary); font-weight: 600; margin-left: 4px; }
      
      .rn-section-lbl {
        font-size: 0.72rem; font-weight: 800; letter-spacing: 0.06em;
        color: var(--text-muted); text-transform: uppercase; margin-bottom: 6px;
      }
      
      .rn-dates-card {
        display: flex; align-items: center; justify-content: space-between;
        background: var(--bg-card); border: 1px solid var(--border);
        border-radius: 12px; padding: 12px 18px; margin-bottom: 16px;
      }
      .rn-date-box {
        flex: 1; text-align: center; cursor: pointer; position: relative;
        padding: 4px 8px; border-radius: 8px; transition: background 0.15s;
      }
      .rn-date-box:hover { background: var(--bg-hover); }
      .rn-date-tag {
        font-size: 0.72rem; font-weight: 800; display: inline-flex;
        align-items: center; gap: 4px; text-transform: uppercase; letter-spacing: 0.05em;
      }
      .rn-date-big {
        font-size: 1.25rem; font-weight: 700; color: var(--text-primary);
        margin: 4px 0 2px; letter-spacing: -0.01em;
      }
      .rn-auto-pill {
        font-size: 0.7rem; font-weight: 800; color: #16a34a;
        letter-spacing: 0.05em; text-transform: uppercase;
      }
      .rn-date-hidden-input {
        position: absolute; opacity: 0; width: 1px; height: 1px;
        pointer-events: none; bottom: 0; left: 50%;
      }
      .rn-arrow {
        font-size: 1.4rem; color: var(--text-muted); opacity: 0.6;
        user-select: none; padding: 0 10px;
      }
      
      .rn-dur-grid {
        display: grid; grid-template-columns: 1.4fr 1fr; gap: 10px;
        align-items: center; margin-bottom: 16px;
      }
      .rn-input-unit-wrap {
        display: flex; align-items: center; gap: 8px;
      }
      .rn-select, .rn-input {
        width: 100%; padding: 10px 12px; border-radius: 9px;
        border: 1px solid var(--border); background: var(--bg-card);
        color: var(--text-primary); font-size: 14px; font-weight: 500;
        outline: none; transition: border-color 0.15s;
      }
      .rn-select:focus, .rn-input:focus { border-color: var(--primary); }
      
      .rn-form-grid {
        display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;
      }
      .rn-form-full { grid-column: 1 / -1; }
      .rn-form-group { display: flex; flex-direction: column; gap: 5px; }
      .rn-form-group label {
        font-size: 0.74rem; font-weight: 700; color: var(--text-secondary);
        text-transform: uppercase; letter-spacing: 0.04em;
      }
      
      .rn-actions {
        display: flex; justify-content: flex-end; align-items: center;
        gap: 10px; margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--border);
      }
      .btn-rn-green {
        background: #16a34a; border: 1px solid #16a34a; color: #ffffff;
        font-weight: 600; font-size: 14px; padding: 10px 22px; border-radius: 9px;
        display: inline-flex; align-items: center; gap: 6px; cursor: pointer;
        transition: background 0.15s, transform 0.05s;
      }
      .btn-rn-green:hover { background: #15803d; }
      .btn-rn-green:active { transform: scale(0.98); }
    </style>

    <div class="rn-wrap">
      <!-- TOP: Student Details Card -->
      <div class="rn-student-card">
        <div class="rn-avatar">
          ${photoUrl ? `<img src="${photoUrl}" alt="${student.name}" />` : initials}
        </div>
        <div class="rn-student-info">
          <h3>${student.name || "Student"}</h3>
          <div class="rn-student-meta">
            <span><strong>Phone:</strong> ${student.phone || "—"}</span>
            <span><strong>Seat:</strong> ${seatDisplay}</span>
          </div>
        </div>
      </div>

      <!-- LAST SUBSCRIPTION BANNER -->
      <div class="rn-last-sub">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;">
          <circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>
        </svg>
        <span>LAST SUBSCRIPTION</span>
        <strong>${lastSubStr}</strong>
      </div>

      <form id="renewal-form" onsubmit="event.preventDefault(); window.submitRenewal('${student.id}', '${student.planName || ''}')">
        <!-- DATES SECTION -->
        <div class="rn-section-lbl">DATES *</div>
        <div class="rn-dates-card">
          <!-- START DATE -->
          <div class="rn-date-box" onclick="window.triggerDatePicker('rn-start-date')">
            <div class="rn-date-tag" style="color: #3b82f6;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
              START
            </div>
            <div class="rn-date-big" id="rn-start-disp">${fmtDispDate(defaultStartStr)}</div>
            <div style="font-size: 11px; color: var(--text-muted); display:flex; align-items:center; justify-content:center; gap:3px;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Edit
            </div>
            <input type="date" id="rn-start-date" value="${defaultStartStr}" class="rn-date-hidden-input" onchange="window.onRenewalDatesChange()" />
          </div>

          <!-- ARROW -->
          <div class="rn-arrow">→</div>

          <!-- END DATE -->
          <div class="rn-date-box" onclick="window.triggerDatePicker('rn-end-date')">
            <div class="rn-date-tag" style="color: #16a34a;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
              END
            </div>
            <div class="rn-date-big" id="rn-end-disp">${fmtDispDate(defaultEndStr)}</div>
            <div id="rn-auto-badge" class="rn-auto-pill">AUTO</div>
            <input type="date" id="rn-end-date" value="${defaultEndStr}" class="rn-date-hidden-input" onchange="window.onRenewalDatesChange()" />
          </div>
        </div>

        <!-- DURATION SECTION -->
        <div class="rn-section-lbl">DURATION *</div>
        <div class="rn-dur-grid">
          <div>
            <select id="rn-duration-mode" class="rn-select" onchange="window.onRenewalModeChange()">
              <option value="monthly" selected>📅 Monthly</option>
              <option value="days">📅 Days</option>
              <option value="custom">📅 Custom Date</option>
            </select>
          </div>
          <div id="rn-duration-val-wrap" class="rn-input-unit-wrap">
            <input type="number" id="rn-duration-val" min="1" value="1" class="rn-input" style="width: 80px;" oninput="window.onRenewalDatesChange()" />
            <span id="rn-duration-unit" style="font-size: 13px; font-weight: 600; color: var(--text-muted);">month</span>
          </div>
        </div>

        <!-- PLAN & PAYMENT DETAILS -->
        <div class="rn-form-grid">
          <div class="rn-form-group">
            <label>Plan *</label>
            <select id="rn-new-plan" class="rn-select" required onchange="window.onRenewalPlanChange()">
              ${planOptions}
            </select>
          </div>

          <div class="rn-form-group">
            <label>Amount (₹) *</label>
            <input type="number" id="rn-amount" class="rn-input" min="0" required ${!canEditAmount ? "readonly" : ""} />
          </div>

          <div class="rn-form-group">
            <label>Payment Method *</label>
            <select id="rn-payment-method" class="rn-select" required>
              <option value="Cash" selected>Cash</option>
              <option value="UPI">UPI</option>
              <option value="Pay Later">Pay Later</option>
              <option value="Cheque">Cheque</option>
            </select>
          </div>

          <div class="rn-form-group">
            <label>Notes (Optional)</label>
            <input type="text" id="rn-notes" class="rn-input" placeholder="Renewal notes..." />
          </div>
        </div>

        <!-- ACTION BUTTONS -->
        <div class="rn-actions">
          <button type="button" class="btn btn-ghost" onclick="document.getElementById('renewal-modal')?.close()">✕ Cancel</button>
          <button type="submit" id="btn-rn-submit" class="btn-rn-green">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            Renew
          </button>
        </div>
      </form>
    </div>
  `;

  // Initialize duration and amount
  window.onRenewalModeChange();
};

window.triggerDatePicker = (inputId) => {
  const el = document.getElementById(inputId);
  if (!el) return;
  if (inputId === "rn-end-date") {
    const mode = document.getElementById("rn-duration-mode")?.value;
    if (mode !== "custom") {
      // Switching to custom date mode if user clicks on end date directly
      const modeSelect = document.getElementById("rn-duration-mode");
      if (modeSelect) {
        modeSelect.value = "custom";
        window.onRenewalModeChange();
      }
    }
  }
  if (typeof el.showPicker === "function") {
    try { el.showPicker(); return; } catch (_) {}
  }
  el.focus();
  el.click();
};

window.onRenewalModeChange = () => {
  const modeSelect = document.getElementById("rn-duration-mode");
  const valWrap = document.getElementById("rn-duration-val-wrap");
  const valInput = document.getElementById("rn-duration-val");
  const unitSpan = document.getElementById("rn-duration-unit");
  const autoBadge = document.getElementById("rn-auto-badge");
  if (!modeSelect || !valWrap || !valInput || !unitSpan) return;

  const mode = modeSelect.value;

  if (mode === "monthly") {
    valWrap.style.display = "flex";
    valInput.value = valInput.value > 0 ? valInput.value : 1;
    unitSpan.textContent = "month";
    if (autoBadge) { autoBadge.textContent = "AUTO"; autoBadge.style.color = "#16a34a"; }
  } else if (mode === "days") {
    valWrap.style.display = "flex";
    valInput.value = valInput.value > 1 ? valInput.value : 30;
    unitSpan.textContent = "days";
    if (autoBadge) { autoBadge.textContent = "AUTO"; autoBadge.style.color = "#16a34a"; }
  } else if (mode === "custom") {
    valWrap.style.display = "none";
    if (autoBadge) { autoBadge.textContent = "CUSTOM"; autoBadge.style.color = "#3b82f6"; }
  }

  window.onRenewalDatesChange();
};

window.onRenewalPlanChange = () => {
  window.onRenewalDatesChange();
};

window.onRenewalDatesChange = () => {
  const startEl = document.getElementById("rn-start-date");
  const endEl = document.getElementById("rn-end-date");
  const startDisp = document.getElementById("rn-start-disp");
  const endDisp = document.getElementById("rn-end-disp");
  const modeSelect = document.getElementById("rn-duration-mode");
  const valInput = document.getElementById("rn-duration-val");
  const amountInput = document.getElementById("rn-amount");
  const planSelect = document.getElementById("rn-new-plan");

  if (!startEl || !endEl || !modeSelect) return;

  const mode = modeSelect.value;
  const startVal = startEl.value || new Date().toISOString().split("T")[0];

  // Get base plan price
  let basePrice = 1000;
  if (planSelect && planSelect.selectedIndex >= 0) {
    const opt = planSelect.options[planSelect.selectedIndex];
    const p = Number(opt?.getAttribute("data-price"));
    if (p > 0) basePrice = p;
  }

  let durationDays = 30;

  if (mode === "monthly") {
    const months = Math.max(1, Number(valInput?.value || 1));
    // 30 days per month: Oct 15 -> Nov 13 inclusive = 30 days (start + (months * 30 - 1))
    durationDays = months * 30;
    const endStr = addDaysToStr(startVal, durationDays - 1);
    endEl.value = endStr;
    if (amountInput) amountInput.value = basePrice * months;
  } else if (mode === "days") {
    const days = Math.max(1, Number(valInput?.value || 30));
    durationDays = days;
    const endStr = addDaysToStr(startVal, days - 1);
    endEl.value = endStr;
    if (amountInput) amountInput.value = Math.round((basePrice / 30) * days);
  } else if (mode === "custom") {
    let endVal = endEl.value;
    if (!endVal || endVal < startVal) {
      endVal = addDaysToStr(startVal, 29);
      endEl.value = endVal;
    }
    const d1 = new Date(`${startVal}T00:00:00`);
    const d2 = new Date(`${endVal}T00:00:00`);
    durationDays = Math.max(1, Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1);
    if (amountInput) amountInput.value = Math.round((basePrice / 30) * durationDays);
  }

  // Update big display labels
  if (startDisp) startDisp.textContent = fmtDispDate(startEl.value);
  if (endDisp) endDisp.textContent = fmtDispDate(endEl.value);
};

window.submitRenewal = async (studentId, oldPlanName) => {
  const planSelect = document.getElementById("rn-new-plan");
  const modeSelect = document.getElementById("rn-duration-mode");
  const valInput = document.getElementById("rn-duration-val");
  const startEl = document.getElementById("rn-start-date");
  const endEl = document.getElementById("rn-end-date");
  const amountEl = document.getElementById("rn-amount");
  const payMethodEl = document.getElementById("rn-payment-method");
  const notesEl = document.getElementById("rn-notes");

  if (!planSelect || !planSelect.value) {
    return window.showToast("Please select a membership plan.", "warning");
  }

  const startDate = startEl?.value;
  const endDate = endEl?.value;
  if (!startDate || !endDate) {
    return window.showToast("Start date and End date are required.", "warning");
  }
  if (startDate > endDate) {
    return window.showToast("End date cannot be earlier than start date.", "warning");
  }

  const d1 = new Date(`${startDate}T00:00:00`);
  const d2 = new Date(`${endDate}T00:00:00`);
  const durationDays = Math.max(1, Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1);

  const data = {
    studentId,
    oldPlanName: oldPlanName || "",
    newPlanId: planSelect.value,
    newPlanName: planSelect.options[planSelect.selectedIndex].text.split(" (")[0],
    startDate,
    endDate,
    durationDays,
    durationMode: modeSelect?.value || "monthly",
    amount: amountEl?.value || "0",
    paymentMethod: payMethodEl?.value || "Cash",
    renewalNotes: notesEl?.value || "",
    renewedBy: localStorage.getItem("userName") || "Admin"
  };

  const btn = document.getElementById("btn-rn-submit");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-sm" style="display:inline-block;width:14px;height:14px;border:2px solid #fff;border-top-color:transparent;border-radius:50%;animation:spin 0.6s linear infinite;margin-right:6px;"></span> Processing...`;
  }

  const res = await processRenewal(data);
  if (res.success) {
    window.showToast("Renewal processed successfully!", "success");
    document.getElementById("renewal-modal")?.close();
    // Refresh student list and open profile if available
    if (typeof window.openStudentProfile === "function") {
      window.openStudentProfile(studentId);
    }
  } else {
    window.showToast("Error: " + res.error, "error");
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Renew`;
    }
  }
};

// Global proof viewer modal for Admin
window.viewAdminProofModal = (dataUrl, title = "Payment Screenshot Proof") => {
  const isValidImage = (u) => typeof u === "string" && (u.startsWith("data:image/") || u.startsWith("http://") || u.startsWith("https://") || u.startsWith("blob:"));
  if (!isValidImage(dataUrl)) {
    if (window.showToast) window.showToast("No valid screenshot proof available for this payment.", "warning");
    return;
  }
  const old = document.getElementById("admin-proof-modal");
  if (old) old.remove();

  const dialog = document.createElement("dialog");
  dialog.id = "admin-proof-modal";
  dialog.className = "card smooth-modal";
  dialog.style.cssText = "border:none; border-radius:14px; padding:0; box-shadow:0 18px 45px rgba(0,0,0,0.5); background:var(--bg-card); color:var(--text-primary); width:min(560px, 94vw); margin:auto;";
  dialog.innerHTML = `
    <div style="padding:1.25rem 1.5rem;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem; border-bottom:1px solid var(--border); padding-bottom:0.75rem;">
        <h3 style="margin:0; font-size:1.05rem; font-weight:700;">${title}</h3>
        <button class="btn btn-ghost" id="apm-close" style="padding:0.25rem 0.5rem; font-size:1.1rem; line-height:1; cursor:pointer;">✕</button>
      </div>
      <div style="text-align:center; background:var(--bg-hover); border-radius:10px; overflow:hidden; border:1px solid var(--border); display:flex; align-items:center; justify-content:center; min-height:220px; max-height:65vh; padding:10px;">
        <img src="${dataUrl}" alt="Proof" onerror="this.onerror=null; this.parentElement.innerHTML='<div style=\\'padding:2.5rem; color:var(--text-muted); font-size:13px; text-align:center;\\'>⚠️ Screenshot proof could not be loaded</div>';" style="width:100%; height:auto; max-height:65vh; object-fit:contain; display:block; border-radius:8px;" />
      </div>
      <div style="display:flex; justify-content:flex-end; gap:0.5rem; margin-top:1rem;">
        <a class="btn btn-primary" download="payment-proof.jpg" href="${dataUrl}" style="text-decoration:none; padding:7px 16px; font-size:13px;">Download Proof</a>
      </div>
    </div>
  `;
  document.body.appendChild(dialog);
  dialog.querySelector("#apm-close").onclick = () => dialog.close();
  dialog.addEventListener("close", () => dialog.remove());
  dialog.showModal();
};

/**
 * Renders the student's Renewal History table:
 *   # | Amount | Payment | Start | End | Recorded | Proof
 */
export const renderRenewalHistory = (studentId, containerId) => {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `
    <div id="sp-renewals-section" style="text-align:center; padding:2rem; color:var(--text-muted);">Loading history...</div>
  `;

  const isValidImage = (u) => typeof u === "string" && (u.startsWith("data:image/") || u.startsWith("http://") || u.startsWith("https://") || u.startsWith("blob:"));

  listenToRenewalHistory(studentId, async (history) => {
    const target = document.getElementById("sp-renewals-section");
    if (!target) return;

    // Fetch student's real document screenshot from studentDocuments/{studentId} as authoritative fallback
    let docPaymentScreenshot = "";
    try {
      const docSnap = await getDoc(doc(db, "studentDocuments", studentId));
      if (docSnap.exists()) {
        const dd = docSnap.data() || {};
        if (isValidImage(dd.paymentScreenshot)) {
          docPaymentScreenshot = dd.paymentScreenshot;
        }
      }
    } catch (_) {}

    let displayHistory = [...history];

    // Fallback: if no admission renewal in history, check student doc and auto-heal into renewals collection
    const hasAdmission = displayHistory.some(r => r.source === "onboarding" || r.source === "admission");
    if (!hasAdmission) {
      try {
        const sSnap = await getDoc(doc(db, "students", studentId));
        if (sSnap.exists()) {
          const sd = sSnap.data() || {};
          if (sd.startDate || sd.paymentDueDate || sd.paymentMethod || sd.paymentScreenshotUrl || sd.status === "Active" || sd.approvalStatus === "Approved") {
            const rawShot = docPaymentScreenshot || sd.paymentScreenshotUrl || sd.paymentScreenshot || "";
            // Calculate real plan price
            let realAmount = Number(sd.amount || sd.planPrice || sd.price || sd.fee || 0);
            if (!realAmount || realAmount <= 0) {
              const pMatch = availablePlans.find(p => (sd.planId && p.id === sd.planId) || (sd.planName && p.planName && p.planName.toLowerCase().trim() === sd.planName.toLowerCase().trim()));
              realAmount = (pMatch && Number(pMatch.price) > 0) ? Number(pMatch.price) : 1000;
            }
            const startDate = sd.startDate || (sd.createdAt?.seconds ? new Date(sd.createdAt.seconds * 1000).toISOString().split("T")[0] : new Date().toISOString().split("T")[0]);
            const endDate = sd.paymentDueDate || sd.endDate || addDaysToStr(startDate, 29);
            const renItem = {
              id: "admission_" + studentId,
              newPlan: sd.planName || "Regular Fixed Premium",
              amount: realAmount,
              paymentMethod: sd.paymentMethod || "UPI",
              startDate: startDate,
              endDate: endDate,
              screenshot: isValidImage(rawShot) ? rawShot : "",
              paymentScreenshotUrl: isValidImage(rawShot) ? rawShot : "",
              source: "admission",
              createdAt: sd.createdAt || null
            };
            displayHistory.push(renItem);

            // Persist to renewals collection in Firestore deterministically so DB is single source of truth
            try {
              const renDoc = {
                studentId: studentId,
                studentName: sd.name || "Student",
                oldPlan: "",
                newPlan: sd.planName || "Regular Fixed Premium",
                startDate: startDate,
                endDate: endDate,
                amount: realAmount,
                paymentMethod: sd.paymentMethod || "UPI",
                transactionId: sd.transactionId || "ADMISSION",
                status: "Completed",
                type: "Initial Admission",
                source: "admission",
                renewedBy: "Admin",
                createdAt: sd.createdAt || serverTimestamp()
              };
              if (isValidImage(rawShot)) {
                renDoc.screenshot = rawShot;
                renDoc.paymentScreenshotUrl = rawShot;
                renDoc.screenshots = [rawShot];
              }
              await setDoc(doc(db, "renewals", "admission_" + studentId), renDoc, { merge: true });
            } catch (pErr) {
              console.warn("[renewalAdmin] Auto-heal persist skipped:", pErr);
            }
          }
        }
      } catch (err) {
        console.warn("[renewalAdmin] Fallback load error:", err);
      }
    }

    // Clean up duplicate renewal documents in Firestore if any exist
    try {
      const renQ = query(collection(db, "renewals"), where("studentId", "==", studentId));
      const renSnap = await getDocs(renQ);
      const seenRenDocs = new Map();
      const dupsToDelete = [];
      renSnap.forEach(d => {
        const data = d.data() || {};
        const k = `${data.startDate || ""}_${data.endDate || ""}_${Number(data.amount) || 0}_${String(data.transactionId || "").trim().toUpperCase()}`;
        if (seenRenDocs.has(k)) {
          const prev = seenRenDocs.get(k);
          if (!prev.screenshot && (data.screenshot || data.paymentScreenshotUrl)) {
            dupsToDelete.push(prev.id);
            seenRenDocs.set(k, { id: d.id, ...data });
          } else {
            dupsToDelete.push(d.id);
          }
        } else {
          seenRenDocs.set(k, { id: d.id, ...data });
        }
      });
      for (const dupId of dupsToDelete) {
        await deleteDoc(doc(db, "renewals", dupId));
        console.log("[renewalAdmin] Cleaned duplicate renewal in Firestore:", dupId);
      }
    } catch (cleanErr) {
      console.warn("[renewalAdmin] Cleanup skipped:", cleanErr);
    }

    // Deduplicate displayHistory by startDate + endDate + amount + txnId
    const uniqueHistoryMap = new Map();
    displayHistory.forEach(r => {
      const st = r.startDate || "";
      const en = r.endDate || "";
      const amt = Number(r.amount) || 0;
      const txn = String(r.transactionId || "ADMISSION").trim().toUpperCase();
      const key = `${st}_${en}_${amt}_${txn}`;
      if (!uniqueHistoryMap.has(key)) {
        uniqueHistoryMap.set(key, r);
      } else {
        const existing = uniqueHistoryMap.get(key);
        if (!existing.screenshot && r.screenshot) {
          uniqueHistoryMap.set(key, r);
        }
      }
    });
    displayHistory = Array.from(uniqueHistoryMap.values());

    if (displayHistory.length === 0) {
      target.innerHTML = `<div style="text-align:center; padding:2rem; color:var(--text-muted);">No renewal history found.</div>`;
      return;
    }

    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const tsOf = (x) => (x && typeof x === "object" && typeof x.seconds === "number"
      ? x.seconds * 1000
      : new Date(x || 0).getTime() || 0);
    const fmtDate = (s) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
      return m ? `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : (s || "—");
    };
    const fmtRecorded = (r) => {
      const t = tsOf(r.createdAt);
      if (!t) return "—";
      return new Date(t)
        .toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true })
        .replace(" AM", " am")
        .replace(" PM", " pm");
    };

    // Sort newest-first, number 1..N oldest-first
    const asc = [...displayHistory].sort((a, b) => tsOf(a.createdAt) - tsOf(b.createdAt));
    const numById = new Map(asc.map((r, i) => [r.id, i + 1]));

    let html = `
      <table class="data-table">
        <thead>
          <tr>
            <th style="width:36px;">#</th>
            <th>Amount</th>
            <th>Payment</th>
            <th>Start</th>
            <th>End</th>
            <th>Recorded</th>
            <th style="text-align:center;">Proof</th>
          </tr>
        </thead>
        <tbody>
    `;

    displayHistory.forEach(r => {
      const noPay = /no[-\s]?payment/i.test(r.paymentMethod || "");
      let rawProof = r.screenshot || r.paymentScreenshotUrl || (Array.isArray(r.screenshots) && r.screenshots[0]) || "";
      if (!isValidImage(rawProof) && docPaymentScreenshot) {
        rawProof = docPaymentScreenshot;
      }
      const hasValidProof = isValidImage(rawProof);
      const proofCell = hasValidProof
        ? `<button type="button" class="btn btn-ghost btn-sm" onclick="window.viewAdminProofModal('${rawProof.replace(/'/g, "\\'")}', 'Payment Proof')" style="padding:2px 8px; font-size:11.5px; font-weight:600; color:var(--primary); border:1px solid var(--border); border-radius:6px; cursor:pointer;">👁 Proof</button>`
        : `<span style="color:var(--text-muted); font-size:11px;">—</span>`;
      html += `
        <tr>
          <td style="color:var(--text-muted);">${numById.get(r.id) ?? "—"}</td>
          <td class="amount">₹${r.amount}</td>
          <td>${r.paymentMethod || "—"}${noPay ? '<div style="font-size:0.7rem;color:var(--text-muted);">unpaid period</div>' : ""}</td>
          <td style="font-size:0.85rem;">${fmtDate(r.startDate)}</td>
          <td style="font-size:0.85rem;">${fmtDate(r.endDate)}</td>
          <td style="font-size:0.8rem;color:var(--text-muted);">${fmtRecorded(r)}</td>
          <td style="text-align:center;">${proofCell}</td>
        </tr>
      `;
    });

    html += `</tbody></table>`;
    target.innerHTML = html;
  });
};
