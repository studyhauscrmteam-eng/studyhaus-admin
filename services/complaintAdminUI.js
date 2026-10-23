import { listenToAllComplaints, resolveComplaint, updateComplaintStatus } from "./complaintService.js";
import { filterComplaints } from "./complaintFilter.js";

let allComplaints = [];
let unsubscribe = null;
let currentFilters = { status: "All", category: "All", search: "" };
let currentViewMode = "cards"; // "cards" or "table"

const esc = (v) =>
  String(v == null ? "" : v).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));

const formatDateTime = (dateVal) => {
  if (!dateVal) return "—";
  try {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return String(dateVal);
    const dateStr = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return `${dateStr} · ${timeStr}`;
  } catch (_) {
    return String(dateVal);
  }
};

export const initComplaintAdminUI = () => {
  const container = document.getElementById("page-complaints");
  if (!container) return;

  const role = localStorage.getItem("userRole");
  if (role === "Student") return;

  // Inject modal if not present
  if (!document.getElementById("resolve-complaint-modal")) {
    const modalWrapper = document.createElement("div");
    modalWrapper.innerHTML = `
      <dialog id="resolve-complaint-modal" style="padding:1.5rem; border:none; border-radius:12px; box-shadow:0 15px 35px rgba(0,0,0,0.3); width:min(460px, 92vw); background:var(--bg-card); color:var(--text-primary); margin:auto;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
          <h3 id="resolve-modal-title" style="margin:0; font-size:1.1rem; font-weight:700;">Resolve Complaint</h3>
          <button type="button" class="btn btn-ghost" onclick="document.getElementById('resolve-complaint-modal').close()" style="font-size:1.1rem; padding:2px 8px;">✕</button>
        </div>
        <form id="form-resolve-complaint" onsubmit="event.preventDefault(); window.submitResolveComplaint()">
          <input type="hidden" id="resolve-complaint-id" />
          <input type="hidden" id="resolve-complaint-phone" />
          <input type="hidden" id="resolve-complaint-name" />
          <input type="hidden" id="resolve-complaint-category" />
          
          <div style="margin-bottom:1rem;">
            <label style="display:block; margin-bottom:0.35rem; font-size:12.5px; font-weight:600; color:var(--text-secondary);">Resolution Note *</label>
            <textarea id="resolve-complaint-note" rows="3" class="input-field" placeholder="E.g., Repaired charger point / Replaced light / Cleaned area" style="width:100%; box-sizing:border-box; padding:8px 10px; border:1px solid var(--border); border-radius:8px; font-size:13px; font-family:inherit; background:var(--bg-base); color:var(--text-primary); resize:vertical;" required></textarea>
          </div>

          <div style="margin-bottom:1.25rem; display:flex; align-items:center; gap:8px;">
            <input type="checkbox" id="resolve-notify-wa" checked style="width:16px; height:16px; cursor:pointer;" />
            <label for="resolve-notify-wa" style="font-size:12.5px; cursor:pointer; color:var(--text-primary); user-select:none;">Notify student via WhatsApp</label>
          </div>

          <div style="display:flex; justify-content:flex-end; gap:0.5rem;">
            <button type="button" class="btn btn-ghost" onclick="document.getElementById('resolve-complaint-modal').close()">Cancel</button>
            <button type="submit" id="btn-save-resolve" class="btn btn-primary" style="background:#16a34a; border-color:#16a34a; color:#fff; font-weight:600; padding:6px 14px;">✓ Mark Resolved</button>
          </div>
        </form>
      </dialog>
    `;
    document.body.appendChild(modalWrapper.firstElementChild);
  }

  container.innerHTML = `
    <div class="page-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem; margin-bottom:1.25rem;">
      <div>
        <h1 data-i18n="menu.complaints" style="margin:0 0 4px 0; font-size:1.5rem; font-weight:700;">${window.t ? window.t("menu.complaints") : "Complaints"}</h1>
        <p class="page-subtitle" id="complaints-subtitle" style="margin:0; font-size:13px; color:var(--text-muted);">Manage and resolve student complaints.</p>
      </div>
    </div>
    
    <div class="card" style="padding:1.25rem;">
      <div class="toolbar" style="display:flex; align-items:center; gap:0.75rem; flex-wrap:wrap; margin-bottom:1.25rem;">
        <div class="search-box" style="flex:1; min-width:240px; max-width:420px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" id="complaint-search" placeholder="Search student, seat, floor, category, issue…" />
        </div>

        <select id="complaint-filter-category" class="input-field" style="width:auto; padding:0.4rem 0.75rem; font-size:12.5px; border-radius:8px; background:var(--bg-card); color:var(--text-primary); border:1px solid var(--border);">
          <option value="All">All Categories</option>
          <option value="Noise">Noise</option>
          <option value="Light">Light</option>
          <option value="Fan">Fan</option>
          <option value="Charging Point">Charging Point</option>
          <option value="Furniture">Furniture</option>
          <option value="Cleaning">Cleaning</option>
          <option value="Washroom">Washroom</option>
          <option value="WiFi">WiFi</option>
          <option value="Others">Others</option>
        </select>

        <div class="filter-tabs">
          <button class="filter-tab comp-filter active" data-val="All">All</button>
          <button class="filter-tab comp-filter" data-val="Pending">Pending</button>
          <button class="filter-tab comp-filter" data-val="In Progress">In Progress</button>
          <button class="filter-tab comp-filter" data-val="Resolved">Resolved</button>
        </div>

        <div style="display:flex; align-items:center; gap:4px; margin-left:auto;">
          <button id="btn-view-cards" class="btn btn-ghost btn-sm" onclick="window.setComplaintViewMode('cards')" style="padding:5px 9px; font-size:12px; border-radius:6px; border:1px solid var(--border);" title="Card View">
            🗂 Cards
          </button>
          <button id="btn-view-table" class="btn btn-ghost btn-sm" onclick="window.setComplaintViewMode('table')" style="padding:5px 9px; font-size:12px; border-radius:6px; border:1px solid var(--border);" title="Table View">
            ☰ Table
          </button>
        </div>
      </div>

      <div id="complaints-content-container">
        <!-- Rendered cards or table will mount here -->
        <div style="text-align:center; padding:2rem; color:var(--text-muted);">Loading complaints…</div>
      </div>
    </div>
  `;

  // Search & Filter Listeners
  document.getElementById("complaint-search").addEventListener("input", (e) => {
    currentFilters.search = e.target.value;
    renderComplaintAdminContent();
  });

  document.getElementById("complaint-filter-category").addEventListener("change", (e) => {
    currentFilters.category = e.target.value;
    renderComplaintAdminContent();
  });

  document.querySelectorAll(".comp-filter").forEach(btn => {
    btn.addEventListener("click", (e) => {
      document.querySelectorAll(".comp-filter").forEach(b => b.classList.remove("active"));
      e.target.classList.add("active");
      currentFilters.status = e.target.getAttribute("data-val");
      renderComplaintAdminContent();
    });
  });

  window.setComplaintViewMode = (mode) => {
    currentViewMode = mode;
    updateViewModeButtons();
    renderComplaintAdminContent();
  };

  const updateViewModeButtons = () => {
    const btnCards = document.getElementById("btn-view-cards");
    const btnTable = document.getElementById("btn-view-table");
    if (btnCards && btnTable) {
      if (currentViewMode === "cards") {
        btnCards.style.background = "var(--bg-hover)";
        btnCards.style.fontWeight = "700";
        btnTable.style.background = "transparent";
        btnTable.style.fontWeight = "500";
      } else {
        btnTable.style.background = "var(--bg-hover)";
        btnTable.style.fontWeight = "700";
        btnCards.style.background = "transparent";
        btnCards.style.fontWeight = "500";
      }
    }
  };

  // Global Actions
  window.handleResolveComplaint = (id, phone, name, category) => {
    document.getElementById("resolve-complaint-id").value = id;
    document.getElementById("resolve-complaint-phone").value = phone || "";
    document.getElementById("resolve-complaint-name").value = name || "";
    document.getElementById("resolve-complaint-category").value = category || "";
    document.getElementById("resolve-modal-title").innerText = `Resolve Complaint — ${name || "Student"}`;
    document.getElementById("resolve-complaint-note").value = "";
    document.getElementById("resolve-complaint-modal").showModal();
  };

  window.submitResolveComplaint = async () => {
    const id = document.getElementById("resolve-complaint-id").value;
    const phone = document.getElementById("resolve-complaint-phone").value;
    const name = document.getElementById("resolve-complaint-name").value;
    const category = document.getElementById("resolve-complaint-category").value;
    const note = document.getElementById("resolve-complaint-note").value.trim();
    const notifyWa = document.getElementById("resolve-notify-wa")?.checked;

    const btn = document.getElementById("btn-save-resolve");
    btn.innerText = "Saving...";
    btn.disabled = true;

    try {
      const resolver = localStorage.getItem("userName") || "Admin";
      const res = await resolveComplaint(id, resolver, note || "Issue has been resolved.");
      if (res.success) {
        document.getElementById("resolve-complaint-modal").close();
        if (typeof showToast === "function") showToast("Complaint resolved successfully!", "success");

        if (notifyWa && phone) {
          let cleanPhone = phone.replace(/\D/g, "");
          if (cleanPhone.length === 10) cleanPhone = "91" + cleanPhone;
          const text = `Hello ${name || "Student"},\n\nYour complaint regarding "${category || "Facility"}" at Shreeji Library has been resolved.\n\nResolution: ${note || "Issue has been resolved."}\n\nThank you for your patience!`;
          if (window.sendWhatsAppMessage) {
            window.sendWhatsAppMessage({ id: "", fullName: name, phone: cleanPhone }, "Complaint Update", text);
          } else {
            const encoded = encodeURIComponent(text);
            window.open(`https://wa.me/${cleanPhone}?text=${encoded}`, "_blank");
          }
        }
      } else {
        if (typeof showToast === "function") showToast("Error resolving complaint: " + res.error, "error");
      }
    } catch (err) {
      if (typeof showToast === "function") showToast("Error: " + err.message, "error");
    } finally {
      btn.innerText = "✓ Mark Resolved";
      btn.disabled = false;
    }
  };

  window.handleMarkInProgress = async (id) => {
    const res = await updateComplaintStatus(id, "In Progress");
    if (!res.success && typeof showToast === "function") showToast("Error: " + res.error, "error");
  };

  window.handleMarkPending = async (id) => {
    const res = await updateComplaintStatus(id, "Pending");
    if (!res.success && typeof showToast === "function") showToast("Error: " + res.error, "error");
  };

  window.openComplaintWhatsApp = (id) => {
    const c = allComplaints.find(x => x.id === id);
    if (!c || !c.studentPhone) return;
    let cleanPhone = c.studentPhone.replace(/\D/g, "");
    if (cleanPhone.length === 10) cleanPhone = "91" + cleanPhone;
    const seatInfo = c.seatNumber ? ` (Seat ${c.seatNumber}${c.seatFloor ? `, ${c.seatFloor}` : ""})` : "";
    const text = `Hello ${c.studentName || "Student"},\nRegarding your complaint about "${c.category || "Facility"}"${seatInfo}: "${c.description || ""}".`;
    window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`, "_blank");
  };

  updateViewModeButtons();

  // Start Listener
  if (unsubscribe) unsubscribe();
  unsubscribe = listenToAllComplaints((records) => {
    allComplaints = records;
    renderComplaintAdminContent();
  });
};

const renderComplaintAdminContent = () => {
  const container = document.getElementById("complaints-content-container");
  const subtitle = document.getElementById("complaints-subtitle");
  if (!container) return;

  const filtered = filterComplaints(allComplaints, currentFilters);

  // Subtitle stats in clean native header
  const total = allComplaints.length;
  const pending = allComplaints.filter(r => r.status === "Pending").length;
  const inProgress = allComplaints.filter(r => r.status === "In Progress").length;
  const resolved = allComplaints.filter(r => r.status === "Resolved" || r.status === "Closed").length;

  if (subtitle) {
    subtitle.innerHTML = `${total} total complaints · <span style="color:var(--danger, #ef4444); font-weight:700;">${pending} pending attention</span> · ${inProgress} in progress · ${resolved} resolved`;
  }

  if (filtered.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding:2.5rem; color:var(--text-muted); font-size:14px;">No complaints match the selected filter.</div>`;
    return;
  }

  if (currentViewMode === "cards") {
    renderCardsView(container, filtered);
  } else {
    renderTableView(container, filtered);
  }
};

