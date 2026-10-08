import { listenToVisitors, addVisitor, updateVisitorStatus, setVisitorLeadStatus, deleteVisitor, seedInitialPurposes, listenToVisitorPurposes } from "./visitorService.js";
import { calculateVisitorAnalytics } from "./visitorAnalytics.js";

let allVisitors = [];
let allPurposes = [];
let unsubPurposes = null;
let unsubVisitors = null;

// The table always renders 10 columns; the Actions column only exists for
// staff who may edit. Used for the empty/loading rows' colspan.
const COLS = (canEdit) => (canEdit ? 11 : 10);

const esc = (v) => String(v == null ? "" : v)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const normaliseSource = (v) => (v && v.source === "Website" ? "Website" : "Walk-in");

export const initVisitorAdminUI = async () => {
  const container = document.getElementById("page-visitors");
  if (!container) return;

  const role = localStorage.getItem("userRole");
  if (role === "Student") return; // Blocked

  const canEdit = (role === "Owner/Admin" || role === "Manager");
  const canDelete = (role === "Owner/Admin");

  // Seed default purposes
  await seedInitialPurposes();

  container.innerHTML = `
    <div class="page-header" style="display:flex; justify-content:space-between; align-items:center;">
      <div>
        <h1>Visitor Management</h1>
        <p class="page-subtitle">Track walk-ins, website leads, inquiries, and analytics</p>
      </div>
      <div>
        <button class="btn btn-primary" id="btn-add-visitor">+ Add Visitor</button>
      </div>
    </div>

    <!-- Analytics Dashboard -->
    <div class="metrics-grid" style="margin-bottom: 2rem;">
      <div class="metric-card">
        <div class="metric-info">
          <div class="metric-label">Today's Visitors</div>
          <div class="metric-value" id="vis-metric-today">0</div>
        </div>
      </div>
      <div class="metric-card">
        <div class="metric-info">
          <div class="metric-label">Weekly Visitors</div>
          <div class="metric-value" id="vis-metric-weekly">0</div>
        </div>
      </div>
      <div class="metric-card">
        <div class="metric-info">
          <div class="metric-label">Monthly Visitors</div>
          <div class="metric-value" id="vis-metric-monthly">0</div>
        </div>
      </div>
      <div class="metric-card">
        <div class="metric-info">
          <div class="metric-label">Total Visitors</div>
          <div class="metric-value" id="vis-metric-total">0</div>
        </div>
      </div>
      <div class="metric-card">
        <div class="metric-info">
          <div class="metric-label">Website Leads</div>
          <div class="metric-value" id="vis-metric-website">0</div>
        </div>
      </div>
    </div>

    <!-- Visitor List Tab -->
    <div class="card" style="margin-bottom: 2rem;">
      <div class="toolbar" style="flex-wrap:wrap; gap:1rem;">
        <div class="search-box">
          <input type="text" id="vis-search" placeholder="Search by name, phone, email..." />
        </div>
        <div>
          <select id="vis-filter-purpose" class="input-field" style="width:150px;">
            <option value="All">All Purposes</option>
          </select>
        </div>
        <div>
          <select id="vis-filter-source" class="input-field" style="width:140px;">
            <option value="All">All Sources</option>
            <option value="Website">Website</option>
            <option value="Walk-in">Walk-in</option>
          </select>
        </div>
        <div>
          <select id="vis-filter-lead" class="input-field" style="width:150px;">
            <option value="All">All Lead Statuses</option>
            <option value="New">New</option>
            <option value="Converted">Converted</option>
            <option value="Closed">Closed</option>
          </select>
        </div>
        <div>
          <select id="vis-filter-status" class="input-field" style="width:150px;">
            <option value="All">All Statuses</option>
            <option value="Active">Active</option>
            <option value="Completed">Completed</option>
          </select>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Date/Time</th>
              <th>Visitor Name</th>
              <th>Email</th>
              <th data-i18n="table.phone">\${window.t ? window.t("table.phone") : "Phone"}</th>
              <th>Purpose</th>
              <th>Plan</th>
              <th>Handled By</th>
              <th>Source</th>
              <th>Lead Status</th>
              <th data-i18n="table.status">\${window.t ? window.t("table.status") : "Status"}</th>
              ${canEdit ? `<th>Actions</th>` : ""}
            </tr>
          </thead>
          <tbody id="visitor-tbody">
            <tr><td colspan="${COLS(canEdit)}" style="text-align:center; padding: 2rem;">Loading...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Add Visitor Modal -->
    <dialog id="add-visitor-modal" class="card" style="border:none; border-radius:12px; padding:0; box-shadow:0 10px 30px rgba(0,0,0,0.5); background: var(--bg-card); color: var(--text-primary);">
      <div style="padding: 1.5rem; min-width: 400px; max-width: 500px; max-height: 85vh; overflow-y: auto;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
          <h2 style="margin: 0;">Add New Visitor</h2>
          <button class="btn btn-ghost" onclick="document.getElementById('add-visitor-modal').close()" style="padding: 0.25rem 0.5rem;">✕</button>
        </div>
        <form id="add-visitor-form" onsubmit="event.preventDefault(); window.submitVisitorForm()">
          <div class="form-group" style="margin-bottom: 1rem;">
            <label style="display:block; margin-bottom:0.25rem; font-size:0.875rem; font-weight:600; color:var(--text-secondary);">Visitor Name</label>
            <input type="text" id="add-vis-name" required placeholder="Enter visitor name" class="input-field" style="width: 100%; box-sizing: border-box;" />
          </div>
          <div class="form-group" style="margin-bottom: 1rem;">
            <label style="display:block; margin-bottom:0.25rem; font-size:0.875rem; font-weight:600; color:var(--text-secondary);">Phone Number</label>
            <input type="tel" id="add-vis-phone" required placeholder="10-digit phone number" pattern="[0-9]{10}" class="input-field" style="width: 100%; box-sizing: border-box;" />
          </div>
          <div class="form-group" style="margin-bottom: 1rem;">
            <label style="display:block; margin-bottom:0.25rem; font-size:0.875rem; font-weight:600; color:var(--text-secondary);">Email (Optional)</label>
            <input type="email" id="add-vis-email" placeholder="visitor@example.com" class="input-field" style="width: 100%; box-sizing: border-box;" />
          </div>
          <div class="form-group" style="margin-bottom: 1rem;">
            <label style="display:block; margin-bottom:0.25rem; font-size:0.875rem; font-weight:600; color:var(--text-secondary);">Purpose</label>
            <select id="add-vis-purpose" required class="input-field" style="width: 100%; box-sizing: border-box;">
              <!-- Populated dynamically -->
            </select>
          </div>
          <div class="form-group" style="margin-bottom: 1rem;">
            <label style="display:block; margin-bottom:0.25rem; font-size:0.875rem; font-weight:600; color:var(--text-secondary);">Handled By</label>
            <input type="text" id="add-vis-employee" required placeholder="Employee name" class="input-field" style="width: 100%; box-sizing: border-box;" />
          </div>
          <div class="form-group" style="margin-bottom: 1.5rem;">
            <label style="display:block; margin-bottom:0.25rem; font-size:0.875rem; font-weight:600; color:var(--text-secondary);">Remarks (Optional)</label>
            <textarea id="add-vis-remarks" rows="2" placeholder="Any additional notes..." class="input-field" style="width: 100%; box-sizing: border-box;"></textarea>
          </div>
          <div style="display: flex; justify-content: flex-end; gap: 0.5rem;">
            <button type="button" class="btn btn-ghost" onclick="document.getElementById('add-visitor-modal').close()">Cancel</button>
            <button type="submit" class="btn btn-primary" id="btn-save-visitor">Save Visitor</button>
          </div>
        </form>
      </div>
    </dialog>
  `;

  // Attach Filter Listeners
  const renderVis = () => renderVisitors(canEdit, canDelete);
  document.getElementById("vis-search").addEventListener("input", renderVis);
  document.getElementById("vis-filter-purpose").addEventListener("change", renderVis);
  document.getElementById("vis-filter-source").addEventListener("change", renderVis);
  document.getElementById("vis-filter-lead").addEventListener("change", renderVis);
  document.getElementById("vis-filter-status").addEventListener("change", renderVis);

  // Add Button
  document.getElementById("btn-add-visitor").addEventListener("click", () => handleAddVisitor());

  // Listeners
  if (unsubPurposes) unsubPurposes();
  unsubPurposes = listenToVisitorPurposes((purposes) => {
    allPurposes = purposes;
    populatePurposeDropdown();
  });

  if (unsubVisitors) unsubVisitors();
  unsubVisitors = listenToVisitors((records) => {
    allVisitors = records;
    updateAnalyticsUI();
    renderVis();
  });
};

