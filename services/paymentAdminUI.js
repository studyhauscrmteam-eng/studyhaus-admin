import { listenToAllPayments, approvePayment, rejectPayment, receiveDirectPayment } from "./paymentService.js";

let allPayments = [];
let unsubscribe = null;
let currentFilters = { status: "All", search: "" };

export const initPaymentAdminUI = () => {
  const container = document.getElementById("page-payments");
  if (!container) return; 

  const role = localStorage.getItem("userRole");
  if (role === "Student") return; // Security guard

  // Initial UI Setup
  container.innerHTML = `
    <div class="page-header" style="margin-bottom: 2rem;">
      <div>
        <h1>Payments</h1>
        <p class="page-subtitle" id="payments-subtitle">Collections, invoices, and outstanding dues.</p>
      </div>
      <div style="display: flex; gap: 0.75rem;">
        <button class="btn btn-ghost" id="btn-export-payments" onclick="window.handlePaymentExport('csv')" style="background:var(--bg-card); color:var(--text-primary); border:1px solid var(--border); border-radius:999px; padding:8px 16px; font-weight:500; font-size:13px; display:inline-flex; align-items:center; gap:6px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Export CSV</button>
        <button class="btn btn-primary" id="btn-receive-payment" onclick="document.getElementById('receive-payment-modal').showModal()" style="background:var(--primary); color:#fff; border:none; border-radius:999px; padding:8px 16px; font-weight:500; font-size:13px; display:inline-flex; align-items:center; gap:6px;">+ Receive payment</button>
      </div>
    </div>
    
    <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:1rem; margin-bottom:1.5rem;">
      <div class="card card-theme" style="padding:1.5rem; display:flex; justify-content:space-between; align-items:flex-start;">
        <div><div style="font-size:11px; font-weight:700; letter-spacing:0.5px; color:var(--text-muted); margin-bottom:8px; text-transform:uppercase;">Today</div><div style="font-size:24px; font-weight:700; color:var(--text-primary);" id="pay-today">₹0</div></div>
        <div style="width:32px; height:32px; background:#f0fdf4; color:#16a34a; border-radius:8px; display:flex; align-items:center; justify-content:center;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg></div>
      </div>
      <div class="card card-theme" style="padding:1.5rem; display:flex; justify-content:space-between; align-items:flex-start;">
        <div><div style="font-size:11px; font-weight:700; letter-spacing:0.5px; color:var(--text-muted); margin-bottom:8px; text-transform:uppercase;">This Month</div><div style="font-size:24px; font-weight:700; color:var(--text-primary); margin-bottom:4px;" id="pay-month">₹0</div><div style="font-size:11px; color:#16a34a; font-weight:600; display:flex; align-items:center; gap:2px;"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg> 8%</div></div>
        <div style="width:32px; height:32px; background:var(--bg-gray); color:var(--text-secondary); border-radius:8px; display:flex; align-items:center; justify-content:center;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></div>
      </div>
      <div class="card card-theme" style="padding:1.5rem; display:flex; justify-content:space-between; align-items:flex-start;">
        <div><div style="font-size:11px; font-weight:700; letter-spacing:0.5px; color:var(--text-muted); margin-bottom:8px; text-transform:uppercase;">Pending</div><div style="font-size:24px; font-weight:700; color:var(--text-primary); margin-bottom:4px;" id="pay-pending">₹0</div><div style="font-size:11px; color:var(--text-muted); font-weight:500;" id="pay-pending-count">0 invoices</div></div>
        <div style="width:32px; height:32px; background:var(--bg-card)beb; color:#d97706; border-radius:8px; display:flex; align-items:center; justify-content:center;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>
      </div>
      <div class="card card-theme" style="padding:1.5rem; display:flex; justify-content:space-between; align-items:flex-start;">
        <div><div style="font-size:11px; font-weight:700; letter-spacing:0.5px; color:var(--text-muted); margin-bottom:8px; text-transform:uppercase;">Receipts Issued</div><div style="font-size:24px; font-weight:700; color:var(--text-primary);" id="pay-receipts">0</div></div>
        <div style="width:32px; height:32px; background:#e0f2fe; color:#0284c7; border-radius:8px; display:flex; align-items:center; justify-content:center;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg></div>
      </div>
    </div>
    
    <div class="card card-theme" style="padding:1.5rem;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.5rem;">
        <h3 style="font-size:15px; font-weight:600; color:var(--text-primary);">Recent transactions</h3>
        <div style="display:flex; gap:1rem;">
          <input type="text" id="payment-search" placeholder="Search..." style="padding:6px 12px; border-radius:8px; border:1px solid var(--border); font-size:13px;" />
          <select id="payment-filter-status" class="pay-filter-select" style="padding:6px 12px; border-radius:8px; border:1px solid var(--border); font-size:13px;">
            <option value="All">All Status</option>
            <option value="pending">Pending</option>
            <option value="approved">Paid</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </div>
      
      <div style="overflow-x:auto;">
        <table style="width:100%; border-collapse:collapse; text-align:left; font-size:13px; color:var(--text-secondary);">
          <thead>
            <tr style="color:var(--text-muted); font-size:11px; font-weight:700; letter-spacing:0.5px; text-transform:uppercase; border-bottom:1px solid var(--border);">
              <th style="padding:12px 16px; font-weight:700;">Receipt</th>
              <th style="padding:12px 16px; font-weight:700; color:var(--text-primary);">Student</th>
              <th style="padding:12px 16px; font-weight:700;">Plan</th>
              <th style="padding:12px 16px; font-weight:700;">Method</th>
              <th style="padding:12px 16px; font-weight:700; text-align:right;">Amount</th>
              <th style="padding:12px 16px; font-weight:700;">Date</th>
              <th style="padding:12px 16px; font-weight:700; text-align:right;">Status</th>
            </tr>
          </thead>
          <tbody id="payment-table-body">
            <tr><td colspan="7" style="text-align:center; padding:2rem;">Loading...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  if (!document.getElementById("receive-payment-modal")) {
    const modalDiv = document.createElement("div");
    modalDiv.innerHTML = `
      <dialog id="receive-payment-modal" class="card" style="border:none; border-radius:12px; padding:0; box-shadow:0 10px 30px rgba(0,0,0,0.5); background: var(--bg-card); color: var(--text-primary);">
        <div style="padding: 1.5rem; min-width: 400px; max-width: 500px; max-height: 85vh; overflow-y: auto;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
            <h2 style="margin: 0;">Receive Payment</h2>
            <button class="btn btn-ghost" onclick="document.getElementById('receive-payment-modal').close()" style="padding: 0.25rem 0.5rem;">✕</button>
          </div>
          <form id="receive-payment-form" onsubmit="event.preventDefault(); window.submitReceivePayment()">
            <div class="form-group" style="margin-bottom: 1rem;">
              <label style="display:block; margin-bottom:0.25rem; font-size:0.875rem; font-weight:600; color:var(--text-secondary);">Student Name</label>
              <input type="text" id="rec-pay-student" required placeholder="Student Name" class="input-field" style="width: 100%; box-sizing: border-box; padding: 0.5rem;" />
            </div>
            <div class="form-group" style="margin-bottom: 1rem;">
              <label style="display:block; margin-bottom:0.25rem; font-size:0.875rem; font-weight:600; color:var(--text-secondary);">Plan Name</label>
              <input type="text" id="rec-pay-plan" required placeholder="e.g. Monthly Pass" class="input-field" style="width: 100%; box-sizing: border-box; padding: 0.5rem;" />
            </div>
            <div class="form-group" style="margin-bottom: 1rem;">
              <label style="display:block; margin-bottom:0.25rem; font-size:0.875rem; font-weight:600; color:var(--text-secondary);">Amount (₹)</label>
              <input type="number" id="rec-pay-amount" required min="1" placeholder="e.g. 1000" class="input-field" style="width: 100%; box-sizing: border-box; padding: 0.5rem;" />
            </div>
            <div class="form-group" style="margin-bottom: 1rem;">
              <label style="display:block; margin-bottom:0.25rem; font-size:0.875rem; font-weight:600; color:var(--text-secondary);">Payment Method</label>
              <select id="rec-pay-method" required class="input-field" style="width: 100%; box-sizing: border-box; padding: 0.5rem;">
                <option value="UPI">UPI</option>
                <option value="Cash">Cash</option>
                <option value="Card">Card</option>
                <option value="Bank Transfer">Bank Transfer</option>
              </select>
            </div>
            <div class="form-group" style="margin-bottom: 1.5rem;">
              <label style="display:block; margin-bottom:0.25rem; font-size:0.875rem; font-weight:600; color:var(--text-secondary);">Transaction ID (Optional)</label>
              <input type="text" id="rec-pay-txn" placeholder="e.g. TXN12345" class="input-field" style="width: 100%; box-sizing: border-box; padding: 0.5rem;" />
            </div>
            <div style="display: flex; justify-content: flex-end; gap: 0.5rem;">
              <button type="button" class="btn btn-ghost" onclick="document.getElementById('receive-payment-modal').close()">Cancel</button>
              <button type="submit" class="btn btn-primary" id="btn-save-payment">Save Payment</button>
            </div>
          </form>
        </div>
      </dialog>
    `;
    document.body.appendChild(modalDiv.firstElementChild);
  }

  // Filter Listeners
  document.getElementById("payment-search").addEventListener("input", (e) => {
    currentFilters.search = e.target.value.toLowerCase();
    renderPaymentAdminTable();
  });

  document.getElementById("payment-filter-status").addEventListener("change", (e) => {
    currentFilters.status = e.target.value;
    renderPaymentAdminTable();
  });

  // Global Actions for buttons
  window.handleApprovePayment = async (id) => {
    const confirmed = await window.showCustomConfirm("Approve Payment", "Are you sure you want to APPROVE this payment? This will update their due date.");
    if (!confirmed) return;
    const approver = localStorage.getItem("userName") || "Admin";
    const res = await approvePayment(id, approver);
    if (!res.success) window.showToast("Error approving payment: " + res.error, "error");
  };

  window.handleRejectPayment = async (id) => {
    const remark = await window.showCustomPrompt("Reject Payment", "Please enter a reason for rejection:", "Reject", true);
    if (remark === null) return; // cancelled
    const approver = localStorage.getItem("userName") || "Admin";
    const res = await rejectPayment(id, approver, remark);
    if (!res.success) window.showToast("Error rejecting payment: " + res.error, "error");
  };

  window.submitReceivePayment = async () => {
    const studentName = document.getElementById("rec-pay-student").value.trim();
    const planName = document.getElementById("rec-pay-plan").value.trim();
    const amount = document.getElementById("rec-pay-amount").value;
    const paymentMethod = document.getElementById("rec-pay-method").value;
    const transactionId = document.getElementById("rec-pay-txn").value.trim();

    if (!studentName || !planName || !amount) {
      window.showToast("Please fill in all required fields.", "warning");
      return;
    }

    const btn = document.getElementById("btn-save-payment");
    const originalText = btn.innerText;
    btn.innerText = "Saving...";
    btn.disabled = true;

    const data = {
      studentName,
      planName,
      amount: Number(amount),
      paymentMethod,
      transactionId: transactionId || "RC-N/A",
      status: "approved",
      date: new Date().toISOString(),
      approvedBy: localStorage.getItem("userName") || "Admin"
    };

    const res = await receiveDirectPayment(data);
    
    btn.innerText = originalText;
    btn.disabled = false;

    if (res.success) {
      document.getElementById("receive-payment-modal").close();
      document.getElementById("receive-payment-form").reset();
      if(typeof showToast === 'function') showToast("Payment received successfully!");
    } else {
      window.showToast("Error: " + res.error, "error");
    }
  };

  // Start Listener
  if (unsubscribe) unsubscribe();
  unsubscribe = listenToAllPayments((records) => {
    allPayments = records;
    renderPaymentAdminTable();
  });
};

const renderPaymentAdminTable = () => {
  const tbody = document.getElementById("payment-table-body");
  if (!tbody) return;

  const role = localStorage.getItem("userRole");
  const canApprove = (role === "Owner" || role === "Admin" || role === "Manager");

  // Calculate Metrics
  let todayTotal = 0;
  let monthTotal = 0;
  let pendingTotal = 0;
  let pendingCount = 0;
  let receiptsIssued = 0;

  const now = new Date();
  const todayStr = now.toDateString();
  const month = now.getMonth();
  const year = now.getFullYear();

  allPayments.forEach(p => {
    const amt = parseFloat(p.amount) || 0;
    const d = p.date ? new Date(p.date) : new Date();
    
    if (p.status === "pending") {
      pendingTotal += amt;
      pendingCount++;
    } else if (p.status === "approved") {
      receiptsIssued++;
      if (d.getMonth() === month && d.getFullYear() === year) {
        monthTotal += amt;
      }
      if (d.toDateString() === todayStr) {
        todayTotal += amt;
      }
    }
  });

  const domToday = document.getElementById("pay-today");
  const domMonth = document.getElementById("pay-month");
  const domPending = document.getElementById("pay-pending");
  const domPendingCount = document.getElementById("pay-pending-count");
  const domReceipts = document.getElementById("pay-receipts");
  
  if (domToday) domToday.innerText = "₹" + todayTotal.toLocaleString();
  if (domMonth) domMonth.innerText = "₹" + monthTotal.toLocaleString();
  if (domPending) domPending.innerText = "₹" + pendingTotal.toLocaleString();
  if (domPendingCount) domPendingCount.innerText = pendingCount + " invoices";
  if (domReceipts) domReceipts.innerText = receiptsIssued;

  // Filter Data
  let filtered = allPayments;
  if (currentFilters.status !== "All") {
    filtered = filtered.filter(r => r.status === currentFilters.status);
  }
  if (currentFilters.search.trim() !== "") {
    filtered = filtered.filter(r => {
      const name = (r.studentName || "").toLowerCase();
      const txn = (r.transactionId || "").toLowerCase();
      return name.includes(currentFilters.search) || txn.includes(currentFilters.search);
    });
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:2rem; color: var(--text-muted);">No transactions found.</td></tr>`;
    return;
  }

  let html = "";
  filtered.forEach(r => {
    const isPending = r.status === "pending";
    const statusText = isPending ? "Pending" : (r.status === "approved" ? "Paid" : "Rejected");
    const statusStyle = isPending 
      ? "background:var(--bg-card)beb; color:#d97706; border:1px solid #fde68a;" 
      : (r.status === "approved" ? "background:#f0fdf4; color:#16a34a; border:1px solid #bbf7d0;" : "background:#fef2f2; color:#991b1b; border:1px solid #fecaca;");
    
    // Make the row clickable for admins to approve if it's pending.
    const clickAttr = (isPending && canApprove) ? `onclick="window.handleApprovePayment('${r.id}')" style="cursor:pointer;" title="Click to Approve"` : "";

    html += `
      <tr style="border-bottom:1px solid var(--border);">
        <td style="padding:16px;">${r.transactionId || "RC-N/A"}</td>
        <td style="padding:16px; font-weight:600; color:var(--text-primary);">${r.studentName || "Unknown"}</td>
        <td style="padding:16px;">${r.planName || "Unknown Plan"}</td>
        <td style="padding:16px;">${r.paymentMethod || "Cash"}</td>
        <td style="padding:16px; font-weight:600; color:var(--text-primary); text-align:right;">₹${r.amount}</td>
        <td style="padding:16px;">${
          (() => {
            const raw = r.date || r.paymentDate || (r.createdAt && r.createdAt.seconds ? r.createdAt.seconds * 1000 : null);
            if (!raw) return "N/A";
            const d = new Date(raw);
            return isNaN(d.getTime()) ? "N/A" : d.toISOString().split('T')[0];
          })()
        }</td>
        <td style="padding:16px; text-align:right;" ${clickAttr}>
          <span style="${statusStyle} padding:4px 12px; border-radius:999px; font-size:11px; font-weight:600;">${statusText}</span>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
  }; // End of render function

  // Export functions
  window.handlePaymentExport = async (format) => {
    try {
      const { exportToCSV, exportToExcel, exportToPDF } = await import("./exportService.js");
      
      // Filter Data same as render logic
      let filtered = allPayments;
      if (currentFilters.status !== "All") {
        filtered = filtered.filter(r => r.status === currentFilters.status);
      }
      if (currentFilters.search.trim() !== "") {
        filtered = filtered.filter(r => {
          const name = (r.studentName || "").toLowerCase();
          const txn = (r.transactionId || "").toLowerCase();
          return name.includes(currentFilters.search) || txn.includes(currentFilters.search);
        });
      }

      const rows = filtered.map(r => {
        const isPending = r.status === "pending";
        const statusText = isPending ? "Pending" : (r.status === "approved" ? "Paid" : "Rejected");
        const date = (() => {
          const raw = r.date || r.paymentDate || (r.createdAt && r.createdAt.seconds ? r.createdAt.seconds * 1000 : null);
          if (!raw) return "N/A";
          const d = new Date(raw);
          return isNaN(d.getTime()) ? "N/A" : d.toISOString().split('T')[0];
        })();

        return {
          "Transaction ID": r.transactionId || "RC-N/A",
          "Name": r.studentName || "Unknown",
          "Plan": r.planName || "Unknown Plan",
          "Method": r.paymentMethod || "Cash",
          "Amount": r.amount,
          "Date": date,
          "Status": statusText
        };
      });

      const filename = `payments_export_${new Date().toISOString().split('T')[0]}`;
      if (format === 'csv') exportToCSV(filename, rows);
      else if (format === 'excel') await exportToExcel(filename, rows);
      else if (format === 'pdf') await exportToPDF(filename, 'Payments Report', rows);
    } catch (err) {
      console.error("Export Error:", err);
      if (typeof showToast === 'function') showToast("Export failed: " + err.message, "error");
    }
  };
