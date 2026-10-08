import { listenToAllStudents, updateStudentProfile, createPortalLoginForStudent, clearPortalCredentials } from "./studentService.js";
import { searchStudents, filterStudents, sortStudents, paginateStudents } from "./studentDataProcessing.js";
import { fetchPlansForDropdown } from "./admissionService.js";
import { convertToOldStudent } from "./oldStudentService.js";
import { loadStudentDocuments, renderStudentDocuments } from "./documentUploadService.js";

let allStudents = [];
let currentProfileStudentId = null;
// Tracks a portal account created during this session (old doc id -> new uid)
// so a retried save doesn't attempt to create the account twice.
let portalCreated = { oldId: null, uid: null };
let currentQuery = "";
let currentFilters = { status: "All", plan: "All" };
let currentSort = { by: "name", order: "asc" };
let currentPage = 1;
let pageSize = 10;
let availablePlans = [];

/**
 * Single source of truth for a student's display photo.
 * There is only ONE photo per student now (`studentDocuments/{id}.photo`,
 * denormalised to `profilePhotoUrl`/`photoUrl`). Legacy `selfie` /
 * `profilePhoto` copies are still read as a fallback so old records keep
 * showing their picture — new uploads always write the single `photo`.
 */
export const getStudentPhotoUrl = (s) => {
  if (!s) return null;
  return s.profilePhotoUrl || s.photoUrl || s.photo || s.selfieUrl || null;
};

/** Legacy status normalisation: "Old Student" was written by older builds. */
export const isOldStatus = (s) => {
  const st = s && s.status;
  return st === "Old" || st === "Old Student";
};

export const escAttr = (v) => String(v == null ? "" : v).replace(/"/g, "&quot;");

/** The surviving record of a merge (`students/xyz` → `xyz`). */
export const mergedTargetId = (s) => {
  if (!s || !s.mergedInto) return "";
  return String(s.mergedInto).split("/").filter(Boolean).pop() || "";
};

/**
 * Badges for the rows that came in through the website, or that were merged
 * into another record. Never used to filter anybody out — only to label them.
 *
 * NOTE: the migration's "needsReview" flag is deliberately NOT surfaced here.
 * Duplicates are prevented at the write (uniqueness claims) and resolved by
 * merging, so a "Possible duplicate" tag on a row was pure noise.
 */
export const buildFlagBadges = (s) => {
  const flags = [];
  if (s && s.source === "Website") {
    flags.push(`<span class="badge badge-info" style="font-size:10px; padding:1px 7px;" title="Lead came in through the public website">Website</span>`);
  }
  if (s && s.mergedInto) {
    const target = mergedTargetId(s);
    flags.push(`<span class="badge badge-overdue" style="font-size:10px; padding:1px 7px;" title="Merged into ${escAttr(s.mergedInto)} — this record is kept as history">Merged duplicate record${target ? ` → ${escAttr(target)}` : ""}</span>`);
  }
  return flags.length ? `<div style="display:flex; flex-wrap:wrap; gap:4px; margin-top:3px;">${flags.join("")}</div>` : "";
};

// ==========================================
// INITIALIZATION
// ==========================================
export const initStudentManagementUI = async () => {
  const tableBody = document.getElementById("students-table-body");
  if (!tableBody) return; // Not on students page

  const role = localStorage.getItem("userRole");
  if (role === "Student") {
    // Students don't manage the student table — silently skip this admin UI
    return;
  }

  // Load plans for edit dropdown
  try {
    availablePlans = await fetchPlansForDropdown(false);
  } catch (e) {
    console.error("Could not fetch plans", e);
  }

  // Start Listener
  tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center;">Loading students...</td></tr>`;
  
  listenToAllStudents((data) => {
    // Exclude Old students. Older builds wrote "Old Student" — treat both
    // as old so they never leak into the active grid.
    allStudents = data.filter(s => !isOldStatus(s));
    renderTable();
  }, (err) => {
    console.error("Student listener failed:", err);
    tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--danger);">Failed to load students. Check your connection and sign in again — nothing was deleted.</td></tr>`;
  });

  // Attach event listeners
  const searchInput = document.getElementById("student-search-input");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      currentQuery = e.target.value;
      currentPage = 1;
      renderTable();
    });
  }

  // NOTE: scoped to #page-students on purpose. A global ".filter-tab"
  // selector also matches the Attendance / Analytics tabs — clicking those
  // used to overwrite the student status filter (e.g. to "Present") and the
  // whole student list would "disappear".
  document.querySelectorAll("#page-students .filter-tab").forEach(tab => {
    tab.addEventListener("click", (e) => {
      document.querySelectorAll("#page-students .filter-tab").forEach(t => t.classList.remove("active"));
      e.currentTarget.classList.add("active");
      currentFilters.status = e.currentTarget.textContent.trim();
      currentPage = 1;
      renderTable();
    });
  });

  // Attach global functions for UI actions
  window.changePage = (increment) => {
    currentPage += increment;
    if (currentPage < 1) currentPage = 1;
    renderTable();
  };

  window.changePageSize = (size) => {
    pageSize = parseInt(size);
    currentPage = 1;
    renderTable();
  };

  window.setSort = (field) => {
    if (currentSort.by === field) {
      currentSort.order = currentSort.order === "asc" ? "desc" : "asc";
    } else {
      currentSort.by = field;
      currentSort.order = "asc";
    }
    renderTable();
  };

  window.openStudentProfile = (id) => {
    const student = allStudents.find(s => s.id === id);
    if (student) renderProfileModal(student, role);
  };

  window.closeStudentProfile = () => {
    const modal = document.getElementById("student-profile-modal");
    if (modal) modal.close();
  };

  /**
   * Open the student card by id from anywhere (approval queue, merge badge,
   * notification). Uses the live list when possible, otherwise reads the doc
   * directly — pending applicants live in `students` before they ever reach
   * the main table, and legacy records may still sit in `admissions`.
   */
  window.openStudentProfileById = async (id) => {
    if (!id) return;
    const currentRole = localStorage.getItem("userRole");
    const cached = allStudents.find(s => s.id === id);
    if (cached) {
      renderProfileModal(cached, currentRole);
      return;
    }
    try {
      const { getDoc, doc: fsDoc } = await import("firebase/firestore");
      const { db: fsDb } = await import("../firebase/firebase.js");
      const snap = await getDoc(fsDoc(fsDb, "students", id));
      if (snap.exists()) {
        renderProfileModal({ id: snap.id, ...snap.data() }, currentRole);
        return;
      }
      const legacy = await getDoc(fsDoc(fsDb, "admissions", id));
      if (legacy.exists()) {
        renderProfileModal({ id: legacy.id, ...legacy.data() }, currentRole);
        return;
      }
      if (window.showToast) window.showToast("Student record not found.", "warning");
    } catch (e) {
      if (window.showToast) window.showToast("Could not open student: " + e.message, "error");
    }
  };

  // Defined once (modal re-renders every open): SVG eye toggle + copy.
  // Read-only helpers — no Firestore writes.
  if (!window.togglePortalPass) {
    window.togglePortalPass = (btn) => {
      const input = document.getElementById("view-login-pass");
      if (!input) return;
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.innerHTML = show
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
        : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
      btn.setAttribute("aria-pressed", String(show));
      btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
      btn.title = show ? "Hide password" : "Show password";
    };
  }

  if (!window.copyPortalField) {
    window.copyPortalField = async (inputId, btn) => {
      const el = document.getElementById(inputId);
      if (!el || !el.value) {
        if (window.showToast) window.showToast("Nothing to copy.", "warning");
        return;
      }
      let ok = false;
      try {
        await navigator.clipboard.writeText(el.value);
        ok = true;
      } catch (_) {
        try {
          el.focus();
          el.select();
          ok = document.execCommand("copy");
        } catch (__) { ok = false; }
      }
      if (btn) {
        const orig = btn.innerHTML;
        btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        setTimeout(() => { btn.innerHTML = orig; }, 1200);
      }
      if (!ok && window.showToast) window.showToast("Copy failed — select the text manually.", "error");
    };
  }
};

