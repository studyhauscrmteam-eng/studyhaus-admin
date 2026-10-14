import { listenToOldStudents, restoreOldStudent } from "./oldStudentService.js";
import { permanentlyDeleteStudent } from "./studentService.js";
import { getStudentPhotoUrl } from "./studentProfile.js";
import { generateOldStudentsPDF } from "./pdfService.js";

let allOldStudents = [];

export const initOldStudentAdminUI = () => {
  const container = document.getElementById("page-old-students");
  if (!container) return;

  const role = localStorage.getItem("userRole");
  if (role === "Student") return; // Blocked

  const canRestore = (role === "Owner/Admin" || role === "Manager");
  const canErase = (role === "Owner/Admin");

  container.innerHTML = `
    <div class="page-header" style="display:flex; justify-content:space-between; align-items:center;">
      <div>
        <h1>Old Students</h1>
        <p class="page-subtitle">View and restore past members. History is preserved permanently.</p>
      </div>
    </div>

    <div class="card" style="margin-bottom: 2rem;">
      <div class="toolbar" style="flex-wrap:wrap; gap:1rem;">
        <div class="search-box">
          <input type="text" id="old-search" placeholder="Search name or phone..." />
        </div>
        <div>
          <select id="old-filter-reason" class="input-field" style="width:180px;">
            <option value="All">All Reasons</option>
          </select>
        </div>
        <div>
          <select id="old-filter-plan" class="input-field" style="width:180px;">
            <option value="All">All Plans</option>
          </select>
        </div>
        <div style="margin-left: auto;">
          <button class="btn btn-secondary" onclick="window.exportOldStudentsPDF()">Export PDF</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Student Info</th>
              <th>Last Plan</th>
              <th>Exit Date</th>
              <th>Exit Reason</th>
              ${canRestore ? `<th>Actions</th>` : ""}
            </tr>
          </thead>
          <tbody id="old-tbody">
            <tr><td colspan="${canRestore ? '5' : '4'}" style="text-align:center;">Loading old students...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Attach Listeners
  const renderList = () => renderOldStudents(canRestore, canErase);
  document.getElementById("old-search").addEventListener("input", renderList);
  document.getElementById("old-filter-reason").addEventListener("change", renderList);
  document.getElementById("old-filter-plan").addEventListener("change", renderList);

  window.exportOldStudentsPDF = () => {
    const records = getFilteredOldStudents();
    generateOldStudentsPDF(records);
  };

  listenToOldStudents((records) => {
    allOldStudents = records;
    populateReasonDropdown();
    populatePlanDropdown();
    renderList();
  });
};

const populatePlanDropdown = () => {
  const filterSelect = document.getElementById("old-filter-plan");
  if (!filterSelect) return;
  const currentVal = filterSelect.value;

  const plans = new Set();
  allOldStudents.forEach(s => {
    if (s.planName && String(s.planName).trim()) plans.add(String(s.planName).trim());
  });

  let html = `<option value="All">All Plans</option>`;
  Array.from(plans).sort().forEach(p => {
    html += `<option value="${p}">${p}</option>`;
  });

  filterSelect.innerHTML = html;
  filterSelect.value = currentVal || "All";
};

const populateReasonDropdown = () => {
  const filterSelect = document.getElementById("old-filter-reason");
  if (!filterSelect) return;
  const currentVal = filterSelect.value;
  
  const reasons = new Set();
  allOldStudents.forEach(s => {
    if (s.exitReason) reasons.add(s.exitReason);
  });

  let html = `<option value="All">All Reasons</option>`;
  Array.from(reasons).sort().forEach(r => {
    html += `<option value="${r}">${r}</option>`;
  });
  
  filterSelect.innerHTML = html;
  filterSelect.value = currentVal || "All";
};

const getFilteredOldStudents = () => {
  let filtered = [...allOldStudents];
  const search = document.getElementById("old-search").value.toLowerCase();
  const reason = document.getElementById("old-filter-reason").value;
  const plan = document.getElementById("old-filter-plan") ? document.getElementById("old-filter-plan").value : "All";

  if (search) {
    filtered = filtered.filter(s =>
      (s.name && s.name.toLowerCase().includes(search)) ||
      (s.phone && s.phone.includes(search))
    );
  }
  if (reason !== "All") filtered = filtered.filter(s => s.exitReason === reason);
  if (plan !== "All") filtered = filtered.filter(s => String(s.planName || "").trim() === plan);

  return filtered;
};

const renderOldStudents = (canRestore, canErase) => {
  const tbody = document.getElementById("old-tbody");
  if (!tbody) return;

  const filtered = getFilteredOldStudents();

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${canRestore ? '5' : '4'}" style="text-align:center;">No old students found.</td></tr>`;
    return;
  }

  window.handleRestoreStudent = async (id, name) => {
    const confirmed = await window.showCustomConfirm("Restore Student", `Restore ${name} to Active Students?<br><br>They will be restored without an assigned seat.`);
    if (confirmed) {
      const res = await restoreOldStudent(id);
      if (!res.success) window.showToast("Error restoring student: " + res.error, "error");
    }
  };

  window.handlePermanentDeleteOld = async (id, name) => {
    const first = await window.showCustomConfirm(
      "Delete Permanently?",
      `Permanently delete <b>${name}</b>?<br><br>This erases the record completely. <b>This cannot be undone.</b>`,
      "Continue",
      true
    );
    if (!first) return;
    const second = await window.showCustomConfirm("Final Confirmation", `Really erase <b>${name}</b> forever?`, "Delete Forever", true);
    if (!second) return;
    const res = await permanentlyDeleteStudent(id);
    if (res.success) window.showToast(`Permanently deleted ${name}.`, "success");
    else window.showToast("Error: " + res.error, "error");
  };

  let html = "";
  filtered.forEach(s => {
    const initials = s.name ? s.name.substring(0, 2).toUpperCase() : "??";
    const photo = getStudentPhotoUrl(s);

    html += `
      <tr>
        <td>
          <div class="student-cell" style="cursor:pointer;" onclick="window.openStudentProfileById('${s.id}')" title="Open student card">
            ${photo
              ? `<img src="${photo}" class="avatar-sm" style="object-fit:cover;" alt="" />`
              : `<div class="avatar-sm" style="background:var(--bg-hover); color:var(--text-secondary)">${initials}</div>`}
            <div>
              <div class="name" style="text-decoration:underline dotted; text-underline-offset:3px;">${s.name || "Unknown"}</div>
              <div class="sub-text">${s.phone || "No Phone"}</div>
            </div>
          </div>
        </td>
        <td style="color:var(--text-muted);">${s.planName || "None"}</td>
        <td style="font-weight:500;">${s.exitDate || "N/A"}</td>
        <td><span class="badge" style="background:var(--bg-hover); color:var(--text-secondary); border:1px solid var(--border);">${s.exitReason || "Other"}</span></td>
        ${canRestore ? `
        <td>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <button class="btn btn-secondary" style="padding:0.25rem 0.5rem; font-size:0.75rem;" onclick="window.openStudentProfileById('${s.id}')">View</button>
            <button class="btn btn-secondary" style="padding:0.25rem 0.5rem; font-size:0.75rem;" onclick="window.handleRestoreStudent('${s.id}', '${s.name}')">Restore</button>
            ${canErase ? `<button class="btn btn-ghost" style="padding:0.25rem 0.5rem; font-size:0.75rem; color:var(--danger);" onclick="window.handlePermanentDeleteOld('${s.id}', '${(s.name || '').replace(/'/g, "\\'")}')">Delete</button>` : ''}
          </div>
        </td>
        ` : ""}
      </tr>
    `;
  });

  tbody.innerHTML = html;
};