const populatePurposeDropdown = () => {
  const filterSelect = document.getElementById("vis-filter-purpose");
  if (!filterSelect) return;
  const currentVal = filterSelect.value;
  
  let html = `<option value="All">All Purposes</option>`;
  allPurposes.forEach(p => {
    html += `<option value="${p.name}">${p.name}</option>`;
  });
  filterSelect.innerHTML = html;
  filterSelect.value = currentVal;
};

const updateAnalyticsUI = () => {
  const stats = calculateVisitorAnalytics(allVisitors);
  if (document.getElementById("vis-metric-today")) document.getElementById("vis-metric-today").innerText = stats.todayCount;
  if (document.getElementById("vis-metric-weekly")) document.getElementById("vis-metric-weekly").innerText = stats.weeklyCount;
  if (document.getElementById("vis-metric-monthly")) document.getElementById("vis-metric-monthly").innerText = stats.monthlyCount;
  if (document.getElementById("vis-metric-total")) document.getElementById("vis-metric-total").innerText = stats.totalCount;
  const websiteLeads = allVisitors.filter(v => normaliseSource(v) === "Website").length;
  if (document.getElementById("vis-metric-website")) document.getElementById("vis-metric-website").innerText = websiteLeads;
};

const getFilteredVisitors = () => {
  let filtered = [...allVisitors];
  const search = document.getElementById("vis-search").value.toLowerCase();
  const purpose = document.getElementById("vis-filter-purpose").value;
  const source = document.getElementById("vis-filter-source").value;
  const lead = document.getElementById("vis-filter-lead").value;
  const status = document.getElementById("vis-filter-status").value;

  if (search) {
    filtered = filtered.filter(v =>
      (v.visitorName || "").toLowerCase().includes(search) ||
      (v.phone || "").includes(search) ||
      (v.email || "").toLowerCase().includes(search) ||
      (v.planName || "").toLowerCase().includes(search) ||
      (v.employeeName && v.employeeName.toLowerCase().includes(search))
    );
  }
  if (purpose !== "All") filtered = filtered.filter(v => v.purpose === purpose);
  if (source !== "All") filtered = filtered.filter(v => normaliseSource(v) === source);
  // Website leads always carry an explicit leadStatus; rows without one are
  // plain walk-ins and only match when the filter is set to "All".
  if (lead !== "All") filtered = filtered.filter(v => (v.leadStatus || "") === lead);
  if (status !== "All") filtered = filtered.filter(v => v.status === status);

  return filtered;
};