// ==========================================
// RENDER LOGIC
// ==========================================
const renderTable = () => {
  const tableBody = document.getElementById("students-table-body");
  if (!tableBody) return;

  // 0. Exclude Old students entirely from Active Management
  // (both "Old" and the legacy "Old Student" value).
  let activeOnly = allStudents.filter(s => !isOldStatus(s));

  // 1. Search
  let processed = searchStudents(activeOnly, currentQuery);
  // 2. Filter
  processed = filterStudents(processed, currentFilters);
  // 3. Sort
  processed = sortStudents(processed, currentSort.by, currentSort.order);
  
  // Pagination State
  const total = processed.length;
  const maxPage = Math.ceil(total / pageSize) || 1;
  if (currentPage > maxPage) currentPage = maxPage;

  // Update Counters in Header
  updateCounters(processed);

  // 4. Paginate
  processed = paginateStudents(processed, currentPage, pageSize);

  if (processed.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--text-muted);">No students found.</td></tr>`;
    updatePaginationUI(total);
    return;
  }

  let html = "";
  const today = new Date();
  today.setHours(0,0,0,0);

  processed.forEach(s => {
    const initials = s.name ? s.name.substring(0, 2).toUpperCase() : "??";
    const statusBadge = s.status === "Active" ? `<span class="badge badge-paid">Active</span>` 
                      : s.status === "Pending" || s.approvalStatus === "Pending" ? `<span class="badge badge-pending">Pending</span>`
                      : `<span class="badge badge-overdue">${s.status}</span>`;

    let planHtml = `<span style="white-space: normal;">${s.planName || "None"}</span>`;
    const priceMatch = s.planName ? s.planName.match(/(.*?)( - | · | )₹(\d+.*)/) : null;
    if (priceMatch) {
      planHtml = `<div style="line-height: 1.4;">
                    <div>${priceMatch[1].trim()}</div>
                    <div style="font-size: 0.85em; color: var(--text-muted);">₹${priceMatch[3]}</div>
                  </div>`;
    } else if (s.planName) {
      planHtml = `<div style="line-height: 1.4;">${s.planName}</div>`;
    }

    let nameHtml = s.name ? `<div class="name" style="line-height: 1.3;">${s.name}</div>` : `<div class="name">Unknown</div>`;

    // Migration / provenance flags. These records are NEVER hidden or
    // removed — they are only labelled so staff know what they're looking at.
    const flagsHtml = buildFlagBadges(s);
    let leavingDateHtml = `<span style="color:var(--text-muted);">—</span>`;
    if (s.plannedExitDate) {
      const exitD = new Date(s.plannedExitDate);
      if (!isNaN(exitD.getTime())) {
        const diffTime = exitD - today;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        const short = exitD.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
        let chip = "";
        if (diffDays <= 3) {
          chip = `<span class="badge" style="background:var(--danger); color:#fff; font-size:10px; padding:1px 7px; margin-top:3px; display:inline-block;">${diffDays < 0 ? 'Passed' : diffDays + 'd left'}</span>`;
        } else if (diffDays <= 7) {
          chip = `<span class="badge" style="background:var(--warning); color:#fff; font-size:10px; padding:1px 7px; margin-top:3px; display:inline-block;">${diffDays}d left</span>`;
        }
        leavingDateHtml = `<div style="line-height:1.5;" title="${s.plannedExitDate}"><div style="font-weight:500; white-space:nowrap;">${short}</div>${chip}</div>`;
      }
    }

    html += `
      <tr style="cursor:pointer;" onclick="window.openStudentProfile('${s.id}')">
        <td style="vertical-align: top; padding-top: 1rem; max-width: 220px; white-space: normal; word-wrap: break-word;">
          <div class="student-cell" style="align-items: flex-start;">
            ${(() => { const _ph = getStudentPhotoUrl(s); return _ph
              ? `<div class="avatar-sm" style="margin-top: 2px; overflow:hidden; padding:0;"><img src="${_ph}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;" /></div>`
              : `<div class="avatar-sm" style="background:var(--primary); margin-top: 2px;">${initials}</div>`; })()}
            <div>
              ${nameHtml}
              <div class="sub-text" style="margin-top: 2px;">${s.phone || "No Phone"}</div>
              ${flagsHtml}
            </div>
          </div>
        </td>
        <td style="vertical-align: top; padding-top: 1.1rem; max-width: 180px; white-space: normal; word-wrap: break-word;">${planHtml}</td>
        <td style="vertical-align: top; padding-top: 1.1rem; white-space: nowrap;">${s.createdAt?.toDate ? new Date(s.createdAt.toDate()).toLocaleDateString() : 'N/A'}</td>
        <td style="vertical-align: top; padding-top: 1.1rem; white-space: nowrap;">${s.paymentDueDate || "N/A"}</td>
        <td style="vertical-align: top; padding-top: 1.1rem; max-width: 130px;">${leavingDateHtml}</td>
        <td style="vertical-align: top; padding-top: 1.1rem; white-space: nowrap;">${statusBadge}</td>
      </tr>
    `;
  });

  tableBody.innerHTML = html;
  updatePaginationUI(total);

  // Update sorting indicators
  const ths = document.querySelectorAll("#page-students .data-table th[onclick]");
  ths.forEach(th => {
    let text = th.textContent.replace(/\s*[↑↓↕]\s*$/, '').trim();
    const isSorted = th.getAttribute('onclick').includes(`'${currentSort.by}'`);
    const arrow = isSorted ? (currentSort.order === 'asc' ? '↑' : '↓') : '↕';
    th.style.color = isSorted ? "var(--text-primary)" : "var(--text-muted)";
    th.innerHTML = `<div style="display: flex; align-items: center; gap: 4px; white-space: nowrap;"><span>${text}</span><span>${arrow}</span></div>`;
  });
};

