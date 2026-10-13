import { listenToVisitors, addVisitor, setVisitorLeadStatus, deleteVisitor } from "./visitorService.js";
import { calculateVisitorAnalytics } from "./visitorAnalytics.js";
import { listenToAllStudents } from "./studentService.js";
import { isAdmitted, isOldStatus } from "./studentProfile.js";
import { sendWhatsAppMessage } from "./whatsappService.js";

export const STUDENT_LOGIN_URL = "https://student.shreejilibrary.co.in/";

let allVisitors = [];
let unsubVisitors = null;

// MAIN student list mirror (approved students only — same filter as the
// students table). "Mark converted" may be offered ONLY when the visitor's
// person already exists there; nobody in the DB => no convert button.
let studentPhones = new Set();
let studentEmails = new Set();
let unsubStudents = null;

const digits = (v) => String(v == null ? "" : v).replace(/\D/g, "");

/** Does this visitor match someone on the main student list (phone or email)? */
const isOnMainStudentList = (v) => {
  const p = digits(v.phone).slice(-10);
  const e = String(v.email || "").trim().toLowerCase();
  return (!!p && studentPhones.has(p)) || (!!e && studentEmails.has(e));
};

/**
 * What the card may actually treat this lead as. A "Converted" flag whose
 * person is NOT on the main student list is stale (set before the gate
 * existed, or the student was later removed) — it must not show as
 * Converted anywhere: badge, filter or buttons. If the student really does
 * get admitted later, the flag starts applying again on its own.
 */
const effectiveLeadStatus = (v) => {
  const ls = v.leadStatus || "";
  if (ls === "Converted" && !isOnMainStudentList(v)) return "";
  return ls;
};

const esc = (v) => String(v == null ? "" : v)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const normaliseSource = (v) => (v && v.source === "Website" ? "Website" : "Walk-in");

/** Normalise a Firestore Timestamp / ISO string / {seconds|value} into epoch ms. */
const tsMs = (v) => {
  if (v == null) return null;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v.seconds === "number") return v.seconds * 1000;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string") { const t = Date.parse(v); return Number.isNaN(t) ? null : t; }
  if (typeof v.value === "string") { const t = Date.parse(v.value); return Number.isNaN(t) ? null : t; }
  return null;
};

/**
 * "08 Oct 2026 · 15:01" — never "Invalid Date" and never an empty cell.
 * Website leads carry visitDate/visitTime written in the browser; anything
 * older or imported falls back to createdAt.
 */
