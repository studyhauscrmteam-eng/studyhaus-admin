import { processRenewal, listenToRenewalHistory } from "./renewalService.js";
import { fetchPlansForDropdown } from "./admissionService.js";
import { listenToMyPayments } from "./paymentService.js";

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
export const renderRenewalForm = (student, containerId, userRole) => {
  const container = document.getElementById(containerId);
  if (!container) return;

  const canEditAmount = (userRole === "Owner/Admin");
  
  // Calculate default dates
  const today = new Date();
  let defaultStart = student.paymentDueDate ? new Date(student.paymentDueDate) : today;
  if (defaultStart < today) defaultStart = today; // Don't start in the past
  
  const defaultStartStr = defaultStart.toISOString().split("T")[0];
  
  let defaultEnd = new Date(defaultStart);
  defaultEnd.setMonth(defaultEnd.getMonth() + 1);
  const defaultEndStr = defaultEnd.toISOString().split("T")[0];

  let planOptions = `<option value="">Select Plan...</option>`;
  availablePlans.forEach(p => {
    const selected = p.id === student.planId ? "selected" : "";
    planOptions += `<option value="${p.id}" data-price="${p.price}" ${selected}>${p.planName} (,${p.price})</option>`;
  });

  container.innerHTML = `
    <form id="renewal-form" onsubmit="event.preventDefault(); window.submitRenewal('${student.id}', '${student.planName || ''}')">
      <div class="form-grid">
        <div class="form-group">
          <label>Current Plan</label>
          <input type="text" value="${student.planName || 'None'}" disabled />
        </div>
        <div class="form-group">
          <label>New Plan</label>
          <select id="rn-new-plan" required onchange="window.updateRenewalAmount()">
            ${planOptions}
          </select>
        </div>
        <div class="form-group">
          <label>Start Date</label>
          <input type="date" id="rn-start-date" value="${defaultStartStr}" required />
        </div>
        <div class="form-group">
          <label>End Date</label>
          <input type="date" id="rn-end-date" value="${defaultEndStr}" required />
        </div>
        <div class="form-group">
          <label>Amount (₹)</label>
          <input type="number" id="rn-amount" min="0" required ${!canEditAmount ? "readonly" : ""} />
        </div>
        <div class="form-group">
          <label>Payment Method</label>
          <select id="rn-payment-method" required>
            <option value="UPI">UPI</option>
            <option value="Cash">Cash</option>
            <option value="Cheque">Cheque</option>
          </select>
        </div>
        <div class="form-group" style="grid-column: 1 / -1;">
          <label>Notes</label>
          <input type="text" id="rn-notes" placeholder="Optional notes about this renewal..." />
        </div>
      </div>
      <div style="margin-top: 1.5rem; display: flex; justify-content: flex-end; gap: 1rem;">
        <button type="submit" class="btn btn-primary">Process Renewal</button>
      </div>
    </form>
  `;

  // Auto-fill initial amount
  window.updateRenewalAmount();
};

window.updateRenewalAmount = () => {
  const planSelect = document.getElementById("rn-new-plan");
  const amountInput = document.getElementById("rn-amount");
  if (!planSelect || !amountInput) return;

  const selectedOption = planSelect.options[planSelect.selectedIndex];
  if (selectedOption && selectedOption.value !== "") {
    amountInput.value = selectedOption.getAttribute("data-price");
  } else {
    amountInput.value = "";
  }
};

window.submitRenewal = async (studentId, oldPlanName) => {
  const planSelect = document.getElementById("rn-new-plan");
  const data = {
    studentId,
    oldPlanName,
    newPlanId: planSelect.value,
    newPlanName: planSelect.options[planSelect.selectedIndex].text.split(" (")[0],
    startDate: document.getElementById("rn-start-date").value,
    endDate: document.getElementById("rn-end-date").value,
    amount: document.getElementById("rn-amount").value,
    paymentMethod: document.getElementById("rn-payment-method").value,
    renewalNotes: document.getElementById("rn-notes").value,
    renewedBy: localStorage.getItem("userName") || "Admin"
  };

  const btn = document.querySelector("#renewal-form button[type='submit']");
  btn.disabled = true;
  btn.innerText = "Processing...";

  const res = await processRenewal(data);
  if (res.success) {
    window.showToast(window.t ? window.t('Renewal processed successfully!') || "Renewal processed successfully!" : "Renewal processed successfully!", "success");
    document.getElementById("renewal-modal")?.close();
    window.closeStudentProfile(); // Assuming this is called from the profile modal
  } else {
    window.showToast(window.t ? window.t('Error: ') || "Error: " : "Error: " + res.error, "error");
    btn.disabled = false;
    btn.innerText = "Process Renewal";
  }
};