const updateCounters = (dataset) => {
  const subtitle = document.querySelector("#page-students .page-subtitle");
  if (!subtitle) return;
  const active = dataset.filter(s => s.status === "Active").length;
  const inactive = dataset.filter(s => s.status === "Inactive" || s.status === "Expired").length;
  const pending = dataset.filter(s => s.status === "Pending" || s.approvalStatus === "Pending").length;
  subtitle.innerHTML = `${active} active · ${inactive} inactive · ${pending} pending`;
};

const updatePaginationUI = (total) => {
  const pageInfo = document.getElementById("pagination-info");
  if (pageInfo) {
    const start = total === 0 ? 0 : ((currentPage - 1) * pageSize) + 1;
    const end = Math.min(currentPage * pageSize, total);
    pageInfo.innerText = `Showing ${start}-${end} of ${total} students`;
  }
};

// ==========================================
// PROFILE MODAL LOGIC
// ==========================================
const renderProfileModal = (s, role) => {
  const modal = document.getElementById("student-profile-modal");
  if (!modal) return;
  currentProfileStudentId = s.id;

  const isOwner = role === "Owner/Admin";
  const isManager = role === "Manager";
  const canEdit = isOwner || isManager;
  
  // Manager cannot edit Plan or Status
  const readOnlyForManager = isManager ? "disabled" : "";
  const hideForEmployee = !canEdit ? "display:none;" : "";

  // ── Portal login state (Owner sets/creates it from this popup) ──────────
  // Split into two fields: prefer raw fields, fall back to legacy "id / pass"
  let portalId = s.loginId || "";
  let portalPass = s.loginPassword || "";
  if (!portalId && !portalPass && s.loginCredentials) {
    const rawCred = String(s.loginCredentials);
    const slashIdx = rawCred.indexOf("/");
    if (slashIdx !== -1) {
      if (!portalId) portalId = rawCred.slice(0, slashIdx).trim();
      if (!portalPass) portalPass = rawCred.slice(slashIdx + 1).trim();
    } else if (!portalId) {
      portalId = rawCred.trim();
    }
  }
  // "Login active" ONLY when the credential pair is actually on file.
  // (Declared after portalId/portalPass — referencing them earlier throws.)
  const hasPortalAccount = !!(portalId && portalPass);

  let planOptions = `<option value="">Select Plan...</option>`;
  availablePlans.forEach(p => {
    const selected = p.id === s.planId ? "selected" : "";
    planOptions += `<option value="${p.id}" ${selected}>${p.planName}</option>`;
  });

  // Payment method the student picked in the portal (or the admin wrote):
  // shown round-trippable so staff can correct a typo without losing it.
  const PAYMENT_METHODS = ["Pay Later", "Paid", "Admin Created", "Pending"];
  let payOptions = `<option value="">Not set</option>`;
  PAYMENT_METHODS.forEach(m => {
    payOptions += `<option value="${m}" ${s.paymentMethod === m ? "selected" : ""}>${m}</option>`;
  });
  if (s.paymentMethod && PAYMENT_METHODS.indexOf(s.paymentMethod) === -1) {
    payOptions += `<option value="${escAttr(s.paymentMethod)}" selected>${escAttr(s.paymentMethod)}</option>`;
  }

  modal.innerHTML = `
    <style>
      @keyframes modalFadeIn {
        from { opacity: 0; transform: translateY(20px) scale(0.98); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      .sp-modal-content {
        animation: modalFadeIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }
      .sp-tab {
        transition: all 0.2s ease;
        border-radius: 6px 6px 0 0;
      }
      .sp-tab:hover:not(.active) {
        background-color: var(--bg-hover, #f1f5f9);
      }
      .sp-action-btn {
        transition: all 0.2s ease;
      }
      .sp-action-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0,0,0,0.08);
      }
      /* Credential hints must never look like filled data */
      #view-login-id::placeholder,
      #view-login-pass::placeholder {
        color: var(--text-muted);
        opacity: 0.55;
        font-style: italic;
      }
      #student-profile-modal .form-group input, 
      #student-profile-modal .form-group select {
        transition: all 0.2s ease;
      }
      #student-profile-modal .form-group input:focus, 
      #student-profile-modal .form-group select:focus {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0,0,0,0.05);
      }
    </style>
    <div class="sp-modal-content" style="padding: 1.5rem; max-width: 600px; max-height: 85vh; overflow-y: auto;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
        <h2 style="margin: 0;">Student Profile</h2>
        <button class="btn btn-ghost" onclick="window.closeStudentProfile()" style="padding: 0.25rem 0.5rem; transition: transform 0.2s ease;" onmouseover="this.style.transform='rotate(90deg)'" onmouseout="this.style.transform='none'">✕</button>
      </div>
      
      <div style="display: flex; gap: 1rem; margin-bottom: 2rem; align-items: center;">
        ${(() => { const _ph = getStudentPhotoUrl(s); return _ph
          ? `<div id="sp-avatar-${s.id}" style="width: 80px; height: 80px; border-radius: 50%; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.1); flex-shrink:0;"><img src="${_ph}" alt="Profile photo" style="width:100%;height:100%;object-fit:cover;display:block;" /></div>`
          : `<div id="sp-avatar-${s.id}" style="width: 80px; height: 80px; border-radius: 50%; background: var(--primary); color: white; display:flex; align-items:center; justify-content:center; font-size: 24px; font-weight: bold; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.1); flex-shrink:0;">
          ${s.name ? s.name.substring(0, 2).toUpperCase() : "ST"}
        </div>`; })()}
        <div>
          <h3 style="margin: 0; font-size: 1.25rem;">${s.name}</h3>
          <div style="color: var(--text-muted);">${s.studentId || s.admissionNo || "No ID"} · ${s.status || "Active"}${s.approvalStatus ? ` · ${s.approvalStatus}` : ""}</div>
          <div style="display:flex; flex-wrap:wrap; gap:0.5rem; align-items:center;">
            ${buildFlagBadges(s)}
            ${s.mergedInto ? `<button type="button" class="btn btn-ghost" style="padding:2px 8px; font-size:11px;" onclick="window.openStudentProfileById('${escAttr(mergedTargetId(s))}')">Open merged record</button>` : ""}
          </div>
          <div style="margin-top: 0.5rem; display:flex; gap: 0.5rem;">
            <a href="tel:${s.phone}" class="btn btn-primary sp-action-btn" style="padding: 0.25rem 0.75rem; font-size: 0.85rem; text-decoration: none;">Call</a>
            <button type="button" class="btn sp-action-btn" style="background: #25D366; color: white; border: none; padding: 0.25rem 0.75rem; font-size: 0.85rem;" onclick="window.triggerWhatsAppModal('${s.id}')">WhatsApp</button>
            ${canEdit ? `<button type="button" class="btn btn-secondary sp-action-btn" style="padding: 0.25rem 0.75rem; font-size: 0.85rem;" onclick="window.handleConvertToOld('${s.id}', '${s.name}')">Convert to Old</button>` : ""}
            ${canEdit ? `<button type="button" class="btn btn-primary sp-action-btn" style="padding: 0.25rem 0.75rem; font-size: 0.85rem;" onclick="window.openRenewalModal('${s.id}')">Renew</button>` : ""}
          </div>
        </div>
      </div>

      <div class="tabs" style="display:flex; gap:1rem; border-bottom: 1px solid var(--border); margin-bottom: 1.5rem;">
        <div class="tab active sp-tab" style="padding:0.5rem 1rem; border-bottom: 2px solid var(--primary); cursor:pointer;" onclick="window.switchStudentProfileTab('details', this)">Details</div>
        <div class="tab sp-tab" style="padding:0.5rem 1rem; cursor:pointer;" onclick="window.switchStudentProfileTab('history', this); window.loadRenewalHistory('${s.id}')">Renewal History</div>
        <div class="tab sp-tab" style="padding:0.5rem 1rem; cursor:pointer;" onclick="window.switchStudentProfileTab('documents', this)">Documents</div>
      </div>

      <div id="sp-tab-details">
        <form id="edit-student-form" onsubmit="event.preventDefault(); window.submitStudentEdit('${s.id}')">
          <div class="form-grid">
            <div class="form-group">
              <label>Name</label>
              <input type="text" id="edit-name" value="${s.name || ''}" ${!canEdit ? 'disabled' : ''} required />
            </div>
            <div class="form-group">
              <label>Phone</label>
              <input type="tel" id="edit-phone" value="${s.phone || ''}" ${!canEdit ? 'disabled' : ''} required />
            </div>
            <div class="form-group">
              <label>Email</label>
              <input type="email" id="edit-email" value="${s.email || ''}" ${!canEdit ? 'disabled' : ''} />
            </div>
            <div class="form-group">
              <label>Date of Birth</label>
              <input type="date" id="edit-dob" value="${s.dob || ''}" ${!canEdit ? 'disabled' : ''} />
            </div>
            <div class="form-group">
              <label>Gender</label>
              <select id="edit-gender" class="sp-input" ${!canEdit ? 'disabled' : ''}>
                <option value="">Select</option>
                <option value="Male" ${s.gender === 'Male' ? 'selected' : ''}>Male</option>
                <option value="Female" ${s.gender === 'Female' ? 'selected' : ''}>Female</option>
                <option value="Other" ${s.gender === 'Other' ? 'selected' : ''}>Other</option>
              </select>
            </div>
            <div class="form-group">
              <label>College / Institute</label>
              <input type="text" id="edit-college" value="${s.college || ''}" ${!canEdit ? 'disabled' : ''} />
            </div>
            <div class="form-group">
              <label>Course</label>
              <input type="text" id="edit-course" value="${s.course || ''}" ${!canEdit ? 'disabled' : ''} />
            </div>
            <div class="form-group">
              <label>Address</label>
              <input type="text" id="edit-address" value="${s.address || ''}" ${!canEdit ? 'disabled' : ''} />
            </div>
            <div class="form-group">
              <label>Emergency Contact</label>
              <input type="tel" id="edit-emergency" value="${s.parentPhone || ''}" ${!canEdit ? 'disabled' : ''} />
            </div>
            <div class="form-group">
              <label>Leaving Date (Optional)</label>
              <input type="date" id="edit-leaving-date" value="${s.plannedExitDate || ''}" ${!canEdit ? 'disabled' : ''} />
            </div>
            
            <div class="form-group" style="grid-column: span 2;">
              <hr style="border: none; border-top: 1px solid var(--border); margin: 1rem 0;" />
            </div>

            <div class="form-group">
              <label>Remarks</label>
              <input type="text" id="edit-remarks" value="${s.remarks || ''}" ${!canEdit ? 'disabled' : ''} />
            </div>
            ${isOwner ? `
            <div class="form-group">
              <label>Login ID</label>
              <div style="position: relative;">
              <input type="text" id="view-login-id"
                value="${escAttr(portalId)}"
                placeholder="e.g. 9876543210 or student@email.com"
                autocapitalize="none" autocorrect="off" spellcheck="false"
                ${hasPortalAccount
                  ? `readonly data-locked="1" onfocus="this.select()" title="Login ID — click to select, copy button on the right" style="background: var(--bg-hover); color: var(--text-primary); cursor: text; font-size:13px; font-family:inherit; padding-right:34px; width:100%; user-select:text;"`
                  : `style="background: var(--bg-card); color: var(--text-primary); border: 1px solid var(--border); cursor: text; font-size:13px; font-family:inherit; -webkit-text-fill-color: var(--text-primary); -webkit-box-shadow: 0 0 0 30px var(--bg-card) inset !important; -moz-box-shadow: 0 0 0 30px var(--bg-card) inset !important; box-shadow: 0 0 0 30px var(--bg-card) inset !important;"`}
                 />
              ${hasPortalAccount
                ? `<button type="button" title="Copy login ID" aria-label="Copy login ID" onclick="window.copyPortalField('view-login-id', this)"
                    style="position:absolute; right:3px; top:50%; transform:translateY(-50%); z-index:2; width:28px; height:28px; background:none; border:none; cursor:pointer; color:var(--text-muted); padding:0; display:flex; align-items:center; justify-content:center;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>`
                : ``}
              </div>
                <small style="font-size:10.5px; color:var(--text-muted); line-height:1.4;">10-digit phone (e.g. 9876543210) or an email (e.g. name@gmail.com)</small>
            </div>
            <div class="form-group">
              <label>Login Password</label>
              <div style="position: relative;">
                <input type="text" id="view-login-pass"
                  value="${escAttr(portalPass)}"
                  placeholder="••••••••"
                  autocapitalize="none" autocorrect="off" spellcheck="false"
                  ${hasPortalAccount
                    ? `readonly data-locked="1" onfocus="this.select()" title="Password — eye icon toggles visibility" style="background: var(--bg-hover); color: var(--text-primary); cursor: text; font-size:13px; font-family:inherit; padding-right:64px; width:100%; user-select:text;"`
                    : `style="background: var(--bg-card); color: var(--text-primary); border: 1px solid var(--border); cursor: text; font-size:13px; font-family:inherit; padding-right:64px; width:100%; -webkit-text-fill-color: var(--text-primary); -webkit-box-shadow: 0 0 0 30px var(--bg-card) inset !important; -moz-box-shadow: 0 0 0 30px var(--bg-card) inset !important; box-shadow: 0 0 0 30px var(--bg-card) inset !important;"`}
                   />
                <button type="button" id="btn-eye-pass" title="Hide password" aria-label="Hide password" aria-pressed="true"
                  onclick="window.togglePortalPass(this)"
                  style="position:absolute; right:33px; top:50%; transform:translateY(-50%); z-index:2; width:28px; height:28px; background:none; border:none; cursor:pointer; color:var(--text-muted); padding:0; display:flex; align-items:center; justify-content:center;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg></button>
                ${hasPortalAccount
                  ? `<button type="button" title="Copy password" aria-label="Copy password" onclick="window.copyPortalField('view-login-pass', this)"
                      style="position:absolute; right:3px; top:50%; transform:translateY(-50%); z-index:2; width:28px; height:28px; background:none; border:none; cursor:pointer; color:var(--text-muted); padding:0; display:flex; align-items:center; justify-content:center;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>`
                  : ``}
              </div>
                <small style="font-size:10.5px; color:var(--text-muted); line-height:1.4;">Minimum 6 characters.</small>
            </div>
            <div class="form-group" style="grid-column: span 2;">
              <div style="display:flex; gap:10px; align-items:center;">
                ${hasPortalAccount
                  ? `<small style="font-size:11.5px; color:#166534; font-weight:600;">🟢 Login active</small>`
                  : `<small style="font-size:11.5px; color:#b91c1c; font-weight:600;">🔴 Login not created — fill both &amp; Save</small>`}
                ${hasPortalAccount || portalId || portalPass || s.uid || s.authEmail
                  ? `<button type="button" id="btn-clear-login" class="btn btn-ghost" title="Remove only the stored Login ID / Password — nothing else"
                      style="margin-left:auto; padding:5px 12px; font-size:11.5px; font-weight:600; border-radius:8px;">Clear login</button>`
                  : ""}
              </div>
            </div>
            ` : ''}

            <div class="form-group" style="grid-column: span 2;">
              <hr style="border: none; border-top: 1px solid var(--border); margin: 1rem 0;" />
            </div>

            <div class="form-group">
              <label>Membership Plan ${isManager ? '(Locked)' : ''}</label>
              <select id="edit-plan" class="sp-input" ${!canEdit || readOnlyForManager ? 'disabled' : ''}>
                ${planOptions}
              </select>
            </div>
            <div class="form-group">
              <label>Status ${isManager ? '(Locked)' : ''}</label>
              <select id="edit-status" class="sp-input" ${!canEdit || readOnlyForManager ? 'disabled' : ''}>
                <option value="Active" ${s.status === 'Active' ? 'selected' : ''}>Active</option>
                <option value="Inactive" ${s.status === 'Inactive' ? 'selected' : ''}>Inactive</option>
                <option value="Pending" ${s.status === 'Pending' ? 'selected' : ''}>Pending</option>
              </select>
            </div>

            <div class="form-group">
              <label>Seat</label>
              <input type="text" id="edit-seat" value="${escAttr(s.seatNumber || s.seatAssigned || '')}" placeholder="e.g. A17" ${!canEdit ? 'disabled' : ''} />
            </div>
            <div class="form-group">
              <label>Payment Method</label>
              <select id="edit-payment-method" class="sp-input" ${!canEdit ? 'disabled' : ''}>
                ${payOptions}
              </select>
            </div>
            <div class="form-group">
              <label>Transaction ID</label>
              <input type="text" id="edit-txn-id" value="${escAttr(s.transactionId || '')}" placeholder="UPI / bank reference" ${!canEdit ? 'disabled' : ''} />
            </div>
            <div class="form-group">
              <label>Payment Due Date</label>
              <input type="date" id="edit-payment-due" value="${escAttr(s.paymentDueDate || '')}" ${!canEdit ? 'disabled' : ''} />
            </div>
          </div>

          <div class="form-actions" style="margin-top: 2rem; justify-content: flex-end; ${hideForEmployee}">
            ${isOwner && s.email ? `<button type="button" class="btn btn-secondary sp-action-btn" style="padding: 0.5rem 1rem; font-size: 0.85rem;" onclick="window.triggerStudentEmail('${s.id}')">Email</button>` : ''}
            <button type="submit" class="btn btn-primary" id="btn-save-edit">Save Changes</button>
          </div>
        </form>
      </div>

      <div id="sp-tab-history" style="display:none;">
        <div id="sp-renewal-history-container"></div>
      </div>

      <div id="sp-tab-documents" style="display:none;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; gap:1rem; flex-wrap:wrap;">
          <div>
            <strong>Student Documents</strong>
            <div style="font-size:12px; color:var(--text-muted);">Aadhaar, selfie and profile photo — upload, preview and download.</div>
          </div>
        </div>
        <div id="student-documents-list"></div>
      </div>
    </div>
  `;
  modal.showModal();

  // "Clear login" — removes ONLY the credential fields from the student doc.
  const clearBtn = document.getElementById("btn-clear-login");
  if (clearBtn) {
    clearBtn.addEventListener("click", async () => {
      const ok = await window.showCustomConfirm(
        "Remove Portal Login",
        "Remove this student's portal login? Stored ID / Password deleted — sign-in stops working. Profile and everything else stay untouched.",
        "Remove",
        false
      );
      if (!ok) return;
      clearBtn.disabled = true;
      try {
        await clearPortalCredentials(s.id);
        window.showToast("Login removed — credentials deleted, sign-in blocked.", "success");
        window.closeStudentProfile();
      } catch (e) {
        window.showToast("Could not remove credentials: " + e.message, "error");
        clearBtn.disabled = false;
      }
    });
  }

  if (isOwner && s.uid && (!portalId || !portalPass)) {
    // Rare: uid-keyed doc without stored credentials — check the auth profile.
    import("./firestoreService.js").then(({ getDocument }) => {
      getDocument("users", s.uid).then(userDoc => {
        if (userDoc && userDoc.loginCredentials) {
          const rawCred = String(userDoc.loginCredentials);
          const sIdx = rawCred.indexOf("/");
          const idEl = document.getElementById("view-login-id");
          const passEl = document.getElementById("view-login-pass");
          if (idEl && sIdx !== -1) idEl.value = rawCred.slice(0, sIdx).trim();
          if (passEl && sIdx !== -1) passEl.value = rawCred.slice(sIdx + 1).trim();
        }
      }).catch(() => {});
    }).catch(() => {});
  }

  // Always try the canonical document store — the portal saves the photo to
  // `studentDocuments/{id}.photo` (and denormalises it onto the
  // student doc). Legacy `profilePhoto` / `selfie` copies still work.
  loadStudentDocuments(s.id).then(async (docs) => {
    if (!docs) return;
    const { getStudentPhoto, backfillPhotoThumb } = await import("./documentUploadService.js");
    const best = getStudentPhoto(docs, null);
    if (best) {
      const avatarEl = document.getElementById(`sp-avatar-${s.id}`);
      if (avatarEl) {
        avatarEl.innerHTML = `<img src="${best}" style="width:100%; height:100%; object-fit:cover;" alt="Photo" />`;
        avatarEl.style.background = "var(--bg-hover)";
      }
      // Self-heal pre-thumbnail uploads: photo lives in documents but the
      // main list field was never written — backfill it now so the table
      // row picks it up over the live listener. No re-upload needed.
      // Same heal shrinks oversized old list photos (>150KB full-size
      // base64) to the fast thumbnail — those giants slow down EVERY
      // student-list sync until replaced.
      try {
        const listPhoto = getStudentPhotoUrl(s);
        if (!listPhoto) {
          backfillPhotoThumb(s.id, best).catch(() => {});
        } else if (String(listPhoto).startsWith("data:") && listPhoto.length > 150000 && best) {
          backfillPhotoThumb(s.id, best).catch(() => {});
        }
      } catch (_) {}
    }
  }).catch(err => console.error("Failed to load photo", err));
};