const fmtWhen = (v) => {
  if (v && typeof v.visitDate === "string" && v.visitDate) {
    const d = new Date(`${v.visitDate}T${v.visitTime || "00:00"}`);
    if (!Number.isNaN(d.getTime())) {
      const date = d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
      const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      return `${date} · ${time}`;
    }
  }
  const ms = tsMs(v && v.createdAt);
  if (ms) {
    const d = new Date(ms);
    return `${d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })} · ` +
      d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return "Date unavailable";
};

const initials = (name) => {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

/** Deterministic, theme-safe tint so cards never look like the same person. */
const tintFor = (id) => {
  const palettes = [
    ["#0ea5e9", "#e0f2fe"], ["#10b981", "#d1fae5"], ["#f59e0b", "#fef3c7"],
    ["#8b5cf6", "#ede9fe"], ["#f43f5e", "#ffe4e6"], ["#14b8a6", "#ccfbf1"],
  ];
  let h = 0;
  const s = String(id || "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return palettes[h % palettes.length];
};

const ensureStyles = () => {
  if (document.getElementById("visitor-card-styles")) return;
  const st = document.createElement("style");
  st.id = "visitor-card-styles";
  st.textContent = `
    .vis-toolbar { display:flex; flex-wrap:wrap; gap:.75rem; align-items:flex-end; margin-bottom:1.25rem; }
    .vis-fld { display:flex; flex-direction:column; gap:.3rem; }
    .vis-fld > span { font-size:11px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; color:var(--text-muted); }
    .vis-fld .input-field, .vis-fld input { min-width:170px; }
    .vis-search { flex:1 1 260px; }
    .vis-search input { width:100%; }

    .vis-list { display:grid; grid-template-columns:repeat(auto-fill, minmax(min(340px, 100%), 1fr)); gap:.85rem; }
    .vis-card { background:var(--bg-card); border:1px solid var(--border); border-radius:14px;
      padding:.8rem .95rem; display:flex; flex-direction:column; gap:.42rem;
      transition:border-color .15s, transform .15s, box-shadow .15s; min-width:0; }
    .vis-card:hover { border-color:var(--border-bright); transform:translateY(-2px);
      box-shadow:0 8px 22px rgba(0,0,0,.14); }
    .vis-top { display:flex; gap:.7rem; align-items:center; flex-wrap:wrap; }
    .vis-av { width:40px; height:40px; border-radius:11px; flex:0 0 40px;
      display:flex; align-items:center; justify-content:center; font-weight:800; font-size:14px; }
    .vis-id { flex:1 1 auto; min-width:0; }
    .vis-name { font-size:14.5px; font-weight:700; color:var(--text-primary); line-height:1.25;
      overflow-wrap:anywhere; }
    /* Phone · email on ONE line as its own full-width row under the header:
       looks like the original, but no badges share the row, so the address
       never gets squeezed. nowrap => a long email wraps to line 2 WHOLE. */
    .vis-contact { display:flex; flex-wrap:wrap; align-items:center; gap:.2rem .55rem;
      font-size:12.5px; color:var(--text-secondary); min-width:0; }
    .vis-contact a { color:var(--primary); text-decoration:none; white-space:nowrap; }
    .vis-contact a:hover { text-decoration:underline; }
    .vis-sep { color:var(--border-bright); }
    /* Badges stay on the TOP row, right of the name — that is where a badge
       belongs; they wrap to their own line only when the card is too narrow. */
    .vis-tags { display:flex; flex-wrap:wrap; gap:.35rem; margin-left:auto; }
    .vis-tag { font-size:10.5px; font-weight:800; letter-spacing:.04em; text-transform:uppercase;
      padding:3px 8px; border-radius:6px; border:1px solid transparent; white-space:nowrap; }
    .vis-tag.src-web { background:rgba(59,130,246,.15); color:#3b82f6; border-color:rgba(59,130,246,.35); }
    .vis-tag.src-walk { background:var(--bg-hover); color:var(--text-secondary); border-color:var(--border); }
    .vis-tag.lead-win { background:rgba(16,185,129,.15); color:#059669; border-color:rgba(16,185,129,.4); }
    .vis-tag.lead-closed { background:var(--bg-hover); color:var(--text-muted); border-color:var(--border-bright); }

    .vis-meta { display:flex; flex-wrap:wrap; gap:.2rem .9rem; font-size:12px; color:var(--text-muted); }
    .vis-meta b { color:var(--text-secondary); font-weight:600; }
    .vis-note { font-size:12.5px; color:var(--text-secondary); background:var(--bg-hover);
      border-left:3px solid var(--border-bright); border-radius:0 8px 8px 0; padding:.4rem .6rem; margin:0;
      overflow-wrap:anywhere; white-space:pre-wrap; }
    /* Small right-aligned buttons, NO divider line — the rule above the row
       is what made the card look heavy with almost no data in it. */
    .vis-actions { display:flex; flex-wrap:wrap; gap:.35rem; justify-content:flex-end;
      margin-top:.1rem; }
    .vis-actions .btn { min-height:26px; padding:3px 10px; font-size:11.5px; font-weight:700;
      border-radius:7px; }
    .vis-empty { text-align:center; padding:3rem 1rem; color:var(--text-muted);
      border:1px dashed var(--border-bright); border-radius:14px; }
    @media (max-width:520px){
      .vis-list { grid-template-columns:1fr; }
      .vis-top { flex-wrap:wrap; }
      .vis-tags { margin-left:0; flex:1 1 100%; }
      .vis-toolbar .vis-fld, .vis-toolbar .vis-fld .input-field { min-width:0; width:100%; }
      .vis-toolbar { flex-direction:column; align-items:stretch; }
    }`;
  document.head.appendChild(st);
};

export const initVisitorAdminUI = async () => {
  const container = document.getElementById("page-visitors");
  if (!container) return;

  const role = localStorage.getItem("userRole");
  if (role === "Student") return; // Blocked

  const canEdit = (role === "Owner/Admin" || role === "Manager");
  const canDelete = (role === "Owner/Admin");

  ensureStyles();

  container.innerHTML = `
    <div class="page-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem;">
      <div>
        <h1>Visitor Management</h1>
        <p class="page-subtitle">Walk-ins and website enquiries — every record in one place</p>
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

    <div class="card" style="margin-bottom: 1.25rem;">
      <div class="vis-toolbar">
        <div class="vis-fld vis-search">
          <span>Search</span>
          <input type="text" id="vis-search" class="input-field" placeholder="Search by name, phone, email, plan…" />
        </div>
        <label class="vis-fld">
          <span>Source</span>
          <select id="vis-filter-source" class="input-field">
            <option value="All">All sources</option>
            <option value="Website">Website</option>
            <option value="Walk-in">Walk-in</option>
          </select>
        </label>
        <label class="vis-fld">
          <span>Enquiry</span>
          <select id="vis-filter-lead" class="input-field">
            <option value="All">All enquiries</option>
            <option value="New">New</option>
            <option value="Converted">Converted</option>
            <option value="Closed">Closed</option>
          </select>
        </label>
      </div>
      <div id="vis-count" style="font-size:12.5px; color:var(--text-muted);"></div>
    </div>

    <div id="vis-list" class="vis-list">
      <div class="vis-empty" style="grid-column:1/-1;">Loading visitors…</div>
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
            <input type="tel" id="add-vis-phone" required placeholder="10-digit phone number" pattern="[0-9]{10}" title="10-digit phone number" class="input-field" style="width: 100%; box-sizing: border-box;" />
          </div>
          <div class="form-group" style="margin-bottom: 1rem;">
            <label style="display:block; margin-bottom:0.25rem; font-size:0.875rem; font-weight:600; color:var(--text-secondary);">Email (Optional)</label>
            <input type="email" id="add-vis-email" placeholder="visitor@example.com" class="input-field" style="width: 100%; box-sizing: border-box;" />
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
  document.getElementById("vis-filter-source").addEventListener("change", renderVis);
  document.getElementById("vis-filter-lead").addEventListener("change", renderVis);

  // Add Button
  document.getElementById("btn-add-visitor").addEventListener("click", () => handleAddVisitor());

  if (unsubVisitors) unsubVisitors();
  unsubVisitors = listenToVisitors((records) => {
    allVisitors = records;
    updateAnalyticsUI();
    renderVis();
  });

  // Mirror of the MAIN student list (approved, non-old) — drives whether the
  // "Mark converted" button exists on a card at all.
  if (unsubStudents) unsubStudents();
  unsubStudents = listenToAllStudents((students) => {
    const main = students.filter(s => !isOldStatus(s) && isAdmitted(s));
    studentPhones = new Set(main.map(s => digits(s.phone).slice(-10)).filter(Boolean));
    studentEmails = new Set(main.map(s => String(s.email || "").trim().toLowerCase()).filter(Boolean));
    renderVis();
  }, (err) => console.error("Students listener failed:", err));
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
  const search = document.getElementById("vis-search").value.toLowerCase().trim();
  const source = document.getElementById("vis-filter-source").value;
  const lead = document.getElementById("vis-filter-lead").value;

  if (search) {
    filtered = filtered.filter(v =>
      (v.visitorName || "").toLowerCase().includes(search) ||
      (v.phone || "").includes(search) ||
      (v.email || "").toLowerCase().includes(search) ||
      (v.planName || "").toLowerCase().includes(search) ||
      (v.employeeName && v.employeeName.toLowerCase().includes(search)) ||
      (v.message || "").toLowerCase().includes(search) ||
      (v.remarks || "").toLowerCase().includes(search)
    );
  }
  if (source !== "All") filtered = filtered.filter(v => normaliseSource(v) === source);
  // Website leads always carry an explicit leadStatus; rows without one are
  // plain walk-ins and only match when the filter is set to "All". A stale
  // "Converted" (person not on the main student list) behaves as no status.
  if (lead !== "All") filtered = filtered.filter(v => effectiveLeadStatus(v) === lead);

  return filtered;
};

const renderVisitors = (canEdit, canDelete) => {
  const list = document.getElementById("vis-list");
  if (!list) return;

  const filtered = getFilteredVisitors();
  const countEl = document.getElementById("vis-count");
  if (countEl) {
    countEl.textContent = filtered.length === allVisitors.length
      ? `${filtered.length} record${filtered.length === 1 ? "" : "s"}`
      : `${filtered.length} of ${allVisitors.length} records`;
  }

  if (filtered.length === 0) {
    list.innerHTML = `<div class="vis-empty" style="grid-column:1/-1;">${
      allVisitors.length === 0 ? "No visitors yet." : "No visitors match these filters."
    }</div>`;
    return;
  }

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

  // WhatsApp invite: opens wa.me with a prefilled "fill your details in the
  // Student Login" message and logs it to Message Logs (same pipeline as
  // student WhatsApp). Available to all staff viewing Visitors.
  window.messageVisitorOnWhatsApp = async (id) => {
    const v = allVisitors.find(x => x.id === id);
    if (!v) {
      if (typeof window.showToast === "function") window.showToast("Visitor not found.", "error");
      return;
    }
    const phoneDigits = String(v.phone || "").replace(/\D/g, "");
    if (phoneDigits.length < 10) {
      if (typeof window.showToast === "function") window.showToast("Visitor phone number is missing.", "error");
      return;
    }
    const name = String(v.visitorName || "there").trim() || "there";
    const message =
      `Hello ${name}, this is Studyhaus Library. ` +
      `Please fill your details in the Student Login here: ${STUDENT_LOGIN_URL} ` +
      `— reply here after submitting.`;
    try {
      await sendWhatsAppMessage(
        { id: v.id, fullName: v.visitorName || "Visitor", phone: v.phone },
        "Visitor Invite",
        message
      );
    } catch (e) {
      if (typeof window.showToast === "function") window.showToast("Could not open WhatsApp: " + (e && e.message ? e.message : e), "error");
    }
  };

  const html = filtered.map(v => {
    const isWebsite = normaliseSource(v) === "Website";
    const leadStatus = effectiveLeadStatus(v);
    const [fg, bg] = tintFor(v.id);

    const srcTag = isWebsite
      ? `<span class="vis-tag src-web">Website</span>`
      : `<span class="vis-tag src-walk">Walk-in</span>`;

    // No badge for an ordinary "New" enquiry — only Converted / Closed are
    // worth a badge; a fresh lead just shows the source tag.
    let leadTag = "";
    if (leadStatus === "Converted") leadTag = `<span class="vis-tag lead-win">Converted</span>`;
    else if (leadStatus === "Closed") leadTag = `<span class="vis-tag lead-closed">Closed</span>`;

    let actions = "";
    if (canEdit) {
      if (isWebsite) {
        // Convert only exists when the person is ALREADY on the main student
        // list — an unknown visitor gets no convert option at all.
        if (leadStatus !== "Converted" && isOnMainStudentList(v)) {
          actions += `<button class="btn btn-secondary" onclick="window.handleLeadStatus('${v.id}', 'Converted')">Mark converted</button>`;
        }
        if (leadStatus !== "Closed") {
          actions += `<button class="btn btn-secondary" onclick="window.handleLeadStatus('${v.id}', 'Closed')">Close enquiry</button>`;
        }
      }
      if (canDelete) {
        actions += `<button class="btn btn-secondary" style="color:var(--danger);" onclick="window.handleDeleteVisitor('${v.id}')">Delete</button>`;
      }
    }

    const contact = [
      v.phone ? `<span><b>Phone</b> <a href="tel:${esc(v.phone)}">${esc(v.phone)}</a></span>` : "",
      `<span><b>Email</b> ${v.email
        ? `<a href="mailto:${esc(v.email)}">${esc(v.email)}</a>`
        : `<span style="color:var(--text-muted)">—</span>`}</span>`,
    ].filter(Boolean).join(`<span class="vis-sep">·</span>`);

    const meta = [
      `<span><b>When</b> ${esc(fmtWhen(v))}</span>`,
      v.planName ? `<span><b>Plan</b> ${esc(v.planName)}</span>` : "",
      `<span><b>Handled by</b> ${v.employeeName ? esc(v.employeeName) : "—"}</span>`,
    ].join("");

    const note = [v.remarks, isWebsite ? v.message : ""].filter(Boolean).join("\n");

    // WhatsApp invite — every card with a phone number gets one (staff-only
    // page already). Green tint so it reads as WhatsApp next to the tel: link.
    const waBtn = v.phone
      ? `<button class="btn btn-secondary" style="color:#059669; border-color:rgba(16,185,129,.4);" onclick="window.messageVisitorOnWhatsApp('${v.id}')" title="Invite on WhatsApp to fill Student Login details">WhatsApp</button>`
      : "";

    const allActions = `${waBtn}${actions}`;
    return `
      <article class="vis-card">
        <div class="vis-top">
          <div class="vis-av" style="background:${bg}; color:${fg};">${esc(initials(v.visitorName))}</div>
          <div class="vis-id">
            <div class="vis-name">${esc(v.visitorName || "Unnamed visitor")}</div>
          </div>
          <div class="vis-tags">${leadTag}${srcTag}</div>
        </div>
        <div class="vis-contact">${contact}</div>
        <div class="vis-meta">${meta}</div>
        ${note ? `<p class="vis-note">${esc(note)}</p>` : ""}
        ${allActions ? `<div class="vis-actions">${allActions}</div>` : ""}
      </article>`;
  }).join("");

  list.innerHTML = html;
};

const handleAddVisitor = () => {
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
  const employeeName = document.getElementById("add-vis-employee").value.trim();
  const remarks = document.getElementById("add-vis-remarks").value.trim();

  if (!name || !phone || !employeeName) {
    window.showToast("Please fill in name, phone and who handled the visit.", "warning");
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
    window.showToast("Error: " + res.error, "error");
  } else {
    document.getElementById("add-visitor-modal").close();
    if (typeof showToast === "function") showToast("Visitor added successfully!");
  }
};