/**
 * Beautiful, full-width responsive Cards view — ensures full readability of descriptions
 */
const renderCardsView = (container, records) => {
  let html = `<div style="display:flex; flex-direction:column; gap:12px;">`;

  records.forEach(c => {
    const isPending = c.status === "Pending";
    const isInProgress = c.status === "In Progress";

    let badgeClass = "badge-paid";
    let statusText = "RESOLVED";
    if (isPending) {
      badgeClass = "badge-pending";
      statusText = "PENDING";
    } else if (isInProgress) {
      badgeClass = "badge-info";
      statusText = "IN PROGRESS";
    }

    const seatNum = c.seatNumber || "";
    const seatFloor = c.seatFloor || (seatNum ? "Ground Floor" : "");
    const seatDisplay = seatNum
      ? `Seat ${esc(seatNum)} (${esc(seatFloor)})`
      : `No seat assigned`;

    let actionsHtml = `<div style="display:flex; gap:6px; align-items:center;">`;
    if (isPending) {
      actionsHtml += `
        <button class="btn btn-ghost btn-sm" onclick="window.handleMarkInProgress('${c.id}')" style="font-size:12px; padding:4px 9px; border:1px solid var(--border); border-radius:6px;">In Progress</button>
        <button class="btn btn-primary btn-sm" onclick="window.handleResolveComplaint('${c.id}', '${esc(c.studentPhone)}', '${esc(c.studentName)}', '${esc(c.category)}')" style="font-size:12px; padding:4px 10px; background:#16a34a; border-color:#16a34a; color:#fff; border-radius:6px; font-weight:600;">✓ Resolve</button>
      `;
    } else if (isInProgress) {
      actionsHtml += `
        <button class="btn btn-primary btn-sm" onclick="window.handleResolveComplaint('${c.id}', '${esc(c.studentPhone)}', '${esc(c.studentName)}', '${esc(c.category)}')" style="font-size:12px; padding:4px 10px; background:#16a34a; border-color:#16a34a; color:#fff; border-radius:6px; font-weight:600;">✓ Resolve</button>
        <button class="btn btn-ghost btn-sm" onclick="window.handleMarkPending('${c.id}')" style="font-size:12px; padding:4px 8px; color:var(--text-muted); border:1px solid var(--border); border-radius:6px;">Reset</button>
      `;
    } else {
      actionsHtml += `
        <button class="btn btn-ghost btn-sm" onclick="window.handleMarkPending('${c.id}')" style="font-size:12px; padding:4px 9px; border:1px solid var(--border); border-radius:6px;">Reopen</button>
      `;
    }

    if (c.studentPhone) {
      actionsHtml += `
        <button class="btn btn-ghost btn-sm" onclick="window.openComplaintWhatsApp('${c.id}')" title="Chat on WhatsApp" style="color:#16a34a; padding:4px 8px; border:1px solid rgba(22,163,74,0.3); border-radius:6px; display:inline-flex; align-items:center;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
        </button>
      `;
    }
    actionsHtml += `</div>`;

    html += `
      <div class="complaint-card-row" style="background:var(--bg-card); border:1px solid var(--border); border-radius:12px; padding:14px 18px; box-shadow:0 1px 3px rgba(0,0,0,0.04);">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:10px; border-bottom:1px solid var(--border); padding-bottom:10px; margin-bottom:12px;">
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <span style="font-size:14.5px; font-weight:700; color:var(--text-primary); cursor:pointer;" onclick="if(window.openStudentProfileById) window.openStudentProfileById('${esc(c.studentId)}')">
              ${esc(c.studentName || "Student")}
            </span>
            ${c.studentPhone ? `<a href="tel:${esc(c.studentPhone)}" style="font-size:12.5px; color:var(--primary); text-decoration:none; font-weight:500;">${esc(c.studentPhone)}</a>` : ""}
            <span style="display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:6px; background:var(--bg-hover); border:1px solid var(--border); font-size:12px; font-weight:600; color:var(--text-secondary);">
              ${seatDisplay}
            </span>
            <span class="badge" style="background:rgba(59,130,246,0.1); color:#3b82f6; border:1px solid rgba(59,130,246,0.25); font-size:11.5px; font-weight:600; padding:2px 8px; border-radius:999px;">
              ${esc(c.category || "General")}
            </span>
            <span style="font-size:12px; color:var(--text-muted);">
              ${formatDateTime(c.date || c.createdAt)}
            </span>
          </div>

          <div style="display:flex; align-items:center; gap:8px;">
            <span class="badge ${badgeClass}" style="font-size:11px; font-weight:700; padding:3px 9px; border-radius:999px;">
              ${statusText}
            </span>
            ${actionsHtml}
          </div>
        </div>

        <div style="font-size:14px; line-height:1.6; color:var(--text-primary); word-break:break-word; margin-bottom:${c.resolutionNote ? '10px' : '0'};">
          ${esc(c.description || "No description provided.")}
        </div>

        ${c.resolutionNote ? `
          <div style="display:flex; align-items:flex-start; gap:8px; font-size:12.5px; line-height:1.5; background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.25); border-left:4px solid #10b981; padding:8px 12px; border-radius:6px; color:var(--text-primary);">
            <span style="font-weight:700; color:#059669; white-space:nowrap;">✓ Resolution:</span>
            <span>${esc(c.resolutionNote)} ${c.resolvedBy ? `<span style="color:var(--text-muted); font-size:11.5px; margin-left:6px;">— resolved by ${esc(c.resolvedBy)}</span>` : ""}</span>
          </div>
        ` : ""}
      </div>
    `;
  });

  html += `</div>`;
  container.innerHTML = html;
};