window.submitStudentEdit = async (id) => {
  const btn = document.getElementById("btn-save-edit");
  btn.textContent = "Saving...";
  btn.disabled = true;
  try {
    const planEl = document.getElementById("edit-plan");
    const updates = {
      name: document.getElementById("edit-name").value,
      phone: document.getElementById("edit-phone").value,
      email: document.getElementById("edit-email").value,
      dob: document.getElementById("edit-dob").value,
      gender: document.getElementById("edit-gender").value,
      college: document.getElementById("edit-college").value,
      course: document.getElementById("edit-course").value,
      address: document.getElementById("edit-address").value,
      parentPhone: document.getElementById("edit-emergency").value,
      // The following are disabled for Managers, so if disabled, they don't change in the DOM but we grab the value anyway (it hasn't changed)
      planId: planEl.value,
      planName: planEl.options[planEl.selectedIndex]?.text || "",
      status: document.getElementById("edit-status").value,
      plannedExitDate: document.getElementById("edit-leaving-date").value,
      remarks: document.getElementById("edit-remarks").value
    };

    // ── Seat + payment detail the student filled in the portal ────────────
    // Round-tripped through the same updateDoc (updateStudentProfile NEVER
    // creates a document), so this can't spawn a second student record.
    // Missing elements (old cached markup) are simply skipped.
    const seatEl = document.getElementById("edit-seat");
    const payMethodEl = document.getElementById("edit-payment-method");
    const txnEl = document.getElementById("edit-txn-id");
    const dueEl = document.getElementById("edit-payment-due");
    if (seatEl && !seatEl.disabled) updates.seatNumber = seatEl.value.trim();
    if (payMethodEl && !payMethodEl.disabled) updates.paymentMethod = payMethodEl.value;
    if (txnEl && !txnEl.disabled) updates.transactionId = txnEl.value.trim();
    if (dueEl && !dueEl.disabled) updates.paymentDueDate = dueEl.value;

    // ── Owner: create the Student Portal login from the two Login fields ──
    let targetId = id;
    let portalMsg = "";
    const idInput = document.getElementById("view-login-id");
    const passInput = document.getElementById("view-login-pass");
    if (portalCreated.oldId === id) {
      // Account was already created earlier in this modal session (retry after
      // a failed save) — just target the migrated document.
      targetId = portalCreated.uid;
    } else if (idInput && !idInput.disabled && !idInput.hasAttribute("data-locked")) {
      const loginId = (idInput.value || "").trim();
      const loginPassword = (passInput ? passInput.value : "").trim();
      if (!loginId && !loginPassword) {
        // Both fields cleared — drop any stored (not yet activated) credentials
        updates.loginCredentials = "";
        updates.loginId = "";
        updates.loginPassword = "";
      } else if (!loginId || !loginPassword) {
        // Incomplete — keep the draft so it isn't lost on reload
        updates.loginId = loginId;
        updates.loginPassword = loginPassword;
        updates.loginCredentials = loginId && loginPassword ? `${loginId} / ${loginPassword}` : "";
        window.showToast("Fill BOTH Login ID and Login Password to enable portal login — or clear both fields.", "warning");
      } else {
        // ── Same rules the account system enforces — check BEFORE creating
        // so the toast tells you exactly what to fix.
        const phoneLike = /^[\d\s\-\+\(\)]+$/.test(loginId);
        let idDigits = loginId.replace(/\D/g, "");
        if (idDigits.length === 12 && idDigits.startsWith("91")) idDigits = idDigits.slice(2);
        else if (idDigits.length === 11 && idDigits.startsWith("0")) idDigits = idDigits.slice(1);
        const idOk = phoneLike ? idDigits.length === 10 : /^[^\s@]+@[^\s@]+$/.test(loginId);
        if (!idOk) {
          window.showToast("Login ID must be a 10-digit phone number (e.g. 9876543210) or an email address (e.g. name@gmail.com).", "error");
          btn.textContent = "Save Changes";
          btn.disabled = false;
          return;
        }
        if (loginPassword.length < 6) {
          window.showToast("Portal password must be at least 6 characters.", "error");
          btn.textContent = "Save Changes";
          btn.disabled = false;
          return;
        }
        try {
          const acc = await createPortalLoginForStudent(id, loginId, loginPassword);
          portalCreated = { oldId: id, uid: acc.uid };
          targetId = acc.uid; // student doc now lives at students/{uid}
          updates.uid = acc.uid;
          updates.authEmail = acc.authEmail;
          updates.loginId = loginId;
          updates.loginPassword = loginPassword;
          updates.loginCredentials = acc.loginCredentials;
          portalMsg = ` Portal login created — student signs in with: ${loginId}`;
        } catch (acctErr) {
          window.showToast("Portal login NOT created: " + acctErr.message, "error");
          btn.textContent = "Save Changes";
          btn.disabled = false;
          return; // abort — don't save half-updated data
        }
      }
    }

    const res = await updateStudentProfile(targetId, updates);
    if (res.success) {
      window.showToast(("Profile updated successfully!" + portalMsg).trim(), "success");
      window.closeStudentProfile();
    } else {
      window.showToast("Error: " + res.error, "error");
    }
  } catch (e) {
    window.showToast("Error saving profile: " + e.message, "error");
  } finally {
    btn.textContent = "Save Changes";
    btn.disabled = false;
  }
};