/**
 * Renders the student's Renew History exactly like the old site's table:
 *   # | Amount | Payment | Start | End | Recorded   (numbered, newest first)
 * Includes No-Payment rows (dates extended without money) — migrated rows
 * come from the old site via the renewals collection.
 */
export const renderRenewalHistory = (studentId, containerId) => {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `
    <div id="sp-renewals-section" style="text-align:center; padding:2rem; color:var(--text-muted);">Loading history...</div>
    <h3 style="margin:1.5rem 0 0.75rem; font-size:1rem; font-weight:600;">Payment History</h3>
    <div id="sp-payments-section" style="text-align:center; padding:1rem; color:var(--text-muted);">Loading payments...</div>
  `;

  // Renewal history — old-site table style (# | Amount | Payment | Start | End | Recorded)
  listenToRenewalHistory(studentId, (history) => {
    const target = document.getElementById("sp-renewals-section");
    if (!target) return;
    if (history.length === 0) {
      target.innerHTML = `<div style="text-align:center; padding:2rem; color:var(--text-muted);">No renewal history found.</div>`;
      return;
    }

    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const tsOf = (x) => (x && typeof x === "object" && typeof x.seconds === "number"
      ? x.seconds * 1000
      : new Date(x || 0).getTime() || 0);
    // "2026-08-08" → "08 Aug 2026" (old-site format)
    const fmtDate = (s) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
      return m ? `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : (s || "—");
    };
    // "October 10, 2026, 9:09 am" (old-site Recorded format)
    const fmtRecorded = (r) => {
      const t = tsOf(r.createdAt);
      if (!t) return "—";
      return new Date(t)
        .toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true })
        .replace(" AM", " am")
        .replace(" PM", " pm");
    };

    // Number rows 1..N oldest-first, then display newest-first (old-site order).
    const asc = [...history].sort((a, b) => tsOf(a.createdAt) - tsOf(b.createdAt));
    const numById = new Map(asc.map((r, i) => [r.id, i + 1]));

    let html = `
      <table class="data-table">
        <thead>
          <tr>
            <th style="width:36px;">#</th>
            <th data-i18n="table.amount">${window.t ? window.t("table.amount") : "Amount"}</th>
            <th>Payment</th>
            <th>Start</th>
            <th>End</th>
            <th>Recorded</th>
          </tr>
        </thead>
        <tbody>
    `;

    history.forEach(r => {
      const noPay = /no[-\s]?payment/i.test(r.paymentMethod || "");
      html += `
        <tr>
          <td style="color:var(--text-muted);">${numById.get(r.id) ?? "—"}</td>
          <td class="amount">₹${r.amount}</td>
          <td>${r.paymentMethod || "—"}${noPay ? '<div style="font-size:0.7rem;color:var(--text-muted);">unpaid period</div>' : ""}</td>
          <td style="font-size:0.85rem;">${fmtDate(r.startDate)}</td>
          <td style="font-size:0.85rem;">${fmtDate(r.endDate)}</td>
          <td style="font-size:0.8rem;color:var(--text-muted);">${fmtRecorded(r)}</td>
        </tr>
      `;
    });

    html += `</tbody></table>`;
    target.innerHTML = html;
  });

  // Payment history — EVERY payment of this student only (portal requests,
  // renewals, direct entries) with live status; pending rows included.
  listenToMyPayments(studentId, (payments) => {
    const target = document.getElementById("sp-payments-section");
    if (!target) return;
    if (payments.length === 0) {
      target.innerHTML = `<div style="text-align:center; padding:1rem; color:var(--text-muted);">No payment history yet.</div>`;
      return;
    }

    const statusColor = (status) => {
      const s = String(status || "").toLowerCase();
      if (s === "approved" || s === "completed") return "#16a34a";
      if (s === "pending") return "#d97706";
      if (s === "rejected") return "#dc2626";
      return "var(--text-secondary)";
    };

    let html = `
      <table class="data-table">
        <thead>
          <tr>
            <th data-i18n="table.date">${window.t ? window.t("table.date") : "Date"}</th>
            <th>Plan</th>
            <th data-i18n="table.amount">${window.t ? window.t("table.amount") : "Amount"}</th>
            <th>Method</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
    `;

    payments.forEach(p => {
      const dateStr = p.paymentDate || (p.date ? new Date(p.date).toLocaleDateString() : "");
      html += `
        <tr>
          <td>${dateStr}</td>
          <td>${p.planName || "—"}</td>
          <td class="amount">₹${p.amount}</td>
          <td>${p.paymentMethod || "—"}</td>
          <td style="color:${statusColor(p.status)}; font-weight:600;">${p.status || "—"}</td>
        </tr>
      `;
    });

    html += `</tbody></table>`;
    target.innerHTML = html;
  });
};
