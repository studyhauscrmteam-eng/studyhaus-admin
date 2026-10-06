import { processRenewal, listenToRenewalHistory } from "./renewalService.js";
import { fetchPlansForDropdown } from "./admissionService.js";

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
 * Renders the renewal history table inside a container
 */
export const renderRenewalHistory = (studentId, containerId) => {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `<div style="text-align:center; padding:2rem; color:var(--text-muted);">Loading history...</div>`;

  listenToRenewalHistory(studentId, (history) => {
    if (history.length === 0) {
      container.innerHTML = `<div style="text-align:center; padding:2rem; color:var(--text-muted);">No renewal history found.</div>`;
      return;
    }

    let html = `
      <table class="data-table">
        <thead>
          <tr>
            <th data-i18n="table.date">\${window.t ? window.t("table.date") : "Date"}</th>
            <th>Plan Change</th>
            <th>Period</th>
            <th data-i18n="table.amount">\${window.t ? window.t("table.amount") : "Amount"}</th>
            <th>Method</th>
          </tr>
        </thead>
        <tbody>
    `;

    history.forEach(r => {
      const dateStr = r.createdAt ? new Date(r.createdAt.seconds * 1000).toLocaleDateString() : "Just now";
      html += `
        <tr>
          <td>${dateStr}</td>
          <td>
            <div style="font-size:0.75rem; color:var(--text-muted);">${r.oldPlan || "None"} →</div>
            <div>${r.newPlan}</div>
          </td>
          <td style="font-size:0.85rem;">${r.startDate} to ${r.endDate}</td>
          <td class="amount">,${r.amount}</td>
          <td>${r.paymentMethod}</td>
        </tr>
      `;
    });

    html += `</tbody></table>`;
    container.innerHTML = html;
  });
};