window.switchStudentProfileTab = (tab, el) => {
  const details = document.getElementById("sp-tab-details");
  const history = document.getElementById("sp-tab-history");
  const documents = document.getElementById("sp-tab-documents");
  if (details) details.style.display = tab === "details" ? "block" : "none";
  if (history) history.style.display = tab === "history" ? "block" : "none";
  if (documents) documents.style.display = tab === "documents" ? "block" : "none";

  // Lazily load the documents every time the tab is opened so it's always fresh
  if (tab === "documents" && currentProfileStudentId) {
    renderStudentDocuments(currentProfileStudentId, "student-documents-list").catch(err => {
      console.error("Failed to render student documents", err);
    });
  }

  // Update active tab styling
  const tabs = el.parentElement.querySelectorAll(".tab");
  tabs.forEach(t => {
    t.classList.remove("active");
    t.style.borderBottom = "none";
  });
  el.classList.add("active");
  el.style.borderBottom = "2px solid var(--primary)";
};

window.openRenewalModal = (studentId) => {
  const student = allStudents.find(s => s.id === studentId);
  if (!student) return;
  const role = localStorage.getItem("userRole");
  
  const modal = document.getElementById("renewal-modal");
  modal.innerHTML = `
    <div style="padding: 1.5rem; min-width: 400px; max-width: 500px; max-height: 85vh; overflow-y: auto;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
        <h2 style="margin: 0;">Renew Membership</h2>
        <button class="btn btn-ghost" onclick="document.getElementById('renewal-modal').close()" style="padding: 0.25rem 0.5rem;">✕</button>
      </div>
      <div id="renewal-modal-body"></div>
    </div>
  `;
  
  window.renderRenewalForm(student, "renewal-modal-body", role);
  modal.showModal();
};

