import { listenToAllPayments, approvePayment, rejectPayment, receiveDirectPayment, collectPayLaterPayment } from "./paymentService.js";
import { ROLES, hasPermission } from "../auth/roles.js";
import { doc, getDoc, getDocs, collection, query, where } from "firebase/firestore";
import { db } from "../firebase/firebase.js";
import { openProofViewer } from "./proofViewer.js";

let allPayments = [];
let unsubscribe = null;
let currentFilters = { status: "All", search: "", view: "all" }; // view: 'all' | 'renewals'

// Check if an image URL is a valid image source (data URL, HTTP, HTTPS, or blob)
const isValidImg = (u) => typeof u === "string" && u.trim().length > 10 && (
  u.startsWith("data:image/") ||
  u.startsWith("http://") ||
  u.startsWith("https://") ||
  u.startsWith("blob:")
);

// Extract all valid screenshot URLs from a payment record
const extractRecordScreenshots = (r) => {
  if (!r) return [];
  const list = [];
  const add = (u) => { if (isValidImg(u) && !list.includes(u.trim())) list.push(u.trim()); };
  if (Array.isArray(r.screenshots)) r.screenshots.forEach(add);
  if (r.screenshot) add(r.screenshot);
  if (r.paymentScreenshotUrl) add(r.paymentScreenshotUrl);
  return list;
};

// Filter out dummy/demo/test records
const isDemoOrTestRecord = (p) => {
  if (!p) return false;
  const name = String(p.studentName || "").trim().toLowerCase();
  const id = String(p.studentId || "").trim().toLowerCase();
  return name === "demo" || name === "test" || name === "demo student" || name.startsWith("demo ") || id === "demo";
};

// Helper: check if a payment record is a renewal record
const isRenewalRecord = (p) => {
  if (!p) return false;
  if (p.source === "renewal") return true;
  if (p.renewalMonths || p.durationDays || p.renewalDays || p.durationMode) return true;
  if (p.startDate && p.endDate && p.source !== "onboarding" && p.source !== "admission") return true;
  return false;
};

// ── Payment screenshot viewer with enlarge, zoom, rotate, and drag pan ──
window.viewPaymentScreenshots = async (paymentId) => {
  let shots = [];
  const local = allPayments.find(p => p.id === paymentId);
  if (local) shots = extractRecordScreenshots(local);

  if (!shots.length) {
    try {
      const snap = await getDoc(doc(db, "payments", paymentId));
      if (snap.exists()) {
        shots = extractRecordScreenshots(snap.data());
      }
    } catch (e) {
      return window.showToast("Could not load screenshots: " + e.message, "error");
    }
  }
  if (!shots.length) return window.showToast("No screenshot proof attached to this payment.", "warning");

  openProofViewer({
    sources: shots,
    title: "Payment Screenshot Proof"
  });
};

export const isPayLaterRecord = (r) => {
  if (!r) return false;
  const pm = String(r.paymentMethod || r.paymentMode || r.mode || "").toLowerCase().trim();
  const st = String(r.status || "").toLowerCase().trim();
  const txn = String(r.transactionId || "").toLowerCase().trim();
  return pm === "pay later" || pm === "paylater" || pm.includes("pay later") || st === "pay later" || st === "paylater" || st === "pay_later" || st === "unpaid" || txn === "pay later";
};

/**
 * Payment status normalisation.
 */
const normalisePaymentStatus = (raw, record = null) => {
  if (record && isPayLaterRecord(record)) {
    return { key: "pay_later", label: "Pay Later", tone: "pay_later" };
  }
  const s = String(raw == null ? "" : raw);
  const key = s.trim().toLowerCase();
  if (key === "pay_later" || key === "pay later" || key === "unpaid") {
    return { key: "pay_later", label: "Pay Later", tone: "pay_later" };
  }
  if (key === "pending") return { key: "pending", label: "Pending", tone: "pending" };
  if (key === "approved" || key === "completed" || key === "paid") return { key: "approved", label: "Paid", tone: "paid" };
  if (key === "rejected") return { key: "rejected", label: "Rejected", tone: "rejected" };
  return { key: key || "unknown", label: s.trim() || "Unknown", tone: "unknown" };
};

const STATUS_STYLES = {
  pending: "background:rgba(245,158,11,0.14); color:var(--warning); border:1px solid rgba(245,158,11,0.45);",
  paid: "background:rgba(34,197,94,0.14); color:var(--success); border:1px solid rgba(34,197,94,0.45);",
  pay_later: "background:rgba(249,115,22,0.14); color:#ea580c; border:1px solid rgba(249,115,22,0.45); font-weight:700;",
  rejected: "background:rgba(239,68,68,0.14); color:var(--danger); border:1px solid rgba(239,68,68,0.45);",
  unknown: "background:var(--bg-hover); color:var(--text-secondary); border:1px solid var(--border);"
};