/**
 * Clean, properly proportioned Table view with scroll container so description is never crushed
 */
const renderTableView = (container, records) => {
  let html = `
    <div class="table-container" style="overflow-x:auto;">
      <table class="data-table" style="width:100%; min-width:850px; table-layout:auto;">
        <thead>
          <tr>
            <th style="width:130px; white-space:nowrap;">Date & Time</th>
            <th style="width:170px;">Student</th>
            <th style="width:150px;">Seat & Floor</th>
            <th style="width:110px;">Category</th>
            <th style="min-width:280px;">Issue Description</th>
            <th style="width:110px;">Status</th>
            <th style="width:150px; text-align:right;">Actions</th>
          </tr>
        </thead>
        <tbody>
  `;

  records.forEach(c => {
    const isPending = c.status === "Pending";
    const isInProgress = c.status === "In Progress";
    
    let badgeClass = "badge-paid";
    let statusText = "RESOLVED";
    if (isPending) {
      badgeClass = "badge-pending";
      statusText = "PENDING";
    } else if (isInProgress) {
      badgeClass = "badge-info";
      statusText = "IN PROGRESS";
    }

    const seatNum = c.seatNumber || "";
    const seatFloor = c.seatFloor || (seatNum ? "Ground Floor" : "");
    const seatDisplay = seatNum
      ? `<div style="font-weight:600;">Seat ${esc(seatNum)}</div><div style="font-size:11.5px; color:var(--text-muted);">${esc(seatFloor)}</div>`
      : `<span style="color:var(--text-muted); font-size:12px;">Not assigned</span>`;

    const resNote = c.resolutionNote
      ? `<div style="font-size:11.5px; color:var(--text-muted); margin-top:4px;"><i>Resolution: ${esc(c.resolutionNote)}${c.resolvedBy ? ` — by ${esc(c.resolvedBy)}` : ""}</i></div>`
      : "";

    let actionsHtml = `<div style="display:flex; gap:4px; justify-content:flex-end; align-items:center;">`;
    if (isPending) {
      actionsHtml += `
        <button class="btn btn-ghost btn-sm" onclick="window.handleMarkInProgress('${c.id}')" style="font-size:11px; padding:3px 7px;">In Progress</button>
        <button class="btn btn-primary btn-sm" onclick="window.handleResolveComplaint('${c.id}', '${esc(c.studentPhone)}', '${esc(c.studentName)}', '${esc(c.category)}')" style="font-size:11px; padding:3px 8px; background:#16a34a; border-color:#16a34a; color:#fff;">Resolve</button>
      `;
    } else if (isInProgress) {
      actionsHtml += `
        <button class="btn btn-primary btn-sm" onclick="window.handleResolveComplaint('${c.id}', '${esc(c.studentPhone)}', '${esc(c.studentName)}', '${esc(c.category)}')" style="font-size:11px; padding:3px 8px; background:#16a34a; border-color:#16a34a; color:#fff;">Resolve</button>
        <button class="btn btn-ghost btn-sm" onclick="window.handleMarkPending('${c.id}')" style="font-size:11px; padding:3px 6px; color:var(--text-muted);">Reset</button>
      `;
    } else {
      actionsHtml += `
        <button class="btn btn-ghost btn-sm" onclick="window.handleMarkPending('${c.id}')" style="font-size:11px; padding:3px 7px; color:var(--text-muted);">Reopen</button>
      `;
    }

    if (c.studentPhone) {
      actionsHtml += `
        <button class="btn btn-ghost btn-sm" onclick="window.openComplaintWhatsApp('${c.id}')" title="Chat with student on WhatsApp" style="color:#16a34a; padding:3px 5px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
        </button>
      `;
    }
    actionsHtml += `</div>`;

    html += `
      <tr>
        <td style="white-space:nowrap; vertical-align:top; padding:10px 12px;">${formatDateTime(c.date || c.createdAt)}</td>
        <td style="vertical-align:top; padding:10px 12px;">
          <div style="font-weight:600; color:var(--text-primary); cursor:pointer;" onclick="if(window.openStudentProfileById) window.openStudentProfileById('${esc(c.studentId)}')">${esc(c.studentName || "Student")}</div>
          <div style="font-size:11.5px; color:var(--text-muted);">${c.studentPhone ? esc(c.studentPhone) : "No phone"}</div>
        </td>
        <td style="vertical-align:top; padding:10px 12px;">${seatDisplay}</td>
        <td style="vertical-align:top; padding:10px 12px;"><span class="badge" style="background:var(--bg-hover); color:var(--text-secondary); border:1px solid var(--border); font-size:11.5px; font-weight:600;">${esc(c.category || "General")}</span></td>
        <td style="vertical-align:top; padding:10px 12px; line-height:1.5; color:var(--text-primary); word-break:break-word;">
          <div style="font-size:13.5px;">${esc(c.description || "—")}</div>
          ${resNote}
        </td>
        <td style="vertical-align:top; padding:10px 12px;"><span class="badge ${badgeClass}">${statusText}</span></td>
        <td style="text-align:right; vertical-align:top; padding:10px 12px;">${actionsHtml}</td>
      </tr>
    `;
  });

  html += `
        </tbody>
      </table>
    </div>
  `;
  container.innerHTML = html;
};