window.loadRenewalHistory = (studentId) => {
  window.renderRenewalHistory(studentId, "sp-renewal-history-container");
};

window.triggerStudentEmail = async (id) => {
  const s = allStudents.find(x => x.id === id);
  if (!s || !s.email) {
    window.showToast("No email address on this student record.", "warning");
    return;
  }
  const subject = await window.showCustomPrompt("Send Email", `To: ${s.email}`, "Next", false);
  if (subject === null) return;
  const body = await window.showCustomPrompt("Send Email", "Message:", "Send", true);
  if (body === null) return;
  try {
    const { sendCustomMail } = await import("./emailService.js");
    const res = await sendCustomMail({ to: s.email, subject: subject || "Message from Studyhaus", body: body || "" });
    if (res.success) window.showToast("Email queued for delivery.", "success");
    else window.showToast("Could not queue email: " + res.error, "error");
  } catch (e) {
    window.showToast("Could not queue email: " + e.message, "error");
  }
};

window.triggerWhatsAppModal = (id) => {
  const s = allStudents.find(x => x.id === id);
  if (!s) return;
  
  // Normalize data for the whatsapp modal
  const studentData = {
    id: s.id,
    fullName: s.name,
    phone: s.phone,
    seatNumber: s.seatNumber,
    planName: s.planName,
    endDate: s.paymentDueDate
  };

  if (window.openWhatsAppModal) {
    window.openWhatsAppModal(studentData);
  }
};