const renderVisitors = (canEdit, canDelete) => {
  const tbody = document.getElementById("visitor-tbody");
  if (!tbody) return;

  const filtered = getFilteredVisitors();

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${COLS(canEdit)}" style="text-align:center;">No visitors found.</td></tr>`;
    return;
  }

  window.handleCompleteVisit = async (id) => {
    await updateVisitorStatus(id, "Completed");
  };

  window.handleLeadStatus = async (id, leadStatus) => {
    const res = await setVisitorLeadStatus(id, leadStatus);
    if (!res.success) window.showToast(res.error, "error");
  };

  window.handleDeleteVisitor = async (id) => {
    const confirmed = await window.showCustomConfirm("Delete Visitor", "Delete this visitor record?", "Delete", true);
    if (confirmed) {
      const res = await deleteVisitor(id);
      if (!res.success) window.showToast(res.error, "error");
    }
  };

  let html = "";
  filtered.forEach(v => {
    const isCompleted = v.status === "Completed";
    const badgeClass = isCompleted ? "badge-paid" : "badge-pending";
    const isWebsite = normaliseSource(v) === "Website";
    const leadStatus = v.leadStatus || "";

    let actions = "";
    if (canEdit) {
      if (!isCompleted) {
        actions += `<button class="btn btn-secondary" style="padding:0.25rem 0.5rem; font-size:0.75rem;" onclick="window.handleCompleteVisit('${v.id}')">Mark Completed</button> `;
      }
      // Website leads move through New -> Converted / Closed.
      if (isWebsite) {
        if (leadStatus !== "Converted") {
          actions += `<button class="btn btn-secondary" style="padding:0.25rem 0.5rem; font-size:0.75rem; color:var(--accent-emerald);" onclick="window.handleLeadStatus('${v.id}', 'Converted')">Mark Converted</button> `;
        }
        if (leadStatus !== "Closed") {
          actions += `<button class="btn btn-secondary" style="padding:0.25rem 0.5rem; font-size:0.75rem; color:var(--text-muted);" onclick="window.handleLeadStatus('${v.id}', 'Closed')">Close</button> `;
        }
      }
      if (canDelete) {
        actions += `<button class="btn btn-secondary" style="padding:0.25rem 0.5rem; font-size:0.75rem; color:var(--danger);" onclick="window.handleDeleteVisitor('${v.id}')" data-i18n="btn.delete">${window.t ? window.t("btn.delete") : "Delete"}</button>`;
      }
    }

    const sourceBadge = isWebsite
      ? `<span class="badge badge-info">Website</span>`
      : `<span class="badge" style="background:var(--bg-hover); color:var(--text-secondary); border:1px solid var(--border);">Walk-in</span>`;

    let leadBadge = `<span style="color:var(--text-muted);">—</span>`;
    if (leadStatus === "New") leadBadge = `<span class="badge badge-pending">New</span>`;
    else if (leadStatus === "Converted") leadBadge = `<span class="badge badge-paid">Converted</span>`;
    else if (leadStatus === "Closed") leadBadge = `<span class="badge badge-overdue">Closed</span>`;

    const planCell = v.planName
      ? `<span style="white-space:normal;">${esc(v.planName)}</span>`
      : `<span style="color:var(--text-muted);">—</span>`;

    const note = [v.remarks, isWebsite ? v.message : ""].filter(Boolean).map(esc).join("<br>");

    html += `
      <tr style="opacity: ${isCompleted ? '0.7' : '1'}">
        <td>${v.visitDate || ""}<br><small style="color:var(--text-muted)">${v.visitTime || ""}</small></td>
        <td style="font-weight:600;">${esc(v.visitorName)}${note ? `<br><small style="font-weight:400; color:var(--text-muted)">${note}</small>` : ""}</td>
        <td style="font-size:0.85rem; word-break:break-word;">${v.email ? esc(v.email) : `<span style="color:var(--text-muted);">—</span>`}</td>
        <td>${esc(v.phone)}</td>
        <td>${esc(v.purpose)}</td>
        <td style="font-size:0.85rem;">${planCell}</td>
        <td style="font-size:0.8rem; color:var(--text-muted);">${v.employeeName ? esc(v.employeeName) : "—"}</td>
        <td>${sourceBadge}</td>
        <td>${leadBadge}</td>
        <td><span class="badge ${badgeClass}">${v.status || "Active"}</span></td>
        ${canEdit ? `<td style="white-space:nowrap;">${actions}</td>` : ""}
      </tr>
    `;
  });

  tbody.innerHTML = html;
};