export const initPaymentAdminUI = () => {
  const container = document.getElementById("page-payments");
  if (!container) return; 

  const role = localStorage.getItem("userRole");
  if (!hasPermission(role, "payments") && role !== "Owner" && role !== "Admin") return;

  container.innerHTML = `
    <div class="page-header" style="margin-bottom: 1.5rem;">
      <div>
        <h1>Payments & Renewals</h1>
        <p class="page-subtitle" id="payments-subtitle">Collections, student renewal verification, and outstanding dues.</p>
      </div>
      <div style="display: flex; gap: 0.75rem;">
        <button class="btn btn-ghost" id="btn-export-payments" onclick="window.handlePaymentExport('csv')" style="background:var(--bg-card); color:var(--text-primary); border:1px solid var(--border); border-radius:999px; padding:8px 16px; font-weight:500; font-size:13px; display:inline-flex; align-items:center; gap:6px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Export CSV</button>
        <button class="btn btn-primary" id="btn-receive-payment" onclick="document.getElementById('receive-payment-modal').showModal()" style="background:var(--primary); color:#fff; border:none; border-radius:999px; padding:8px 16px; font-weight:500; font-size:13px; display:inline-flex; align-items:center; gap:6px;">+ Receive payment</button>
      </div>
    </div>
    
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(190px, 1fr)); gap:1rem; margin-bottom:1.5rem;">
      <div class="card card-theme" style="padding:1.25rem 1.5rem; display:flex; justify-content:space-between; align-items:flex-start;">
        <div><div style="font-size:11px; font-weight:700; letter-spacing:0.5px; color:var(--text-muted); margin-bottom:8px; text-transform:uppercase;">Today</div><div style="font-size:22px; font-weight:700; color:var(--text-primary);" id="pay-today">₹0</div></div>
        <div style="width:34px; height:34px; background:rgba(16,185,129,0.14); color:var(--accent-emerald, #10b981); border:1px solid rgba(16,185,129,0.25); border-radius:8px; display:flex; align-items:center; justify-content:center;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg></div>
      </div>
      <div class="card card-theme" style="padding:1.25rem 1.5rem; display:flex; justify-content:space-between; align-items:flex-start;">
        <div><div style="font-size:11px; font-weight:700; letter-spacing:0.5px; color:var(--text-muted); margin-bottom:8px; text-transform:uppercase;">This Month</div><div style="font-size:22px; font-weight:700; color:var(--text-primary); margin-bottom:4px;" id="pay-month">₹0</div></div>
        <div style="width:34px; height:34px; background:var(--bg-hover); color:var(--text-secondary); border:1px solid var(--border); border-radius:8px; display:flex; align-items:center; justify-content:center;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></div>
      </div>
      <div class="card card-theme" style="padding:1.25rem 1.5rem; display:flex; justify-content:space-between; align-items:flex-start; cursor:pointer;" onclick="window.filterPaymentsToRenewals()">
        <div><div style="font-size:11px; font-weight:700; letter-spacing:0.5px; color:var(--text-muted); margin-bottom:8px; text-transform:uppercase;">Pending Renewals</div><div style="font-size:22px; font-weight:700; color:var(--accent-amber, #f59e0b); margin-bottom:4px;" id="pay-pending-renewals">0</div><div style="font-size:11px; color:var(--accent-amber, #f59e0b); font-weight:600;" id="pay-pending-renewals-amt">₹0 awaiting verification</div></div>
        <div style="width:34px; height:34px; background:rgba(245,158,11,0.14); color:var(--accent-amber, #f59e0b); border:1px solid rgba(245,158,11,0.3); border-radius:8px; display:flex; align-items:center; justify-content:center;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg></div>
      </div>
      <div class="card card-theme" style="padding:1.25rem 1.5rem; display:flex; justify-content:space-between; align-items:flex-start;">
        <div><div style="font-size:11px; font-weight:700; letter-spacing:0.5px; color:var(--text-muted); margin-bottom:8px; text-transform:uppercase;">Total Invoices</div><div style="font-size:22px; font-weight:700; color:var(--text-primary);" id="pay-receipts">0</div></div>
        <div style="width:34px; height:34px; background:rgba(14,165,233,0.14); color:var(--primary, #0ea5e9); border:1px solid rgba(14,165,233,0.25); border-radius:8px; display:flex; align-items:center; justify-content:center;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg></div>
      </div>
    </div>

    <!-- Renewal Requests Attention Banner -->
    <div id="renewal-alert-banner" style="display:none; background:linear-gradient(135deg, rgba(245,158,11,0.12), rgba(217,119,6,0.06)); border:1px solid rgba(245,158,11,0.35); border-radius:12px; padding:12px 18px; margin-bottom:1.5rem; align-items:center; justify-content:space-between; gap:1rem;">
      <div style="display:flex; align-items:center; gap:12px;">
        <div style="width:36px; height:36px; border-radius:50%; background:rgba(245,158,11,0.2); color:var(--accent-amber, #f59e0b); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
        </div>
        <div>
          <div style="font-weight:700; font-size:13.5px; color:var(--text-primary);"><span id="renewal-banner-count">0</span> Student Renewal Request(s) Awaiting Bank & Proof Verification</div>
          <div style="font-size:12px; color:var(--text-secondary); margin-top:2px;">Check your bank account/UPI statement for the payment credit and verify the screenshot proof before approving. Once approved, student platform access is instantly restored.</div>
        </div>
      </div>
      <button class="btn btn-primary btn-sm" onclick="window.filterPaymentsToRenewals()" style="padding:7px 16px; font-size:12.5px; white-space:nowrap; border-radius:999px;">Review Requests</button>
    </div>
    
    <div class="card card-theme" style="padding:1.5rem;">
      <!-- Tab & Filter Bar -->
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.25rem; flex-wrap:wrap; gap:1rem;">
        <div style="display:flex; gap:6px; background:var(--bg-hover); padding:4px; border-radius:10px; border:1px solid var(--border);">
          <button id="tab-btn-all" onclick="window.switchPaymentView('all')" style="padding:6px 14px; border-radius:7px; border:1px solid var(--border-bright); font-size:12.5px; font-weight:600; cursor:pointer; background:var(--bg-card); color:var(--text-primary); box-shadow:0 1px 3px rgba(0,0,0,0.2);">All Transactions <span id="count-tab-all" style="font-size:11px; opacity:0.75;">(0)</span></button>
          <button id="tab-btn-renewals" onclick="window.switchPaymentView('renewals')" style="padding:6px 14px; border-radius:7px; border:1px solid transparent; font-size:12.5px; font-weight:600; cursor:pointer; background:transparent; color:var(--text-secondary);">Renewal Requests <span id="count-tab-renewals" style="background:rgba(245,158,11,0.18); color:var(--accent-amber, #f59e0b); border:1px solid rgba(245,158,11,0.3); padding:2px 7px; border-radius:999px; font-size:11px; margin-left:4px; font-weight:700;">0</span></button>
        </div>

        <div style="display:flex; gap:0.75rem; flex-wrap:wrap; align-items:center;">
          <input type="text" id="payment-search" placeholder="Search student or UTR..." style="padding:7px 14px; border-radius:8px; border:1px solid var(--border-bright); background:var(--bg-card); color:var(--text-primary); font-size:13px; min-width:210px; outline:none; transition:border-color 0.15s ease;" />
          <select id="payment-filter-status" class="pay-filter-select" style="padding:7px 32px 7px 14px; border-radius:8px; border:1px solid var(--border-bright); background-color:var(--bg-card); color:var(--text-primary); font-size:13px; outline:none; cursor:pointer;">
            <option value="All">All Status</option>
            <option value="pending">Pending Verification</option>
            <option value="approved">Paid / Approved</option>
            <option value="pay_later">Pay Later (Due)</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </div>
      
      <div style="overflow-x:auto;">
        <table style="width:100%; border-collapse:collapse; text-align:left; font-size:13px; color:var(--text-secondary);">
          <thead>
            <tr style="color:var(--text-muted); font-size:11px; font-weight:700; letter-spacing:0.5px; text-transform:uppercase; border-bottom:1px solid var(--border);">
              <th style="padding:12px 14px; font-weight:700;">Type</th>
              <th style="padding:12px 14px; font-weight:700; color:var(--text-primary);">Student</th>
              <th style="padding:12px 14px; font-weight:700;">Plan & Period</th>
              <th style="padding:12px 14px; font-weight:700;">Method & UTR</th>
              <th style="padding:12px 14px; font-weight:700; text-align:right;">Amount</th>
              <th style="padding:12px 14px; font-weight:700;">Date</th>
              <th style="padding:12px 14px; font-weight:700; text-align:center;">Status</th>
              <th style="padding:12px 14px; font-weight:700; text-align:right;">Action</th>
            </tr>
          </thead>
          <tbody id="payment-table-body">
            <tr><td colspan="8" style="text-align:center; padding:2.5rem; color:var(--text-muted);">Loading payments...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Filter Listeners
  document.getElementById("payment-search")?.addEventListener("input", (e) => {
    currentFilters.search = e.target.value.toLowerCase();
    renderPaymentAdminTable();
  });

  document.getElementById("payment-filter-status")?.addEventListener("change", (e) => {
    currentFilters.status = e.target.value;
    renderPaymentAdminTable();
  });

  window.switchPaymentView = (view) => {
    currentFilters.view = view;
    const btnAll = document.getElementById("tab-btn-all");
    const btnRen = document.getElementById("tab-btn-renewals");
    if (view === "renewals") {
      if (btnAll) { 
        btnAll.style.background = "transparent"; 
        btnAll.style.color = "var(--text-secondary)"; 
        btnAll.style.boxShadow = "none";
        btnAll.style.borderColor = "transparent";
      }
      if (btnRen) { 
        btnRen.style.background = "var(--bg-card)"; 
        btnRen.style.color = "var(--text-primary)"; 
        btnRen.style.boxShadow = "0 1px 3px rgba(0,0,0,0.1)"; 
        btnRen.style.borderColor = "var(--border-bright)";
      }
    } else {
      if (btnAll) { 
        btnAll.style.background = "var(--bg-card)"; 
        btnAll.style.color = "var(--text-primary)"; 
        btnAll.style.boxShadow = "0 1px 3px rgba(0,0,0,0.1)"; 
        btnAll.style.borderColor = "var(--border-bright)";
      }
      if (btnRen) { 
        btnRen.style.background = "transparent"; 
        btnRen.style.color = "var(--text-secondary)"; 
        btnRen.style.boxShadow = "none";
        btnRen.style.borderColor = "transparent";
      }
    }
    renderPaymentAdminTable();
  };

  window.filterPaymentsToRenewals = () => {
    window.switchPaymentView("renewals");
  };

  // Setup Receive Payment Modal (Desk direct payment)
  if (!document.getElementById("receive-payment-modal")) {
    const modalDiv = document.createElement("div");
    modalDiv.innerHTML = `
      <dialog id="receive-payment-modal" class="card" style="border:1px solid var(--border); border-radius:12px; padding:0; box-shadow:0 10px 30px rgba(0,0,0,0.5); background: var(--bg-card); color: var(--text-primary);">
        <div style="padding: 1.5rem; min-width: 400px; max-width: 500px; max-height: 85vh; overflow-y: auto;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; border-bottom: 1px solid var(--border); padding-bottom: 0.75rem;">
            <h2 style="margin: 0; font-size:1.2rem; font-weight:700;">Receive Desk Payment</h2>
            <button class="btn btn-ghost" onclick="document.getElementById('receive-payment-modal').close()" style="padding: 0.25rem 0.5rem; font-size:1.1rem; line-height:1; cursor:pointer; display:inline-flex; align-items:center;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
          </div>
          <form id="receive-payment-form" onsubmit="event.preventDefault(); window.submitReceivePayment()">
            <div class="form-group" style="margin-bottom: 1rem;">
              <label style="display:block; margin-bottom:0.35rem; font-size:0.875rem; font-weight:600; color:var(--text-secondary);">Student Name</label>
              <input type="text" id="rec-pay-student" required placeholder="Student Name" class="input-field" style="width: 100%; box-sizing: border-box; padding: 0.6rem 0.75rem; background:var(--bg-card); color:var(--text-primary); border:1px solid var(--border-bright); border-radius:8px;" />
            </div>
            <div class="form-group" style="margin-bottom: 1rem;">
              <label style="display:block; margin-bottom:0.35rem; font-size:0.875rem; font-weight:600; color:var(--text-secondary);">Plan Name</label>
              <input type="text" id="rec-pay-plan" required placeholder="e.g. Monthly Pass" class="input-field" style="width: 100%; box-sizing: border-box; padding: 0.6rem 0.75rem; background:var(--bg-card); color:var(--text-primary); border:1px solid var(--border-bright); border-radius:8px;" />
            </div>
            <div class="form-group" style="margin-bottom: 1rem;">
              <label style="display:block; margin-bottom:0.35rem; font-size:0.875rem; font-weight:600; color:var(--text-secondary);">Amount (₹)</label>
              <input type="number" id="rec-pay-amount" required min="1" placeholder="e.g. 1000" class="input-field" style="width: 100%; box-sizing: border-box; padding: 0.6rem 0.75rem; background:var(--bg-card); color:var(--text-primary); border:1px solid var(--border-bright); border-radius:8px;" />
            </div>
            <div class="form-group" style="margin-bottom: 1rem;">
              <label style="display:block; margin-bottom:0.35rem; font-size:0.875rem; font-weight:600; color:var(--text-secondary);">Payment Method</label>
              <select id="rec-pay-method" required class="input-field pay-filter-select" style="width: 100%; box-sizing: border-box; padding: 0.6rem 2.2rem 0.6rem 0.75rem; background-color:var(--bg-card); color:var(--text-primary); border:1px solid var(--border-bright); border-radius:8px; cursor:pointer;">
                <option value="UPI">UPI</option>
                <option value="Cash">Cash</option>
                <option value="Card">Card</option>
                <option value="Bank Transfer">Bank Transfer</option>
              </select>
            </div>
            <div class="form-group" style="margin-bottom: 1.5rem;">
              <label style="display:block; margin-bottom:0.35rem; font-size:0.875rem; font-weight:600; color:var(--text-secondary);">Transaction ID (Optional)</label>
              <input type="text" id="rec-pay-txn" placeholder="e.g. TXN12345" class="input-field" style="width: 100%; box-sizing: border-box; padding: 0.6rem 0.75rem; background:var(--bg-card); color:var(--text-primary); border:1px solid var(--border-bright); border-radius:8px;" />
            </div>
            <div style="display: flex; justify-content: flex-end; gap: 0.75rem;">
              <button type="button" class="btn btn-ghost" onclick="document.getElementById('receive-payment-modal').close()" style="border:1px solid var(--border); color:var(--text-secondary);">Cancel</button>
              <button type="submit" class="btn btn-primary" id="btn-save-payment" style="background:var(--primary); color:#fff; border:none; padding:8px 20px; font-weight:600; border-radius:8px;">Save Payment</button>
            </div>
          </form>
        </div>
      </dialog>
    `;
    document.body.appendChild(modalDiv.firstElementChild);
  }

  // ── Pro Verification Modal for Admin (Bank Account & Screenshot verification) ──
  window.openRenewalVerifyModal = async (paymentId) => {
    const payment = allPayments.find(p => p.id === paymentId);
    if (!payment) return window.showToast("Payment record not found.", "error");

    let student = null;
    try {
      if (payment.studentId) {
        const sSnap = await getDoc(doc(db, "students", payment.studentId));
        if (sSnap.exists()) {
          student = { id: sSnap.id, ...sSnap.data() };
        } else {
          const qUid = query(collection(db, "students"), where("uid", "==", payment.studentId));
          const snapUid = await getDocs(qUid);
          if (!snapUid.empty) student = { id: snapUid.docs[0].id, ...snapUid.docs[0].data() };
        }
      }
    } catch (_) {}

    const oldModal = document.getElementById("renewal-verify-modal");
    if (oldModal) oldModal.remove();

    const proofUrl = payment.screenshot || payment.paymentScreenshotUrl || (Array.isArray(payment.screenshots) && payment.screenshots[0]) || "";
    const isCash = payment.paymentMethod === "Cash" || payment.paymentMethod === "Paid (Cash)";
    const durationText = payment.durationDays ? `${payment.durationDays} Days` : (payment.renewalMonths ? `${payment.renewalMonths} Month(s)` : "30 Days");
    const periodText = (payment.startDate && payment.endDate) ? `${payment.startDate} → ${payment.endDate}` : (payment.endDate ? `Valid until ${payment.endDate}` : "30 Days renewal");
    const seatDisplay = (student && (student.seatNumber || student.seatAssigned))
      ? `Seat ${student.seatNumber || student.seatAssigned} (${student.seatFloor || student.floor || "Ground Floor"})`
      : "Open Seating / Unassigned";
    const currentDue = (student && student.paymentDueDate) ? student.paymentDueDate : "Expired / Not set";

    const dialog = document.createElement("dialog");
    dialog.id = "renewal-verify-modal";
    dialog.className = "card smooth-modal";
    dialog.style.cssText = "border:none; border-radius:16px; padding:0; box-shadow:0 24px 60px rgba(0,0,0,0.5); background:var(--bg-card); color:var(--text-primary); width:min(640px, 95vw); margin:auto;";
    
    dialog.innerHTML = `
      <div style="padding:1.5rem 1.75rem; max-height:88vh; overflow-y:auto;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.25rem; border-bottom:1px solid var(--border); padding-bottom:0.75rem;">
          <div>
            <h2 style="margin:0; font-size:1.15rem; font-weight:700; display:flex; align-items:center; gap:8px;">
              <span>Verify Renewal & Grant Access</span>
              <span class="badge" style="background:rgba(245,158,11,0.18); color:var(--accent-amber, #fbbf24); border:1px solid rgba(245,158,11,0.35); font-size:11px; padding:2px 8px; border-radius:999px;">Pending Verification</span>
            </h2>
            <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">Verify payment credit in your bank account before approving.</div>
          </div>
          <button class="btn btn-ghost" id="rvm-close" style="padding:0.25rem 0.5rem; font-size:1.1rem; line-height:1; cursor:pointer; display:inline-flex; align-items:center;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>

        <!-- Student & Plan Overview -->
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:1.25rem;">
          <div style="background:var(--bg-hover); padding:12px 14px; border-radius:10px; border:1px solid var(--border);">
            <div style="font-size:10.5px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">Student</div>
            <div style="font-size:14px; font-weight:700; color:var(--text-primary);">${payment.studentName || student?.name || "Student"}</div>
            <div style="font-size:12px; color:var(--text-secondary); margin-top:2px;">${student?.phone || "No phone"} · ${seatDisplay}</div>
            <div style="font-size:11.5px; color:var(--text-muted); margin-top:4px;">Current Due: <strong style="color:var(--text-primary);">${currentDue}</strong></div>
          </div>

          <div style="background:var(--bg-hover); padding:12px 14px; border-radius:10px; border:1px solid var(--border);">
            <div style="font-size:10.5px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">Renewal Plan</div>
            <div style="font-size:14px; font-weight:700; color:var(--text-primary);">${payment.planName || student?.planName || "Standard Plan"}</div>
            <div style="font-size:12px; color:var(--primary); font-weight:600; margin-top:2px;">${periodText} (${durationText})</div>
            <div style="font-size:11.5px; color:var(--text-muted); margin-top:4px;">New Expiry: <strong style="color:var(--accent-emerald, #10b981);">${payment.endDate || "Calculated on approval"}</strong></div>
          </div>
        </div>

        <!-- Payment Details & UTR -->
        <div style="background:var(--bg-card); border:1.5px solid var(--border); border-radius:12px; padding:14px; margin-bottom:1.25rem;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <div>
              <div style="font-size:11px; font-weight:700; text-transform:uppercase; color:var(--text-muted);">Amount To Verify</div>
              <div style="font-size:26px; font-weight:800; color:var(--text-primary); line-height:1.2;">₹${Number(payment.amount || 0).toLocaleString()}</div>
            </div>
            <div style="text-align:right;">
              <span class="badge" style="background:rgba(14,165,233,0.15); color:var(--primary); font-weight:700; padding:5px 12px; border-radius:8px; font-size:12px; border:1px solid rgba(14,165,233,0.3);">${payment.paymentMethod || "UPI"}</span>
            </div>
          </div>

          <div style="background:var(--bg-hover); border:1px dashed var(--border); border-radius:8px; padding:10px 12px; display:flex; justify-content:space-between; align-items:center;">
            <div>
              <span style="font-size:11px; color:var(--text-muted); text-transform:uppercase; font-weight:600;">Transaction UTR / Ref:</span>
              <div style="font-family:monospace; font-size:14px; font-weight:700; color:var(--text-primary); margin-top:2px;" id="rvm-utr-val">${payment.transactionId || "N/A"}</div>
            </div>
            ${payment.transactionId && payment.transactionId !== "CASH" ? `
              <button type="button" class="btn btn-ghost btn-sm" id="btn-copy-utr" style="font-size:11.5px; padding:4px 10px; border-radius:6px; border:1px solid var(--border); background:var(--bg-card); display:inline-flex; align-items:center; gap:5px;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                <span>Copy UTR</span>
              </button>
            ` : ''}
          </div>
        </div>

        <!-- Uploaded Screenshot Proof -->
        <div style="margin-bottom:1.25rem;">
          <div style="font-size:11px; font-weight:700; text-transform:uppercase; color:var(--text-muted); margin-bottom:6px; display:flex; justify-content:space-between;">
            <span>Student Payment Proof Screenshot</span>
            ${proofUrl ? `<a href="${proofUrl}" target="_blank" download="proof.jpg" style="color:var(--primary); font-size:11px; text-decoration:none;">Download Original</a>` : ''}
          </div>
          <div style="background:var(--bg-hover); border:1px solid var(--border); border-radius:10px; overflow:hidden; min-height:160px; max-height:260px; display:flex; align-items:center; justify-content:center; text-align:center; padding:8px;">
            ${proofUrl ? `
              <img src="${proofUrl}" alt="Proof" style="max-width:100%; max-height:240px; object-fit:contain; border-radius:6px; cursor:pointer;" onclick="window.viewPaymentScreenshots('${payment.id}')" title="Click to open full view" />
            ` : `
              <div style="padding:2rem; color:var(--text-muted); font-size:12.5px;">
                ${isCash ? "Cash renewal — collect cash at reception counter before approving." : "No screenshot proof was attached to this payment."}
              </div>
            `}
          </div>
        </div>

        <!-- Bank Account Verification Checklist Box -->
        <div style="background:rgba(14,165,233,0.08); border:1.5px solid rgba(14,165,233,0.3); border-radius:12px; padding:12px 16px; margin-bottom:1.5rem;">
          <div style="display:flex; align-items:center; gap:8px; font-weight:700; font-size:13px; color:var(--primary);">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
            <span>Bank Account Verification Checklist</span>
          </div>
          <div style="font-size:12px; color:var(--text-secondary); margin-top:6px; line-height:1.5;">
            1. Open your UPI app (PhonePe / Google Pay / Paytm) or Netbanking.<br>
            2. Match UTR: <strong style="font-family:monospace; color:var(--text-primary);">${payment.transactionId || 'CASH'}</strong> for ₹<strong style="color:var(--text-primary);">${payment.amount}</strong>.<br>
            3. Verify the sender name and amount match the uploaded screenshot.
          </div>
          <label style="display:flex; align-items:center; gap:10px; margin-top:10px; font-size:12.5px; font-weight:700; cursor:pointer; color:var(--text-primary); background:var(--bg-card); padding:8px 12px; border-radius:8px; border:1px solid var(--border);">
            <input type="checkbox" id="chk-bank-verify" style="width:17px; height:17px; accent-color:var(--accent-emerald, #10b981); cursor:pointer;" />
            <span>I confirm that ₹${payment.amount} is verified and credited in the bank account</span>
          </label>
        </div>

        <!-- Actions -->
        <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
          <button type="button" class="btn btn-ghost" id="btn-rvm-reject" style="color:var(--danger, #f43f5e); border:1px solid rgba(239,68,68,0.35); padding:8px 16px; font-size:13px; border-radius:8px;">Reject Request</button>
          <div style="display:flex; gap:8px;">
            <button type="button" class="btn btn-ghost" id="btn-rvm-cancel" style="padding:8px 16px; font-size:13px; border:1px solid var(--border); border-radius:8px;">Cancel</button>
            <button type="button" class="btn btn-primary" id="btn-rvm-approve" disabled style="background:var(--accent-emerald, #10b981); border:none; padding:8px 20px; font-size:13px; font-weight:700; opacity:0.5; cursor:not-allowed; border-radius:8px; color:#fff;">Approve & Restore Access</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(dialog);

    // Event Listeners for dialog
    dialog.querySelector("#rvm-close").onclick = () => dialog.close();
    dialog.querySelector("#btn-rvm-cancel").onclick = () => dialog.close();

    const chk = dialog.querySelector("#chk-bank-verify");
    const approveBtn = dialog.querySelector("#btn-rvm-approve");
    chk.onchange = () => {
      approveBtn.disabled = !chk.checked;
      approveBtn.style.opacity = chk.checked ? "1" : "0.5";
      approveBtn.style.cursor = chk.checked ? "pointer" : "not-allowed";
    };

    const copyBtn = dialog.querySelector("#btn-copy-utr");
    if (copyBtn) {
      copyBtn.onclick = () => {
        if (payment.transactionId) {
          navigator.clipboard.writeText(payment.transactionId);
          copyBtn.innerHTML = `<span>Copied</span>`;
          setTimeout(() => {
            copyBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><span>Copy UTR</span>`;
          }, 2000);
        }
      };
    }

    // Approve Handler
    approveBtn.onclick = async () => {
      approveBtn.disabled = true;
      approveBtn.innerText = "Approving...";
      const approver = localStorage.getItem("userName") || "Admin";
      const res = await approvePayment(payment.id, approver);
      if (res.success) {
        if (window.showToast) window.showToast("Renewal payment approved! Student access restored.", "success");
        dialog.close();
      } else {
        approveBtn.disabled = false;
        approveBtn.innerText = "Approve & Restore Access";
        if (window.showToast) window.showToast("Approval failed: " + res.error, "error");
      }
    };

    // Reject Handler
    dialog.querySelector("#btn-rvm-reject").onclick = async () => {
      const remark = await window.showCustomPrompt(
        "Reject Renewal Payment",
        "Please specify reason (e.g. 'Amount not received in bank account' or 'Invalid UTR'):",
        "Reject",
        true
      );
      if (remark === null) return;
      const approver = localStorage.getItem("userName") || "Admin";
      const res = await rejectPayment(payment.id, approver, remark);
      if (res.success) {
        if (window.showToast) window.showToast("Payment rejected and student notified.", "info");
        dialog.close();
      } else {
        if (window.showToast) window.showToast("Error rejecting payment: " + res.error, "error");
      }
    };

    dialog.addEventListener("close", () => dialog.remove());
    dialog.showModal();
  };

  // Global Actions for buttons
  window.handleApprovePayment = async (id) => {
    // Open verification modal so admin verifies bank account & proof
    window.openRenewalVerifyModal(id);
  };

  window.handleRejectPayment = async (id) => {
    const remark = await window.showCustomPrompt("Reject Payment", "Please enter reason for rejection (e.g. 'Payment not received in bank account'):", "Reject", true);
    if (remark === null) return;
    const approver = localStorage.getItem("userName") || "Admin";
    const res = await rejectPayment(id, approver, remark);
    if (!res.success) window.showToast("Error rejecting payment: " + res.error, "error");
    else window.showToast("Payment marked as rejected.", "info");
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
      document.getElementById("receive-payment-modal")?.close();
      document.getElementById("receive-payment-form")?.reset();
      if(typeof showToast === 'function') showToast("Payment received successfully!");
    } else {
      window.showToast("Error: " + res.error, "error");
    }
  };

  // Start Listener
  if (unsubscribe) unsubscribe();
  unsubscribe = listenToAllPayments((records) => {
    allPayments = (records || []).filter(r => !isDemoOrTestRecord(r));
    renderPaymentAdminTable();
  });
};

const renderPaymentAdminTable = () => {
  const tbody = document.getElementById("payment-table-body");
  if (!tbody) return;

  const role = localStorage.getItem("userRole") || "";
  const canApprove = !role || String(role).toLowerCase() !== "student";

  // Calculate Metrics
  let todayTotal = 0;
  let monthTotal = 0;
  let pendingRenewalsCount = 0;
  let pendingRenewalsAmount = 0;
  let receiptsIssued = 0;
  let totalRenewalsCount = 0;

  const now = new Date();
  const todayStr = now.toDateString();
  const month = now.getMonth();
  const year = now.getFullYear();

  allPayments.forEach(p => {
    const amt = parseFloat(p.amount) || 0;
    const d = p.date ? new Date(p.date) : new Date();
    const st = normalisePaymentStatus(p.status, p);
    const isRen = isRenewalRecord(p);
    
    if (isRen) totalRenewalsCount++;

    if (st.key === "pending") {
      if (isRen) {
        pendingRenewalsCount++;
        pendingRenewalsAmount += amt;
      }
    } else if (st.key === "approved") {
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
  const domPendingRen = document.getElementById("pay-pending-renewals");
  const domPendingRenAmt = document.getElementById("pay-pending-renewals-amt");
  const domReceipts = document.getElementById("pay-receipts");
  const domCountTabAll = document.getElementById("count-tab-all");
  const domCountTabRen = document.getElementById("count-tab-renewals");
  const bannerAlert = document.getElementById("renewal-alert-banner");
  const bannerCount = document.getElementById("renewal-banner-count");

  if (domToday) domToday.innerText = "₹" + todayTotal.toLocaleString();
  if (domMonth) domMonth.innerText = "₹" + monthTotal.toLocaleString();
  if (domPendingRen) domPendingRen.innerText = pendingRenewalsCount;
  if (domPendingRenAmt) domPendingRenAmt.innerText = `₹${pendingRenewalsAmount.toLocaleString()} awaiting verification`;
  if (domReceipts) domReceipts.innerText = receiptsIssued;
  if (domCountTabAll) domCountTabAll.innerText = `(${allPayments.length})`;
  if (domCountTabRen) {
    domCountTabRen.innerText = `${pendingRenewalsCount}`;
    if (pendingRenewalsCount > 0) {
      domCountTabRen.style.background = "rgba(245,158,11,0.18)";
      domCountTabRen.style.color = "var(--accent-amber, #fbbf24)";
      domCountTabRen.style.border = "1px solid rgba(245,158,11,0.35)";
    } else {
      domCountTabRen.style.background = "var(--bg-hover)";
      domCountTabRen.style.color = "var(--text-muted)";
      domCountTabRen.style.border = "1px solid var(--border)";
    }
  }

  // Show/Hide Attention Banner
  if (bannerAlert) {
    if (pendingRenewalsCount > 0) {
      bannerAlert.style.display = "flex";
      if (bannerCount) bannerCount.innerText = pendingRenewalsCount;
    } else {
      bannerAlert.style.display = "none";
    }
  }

  // Filter Data
  let filtered = allPayments;

  // View Filter: All Transactions vs Renewal Requests
  if (currentFilters.view === "renewals") {
    // The Renewal Requests tab directly displays incoming renewal requests awaiting verification!
    // No need to manually select 'Pending' from the dropdown.
    if (currentFilters.status === "approved" || currentFilters.status === "rejected") {
      filtered = filtered.filter(r => isRenewalRecord(r) && normalisePaymentStatus(r.status, r).key === currentFilters.status);
    } else {
      // Default (including when dropdown is 'All' or 'pending'): strictly pending renewal requests!
      filtered = filtered.filter(r => isRenewalRecord(r) && normalisePaymentStatus(r.status, r).key === "pending");
    }
  } else {
    // In All Transactions, apply Status Filter if specified
    if (currentFilters.status !== "All") {
      filtered = filtered.filter(r => normalisePaymentStatus(r.status, r).key === currentFilters.status);
    }
  }

  // Search Filter
  if (currentFilters.search.trim() !== "") {
    const q = currentFilters.search.toLowerCase();
    filtered = filtered.filter(r => {
      const name = (r.studentName || "").toLowerCase();
      const txn = (r.transactionId || "").toLowerCase();
      const plan = (r.planName || "").toLowerCase();
      return name.includes(q) || txn.includes(q) || plan.includes(q);
    });
  }

  // Sort: Put pending renewals at the top so admin verifies them first
  filtered.sort((a, b) => {
    const aPending = normalisePaymentStatus(a.status, a).key === "pending" ? 1 : 0;
    const bPending = normalisePaymentStatus(b.status, b).key === "pending" ? 1 : 0;
    if (bPending !== aPending) return bPending - aPending;
    return new Date(b.date || 0) - new Date(a.date || 0);
  });

  if (filtered.length === 0) {
    if (currentFilters.view === "renewals") {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align:center; padding:3.5rem 1rem; color:var(--text-muted);">
            <div style="width:48px; height:48px; border-radius:50%; background:rgba(16,185,129,0.15); color:var(--success, #10b981); border:1px solid rgba(16,185,129,0.3); display:inline-flex; align-items:center; justify-content:center; margin-bottom:12px;">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <div style="font-weight:700; font-size:15px; color:var(--text-primary); margin-bottom:4px;">No Pending Renewal Requests</div>
            <div style="font-size:12.5px; color:var(--text-secondary); max-width:420px; margin:0 auto; line-height:1.45;">All renewal requests have been verified and processed. When a student submits a new renewal, it will appear here for bank verification and approval.</div>
          </td>
        </tr>
      `;
    } else {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:2.5rem; color: var(--text-muted);">No matching transactions found.</td></tr>`;
    }
    return;
  }

  let html = "";
  filtered.forEach(r => {
    const isPayLater = isPayLaterRecord(r);
    const st = normalisePaymentStatus(r.status, r);
    const isPending = st.key === "pending";
    const isRejected = st.key === "rejected";
    const statusText = st.label;
    const statusStyle = STATUS_STYLES[st.tone] || STATUS_STYLES.unknown;
    const isRen = isRenewalRecord(r);
    const recordShots = extractRecordScreenshots(r);
    const hasProof = recordShots.length > 0;

    // Period / duration
    const periodDisplay = (r.startDate && r.endDate)
      ? `${r.startDate} to ${r.endDate}`
      : (r.durationDays ? `${r.durationDays} Days` : (r.renewalMonths ? `${r.renewalMonths} Mo` : "—"));

    html += `
      <tr style="border-bottom:1px solid var(--border); ${isPending && isRen ? 'background:rgba(245,158,11,0.03);' : ''}">
        <td style="padding:14px;">
          ${isRen 
            ? `<span class="badge" style="background:rgba(245,158,11,0.16); color:var(--accent-amber, #fbbf24); border:1px solid rgba(245,158,11,0.35); font-size:11px; font-weight:700; padding:2px 7px; border-radius:6px; display:inline-flex; align-items:center; gap:3px;"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/></svg> Renewal</span>` 
            : `<span class="badge" style="background:var(--bg-hover); color:var(--text-secondary); border:1px solid var(--border); font-size:11px; padding:2px 7px; border-radius:6px;">Regular</span>`}
        </td>
        <td style="padding:14px; font-weight:600; color:var(--text-primary);">
          <div style="font-size:13.5px; font-weight:700; color:var(--text-primary);">${r.studentName || "Unknown"}</div>
        </td>
        <td style="padding:14px;">
          <div style="font-weight:600; color:var(--text-primary); font-size:12.5px;">${r.planName || "Standard Plan"}</div>
          <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">${periodDisplay}</div>
        </td>
        <td style="padding:14px;">
          <div style="font-weight:600; font-size:12px;">${r.paymentMethod || "UPI"}</div>
          <div style="font-family:monospace; font-size:11.5px; color:var(--text-secondary); margin-top:2px; display:flex; align-items:center; gap:4px;">
            <span>${/rc-imp/i.test(r.transactionId || "") ? "—" : (r.transactionId || "—")}</span>
            ${r.transactionId && r.transactionId !== "CASH" && r.transactionId !== "PAY LATER" ? `<span title="Click to copy UTR" onclick="navigator.clipboard.writeText('${r.transactionId}'); showToast('UTR copied');" style="cursor:pointer; opacity:0.7; display:inline-flex; align-items:center;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></span>` : ''}
          </div>
        </td>
        <td style="padding:14px; font-weight:700; color:var(--text-primary); text-align:right; font-size:13.5px;">₹${Number(r.amount || 0).toLocaleString()}</td>
        <td style="padding:14px; font-size:12px; color:var(--text-muted);">${
          (() => {
            const raw = r.date || r.paymentDate || (r.createdAt && r.createdAt.seconds ? r.createdAt.seconds * 1000 : null);
            if (!raw) return "—";
            const d = new Date(raw);
            return isNaN(d.getTime()) ? "—" : d.toISOString().split('T')[0];
          })()
        }</td>
        <td style="padding:14px; text-align:center;">
          <span style="${statusStyle} padding:3px 10px; border-radius:999px; font-size:11px; font-weight:700; display:inline-block;">${statusText}</span>
        </td>
        <td style="padding:14px; text-align:right;">
          <div style="display:inline-flex; align-items:center; gap:6px; justify-content:flex-end;">
            ${(isPending && canApprove && !isPayLater) ? `
              <button class="btn btn-primary btn-sm" onclick="window.openRenewalVerifyModal('${r.id}')" style="font-size:11.5px; padding:5px 12px; border-radius:8px; display:inline-flex; align-items:center; gap:4px; font-weight:700; box-shadow:0 1px 4px rgba(0,0,0,0.15);" title="Review proof and verify bank account">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Verify & Approve
              </button>
              <button class="btn btn-ghost btn-sm" onclick="window.handleRejectPayment('${r.id}')" style="font-size:11px; padding:5px 8px; color:var(--danger); border-radius:6px; display:inline-flex; align-items:center;" title="Reject Request"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
            ` : `
              <div style="display:inline-flex; align-items:center; gap:6px;">
                ${(!isPending && !isRejected && !isPayLater) ? `
                  <button class="btn btn-secondary btn-sm" onclick="window.downloadAdminPaymentInvoice('${r.id}')" style="font-size:11.5px; padding:4px 8px; border-radius:6px; font-weight:600; display:inline-flex; align-items:center; gap:4px;" title="Download E-Invoice PDF">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    <span>Invoice</span>
                  </button>
                ` : (isPayLater ? `
                  <div style="display:inline-flex; align-items:center; gap:6px;">
                    <span style="font-size:11px; color:#ea580c; font-weight:600; padding:2px 8px; background:rgba(249,115,22,0.08); border-radius:4px; border:1px solid rgba(249,115,22,0.25);">Payment Due</span>
                    <button class="btn btn-primary btn-sm" onclick="window.openCollectPayLaterModal('${r.id}')" style="font-size:11.5px; padding:4px 10px; background:#16a34a; border-color:#16a34a; color:#fff; font-weight:700; border-radius:6px; display:inline-flex; align-items:center; gap:4px; cursor:pointer;" title="Collect and settle fee payment">
                      Collect Fee
                    </button>
                  </div>
                ` : '')}
                ${hasProof ? `
                  <button class="btn btn-ghost btn-sm" onclick="window.viewPaymentScreenshots('${r.id}')" style="font-size:11.5px; padding:4px 8px; border:1px solid var(--border); border-radius:6px; color:var(--primary); font-weight:600; display:inline-flex; align-items:center; gap:4px;">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                    <span>Proof</span>
                  </button>
                ` : ''}
              </div>
            `}
          </div>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
};

window.downloadAdminPaymentInvoice = async (paymentId) => {
  const r = (typeof allPayments !== "undefined" && Array.isArray(allPayments))
    ? allPayments.find(p => p.id === paymentId) || { id: paymentId }
    : { id: paymentId };
  if (isPayLaterRecord(r)) {
    if (window.showToast) window.showToast("Cannot generate invoice: Student fee has not been paid (Pay Later).", "warning");
    return;
  }
  try {
    if (typeof window.openReceiptModal === "function") {
      await window.openReceiptModal(r);
    } else {
      const { openReceiptModal } = await import("./receiptService.js?v=" + Date.now());
      await openReceiptModal(r);
    }
  } catch (e) {
    console.error("Download admin invoice error:", e);
    if (window.showToast) window.showToast("Failed to open invoice: " + e.message, "error");
  }
};

// Export functions
window.handlePaymentExport = async (format) => {
  try {
    const { exportToCSV, exportToExcel, exportToPDF } = await import("./exportService.js");
    
    let filtered = allPayments;
    if (currentFilters.view === "renewals") {
      filtered = filtered.filter(r => normalisePaymentStatus(r.status, r).key === "pending" && isRenewalRecord(r));
    } else if (currentFilters.status !== "All") {
      filtered = filtered.filter(r => normalisePaymentStatus(r.status, r).key === currentFilters.status);
    }
    if (currentFilters.search.trim() !== "") {
      const q = currentFilters.search.toLowerCase();
      filtered = filtered.filter(r => {
        const name = (r.studentName || "").toLowerCase();
        const txn = (r.transactionId || "").toLowerCase();
        return name.includes(q) || txn.includes(q);
      });
    }

    const rows = filtered.map(r => {
      const statusText = normalisePaymentStatus(r.status, r).label;
      const date = (() => {
        const raw = r.date || r.paymentDate || (r.createdAt && r.createdAt.seconds ? r.createdAt.seconds * 1000 : null);
        if (!raw) return "N/A";
        const d = new Date(raw);
        return isNaN(d.getTime()) ? "N/A" : d.toISOString().split('T')[0];
      })();

      return {
        "Type": isRenewalRecord(r) ? "Renewal" : "Payment",
        "Transaction ID": r.transactionId || "RC-N/A",
        "Student": r.studentName || "Unknown",
        "Plan": r.planName || "Unknown Plan",
        "Method": r.paymentMethod || "Cash",
        "Amount": r.amount,
        "Date": date,
        "Status": statusText
      };
    });

    const filename = `payments_renewals_export_${new Date().toISOString().split('T')[0]}`;
    if (format === 'csv') exportToCSV(filename, rows);
    else if (format === 'excel') await exportToExcel(filename, rows);
    else if (format === 'pdf') await exportToPDF(filename, 'Payments & Renewals Report', rows);
  } catch (err) {
    console.error("Export Error:", err);
    if (typeof showToast === 'function') showToast("Export failed: " + err.message, "error");
  }
};