window.handleConvertToOld = (id, name) => {
  const dialog = document.createElement("dialog");
  dialog.className = "card smooth-modal";
  dialog.style.cssText = "border:none; border-radius:12px; padding:0; box-shadow:0 10px 30px rgba(0,0,0,0.5); background: var(--bg-card, #fff); color: var(--text-primary, #0f172a); max-width: 400px; margin: auto;";
  
  dialog.innerHTML = `
    <div style="padding: 1.5rem;">
      <h3 style="margin-bottom: 0.5rem; font-size: 1.25rem; text-align: center;">Convert to Old Student</h3>
      <p style="color: var(--text-secondary, #475569); margin-bottom: 1.5rem; font-size: 0.95rem; text-align: center;">Convert ${name} to Old Student?</p>
      
      <div class="form-group" style="margin-bottom: 1rem;">
        <label style="font-size: 0.85rem; font-weight: 600; margin-bottom: 0.25rem; display: block;">Exit Reason <span style="color:red">*</span></label>
        <input type="text" id="co-reason" class="input-field" placeholder="e.g., Membership Completed, Shifted" style="width: 100%; box-sizing: border-box; padding: 0.5rem; border:1px solid var(--border); border-radius:6px;" autofocus required />
      </div>
      
      <div class="form-group" style="margin-bottom: 1.5rem;">
        <label style="font-size: 0.85rem; font-weight: 600; margin-bottom: 0.25rem; display: block;">Job Details / Position (Optional)</label>
        <input type="text" id="co-job" class="input-field" placeholder="e.g., Software Engineer at Google" style="width: 100%; box-sizing: border-box; padding: 0.5rem; border:1px solid var(--border); border-radius:6px;" />
      </div>

      <div style="display: flex; gap: 1rem; justify-content: center;">
        <button class="btn btn-ghost" id="co-cancel" style="flex: 1; border: 1px solid var(--border); border-radius: 999px;">Cancel</button>
        <button class="btn btn-primary" id="co-ok" style="flex: 1; border: none; border-radius: 999px; color: #fff; background: #0f172a;">Convert</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(dialog);
  dialog.showModal();

  dialog.querySelector("#co-cancel").onclick = () => { 
    dialog.close(); 
    dialog.remove(); 
  };
  
  dialog.querySelector("#co-ok").onclick = async () => {
    const reason = dialog.querySelector("#co-reason").value.trim();
    const jobDetails = dialog.querySelector("#co-job").value.trim();
    
    if (!reason) {
      window.showToast("Exit Reason is required.", "error");
      return;
    }
    
    const btn = dialog.querySelector("#co-ok");
    btn.textContent = "Converting...";
    btn.disabled = true;

    const res = await convertToOldStudent(id, reason, jobDetails);
    
    dialog.close();
    dialog.remove();
    
    if (res.success) {
      window.showToast(`${name} has been moved to Old Students.`, "success");
      window.closeStudentProfile();
    } else {
      window.showToast("Error: " + res.error, "error");
    }
  };
};