const handleAddVisitor = async () => {
  if (allPurposes.length === 0) {
    return window.showToast(window.t ? window.t('No purposes available.') || "No purposes available." : "No purposes available.", "warning");
  }

  // Populate purposes dropdown
  const purposeSelect = document.getElementById("add-vis-purpose");
  if (purposeSelect) {
    purposeSelect.innerHTML = allPurposes.map(p => `<option value="${p.name}">${p.name}</option>`).join("");
  }

  // Set default employee name
  const currentUser = localStorage.getItem("userName") || "Admin";
  document.getElementById("add-vis-employee").value = currentUser;

  // Clear other fields
  document.getElementById("add-vis-name").value = "";
  document.getElementById("add-vis-phone").value = "";
  document.getElementById("add-vis-email").value = "";
  document.getElementById("add-vis-remarks").value = "";

  document.getElementById("add-visitor-modal").showModal();
};

window.submitVisitorForm = async () => {
  const name = document.getElementById("add-vis-name").value.trim();
  const phone = document.getElementById("add-vis-phone").value.trim();
  const email = document.getElementById("add-vis-email") ? document.getElementById("add-vis-email").value.trim() : "";
  const purpose = document.getElementById("add-vis-purpose").value;
  const employeeName = document.getElementById("add-vis-employee").value.trim();
  const remarks = document.getElementById("add-vis-remarks").value.trim();

  if (!name || !phone || !purpose || !employeeName) {
    window.showToast(window.t ? window.t('Please fill in all required fields.') || "Please fill in all required fields." : "Please fill in all required fields.", "warning");
    return;
  }

  const btn = document.getElementById("btn-save-visitor");
  const originalText = btn.innerText;
  btn.innerText = "Saving...";
  btn.disabled = true;

  const data = {
    visitorName: name,
    phone,
    email,
    purpose,
    employeeName,
    remarks,
    // Manual entries are always walk-ins; website leads are written by the
    // public site itself. Walk-ins deliberately carry no leadStatus so the
    // lead-status filter only ever matches real website leads.
    source: "Walk-in"
  };

  const authorId = localStorage.getItem("userId") || "admin";
  const res = await addVisitor(data, authorId);
  
  btn.innerText = originalText;
  btn.disabled = false;

  if (!res.success) {
    window.showToast(((window.t && window.t('Error: ')) || "Error: ") + res.error, "error");
  } else {
    document.getElementById("add-visitor-modal").close();
    if(typeof showToast === 'function') showToast("Visitor added successfully!");
  }
};
