import { listenToAllComplaints, resolveComplaint, updateComplaintStatus } from "./complaintService.js?v=ui2";
import { filterComplaints } from "./complaintFilter.js";

let allComplaints = [];
let unsubscribe = null;
let currentFilters = { status: "All", category: "All", search: "" };

export const initComplaintAdminUI = () => {
  const container = document.getElementById("page-complaints");
  if (!container) return; 

  const role = localStorage.getItem("userRole");
  if (role === "Student") return; // Security guard

  // Initial UI Setup
  if (!document.getElementById("resolve-complaint-modal")) {
    const modalDiv = document.createElement("div");
    modalDiv.innerHTML = `
      <dialog id="resolve-complaint-modal" style="padding:0; border:none; border-radius:12px; box-shadow:0 10px 15px -3px rgba(0,0,0,0.1); width:90%; max-width:400px;">
        <div style="padding:1.5rem; background:var(--bg-card); border-bottom:1px solid var(--border);">
          <h2 style="font-size:1.25rem; font-weight:700; color:var(--text-primary); margin:0;" id="resolve-modal-title">Resolve Complaint</h2>
        </div>
        <form id="form-resolve-complaint" onsubmit="event.preventDefault(); window.submitResolveComplaint()" style="padding:1.5rem;">
          <input type="hidden" id="resolve-complaint-id" />
          <input type="hidden" id="resolve-complaint-phone" />
          <input type="hidden" id="resolve-complaint-name" />
          <input type="hidden" id="resolve-complaint-category" />
          
          <div class="form-group" style="margin-bottom:1.5rem;">
            <label style="display:block; margin-bottom:0.25rem; font-size:0.875rem; font-weight:600; color:var(--text-secondary);">Resolution Note (Optional)</label>
            <textarea id="resolve-complaint-note" rows="3" class="input-field" placeholder="E.g., Replaced the faulty bulb." style="width:100%; box-sizing:border-box; padding:0.5rem; border: 1px solid var(--border); border-radius:6px; resize:vertical; font-family:inherit;"></textarea>
          </div>
          <div style="display:flex; justify-content:flex-end; gap:0.75rem;">
            <button type="button" class="btn btn-ghost" onclick="document.getElementById('resolve-complaint-modal').close()" style="padding:8px 16px; border:1px solid var(--border); border-radius:999px; background:transparent;">Cancel</button>
            <button type="submit" id="btn-save-resolve" class="btn btn-primary" style="padding:8px 16px; border:none; border-radius:999px; background:var(--primary); color:#fff;">Mark Resolved</button>
          </div>
        </form>
      </dialog>
    `;
    document.body.appendChild(modalDiv.firstElementChild);
  }

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Complaint Management</h1>
        <p class="page-subtitle" id="complaints-subtitle">Loading records...</p>
      </div>
    </div>
    
    <div class="card">
      <div class="toolbar" style="flex-wrap: wrap;">
        <div class="search-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" id="complaint-search" placeholder="Search by student, seat, or ID..." />
        </div>
        
        <select id="complaint-filter-category" style="padding: 0.5rem; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-card); color: var(--text-primary);">
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
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th data-i18n="table.date">\${window.t ? window.t("table.date") : "Date"}</th>
            <th>Student</th>
            <th data-i18n="table.seat">\${window.t ? window.t("table.seat") : "Seat"}</th>
            <th>Category</th>
            <th>Issue Description</th>
            <th data-i18n="table.status">\${window.t ? window.t("table.status") : "Status"}</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="complaint-table-body">
          <tr><td colspan="7" style="text-align:center;">Loading...</td></tr>
        </tbody>
      </table>
    </div>
  `;

  // Listeners
  document.getElementById("complaint-search").addEventListener("input", (e) => {
    currentFilters.search = e.target.value;
    renderComplaintAdminTable();
  });

  document.getElementById("complaint-filter-category").addEventListener("change", (e) => {
    currentFilters.category = e.target.value;
    renderComplaintAdminTable();
  });

  document.querySelectorAll(".comp-filter").forEach(btn => {
    btn.addEventListener("click", (e) => {
      document.querySelectorAll(".comp-filter").forEach(b => b.classList.remove("active"));
      e.target.classList.add("active");
      currentFilters.status = e.target.getAttribute("data-val");
      renderComplaintAdminTable();
    });
  });

  // Global Actions
  window.handleResolveComplaint = (id, phone, name, category) => {
    document.getElementById("resolve-complaint-id").value = id;
    document.getElementById("resolve-complaint-phone").value = phone || "";
    document.getElementById("resolve-complaint-name").value = name || "";
    document.getElementById("resolve-complaint-category").value = category || "";
    document.getElementById("resolve-modal-title").innerText = `Resolve Complaint for ${name}`;
    document.getElementById("form-resolve-complaint").reset();
    document.getElementById("resolve-complaint-modal").showModal();
  };

  window.submitResolveComplaint = async () => {
    const id = document.getElementById("resolve-complaint-id").value;
    const phone = document.getElementById("resolve-complaint-phone").value;
    const name = document.getElementById("resolve-complaint-name").value;
    const category = document.getElementById("resolve-complaint-category").value;
    const note = document.getElementById("resolve-complaint-note").value.trim();
    
    const btn = document.getElementById("btn-save-resolve");
    btn.innerText = "Saving...";
    btn.disabled = true;

    try {
      const resolver = localStorage.getItem("userName") || "Admin";
      const res = await resolveComplaint(id, resolver, note || "Issue resolved.");
      if (res.success) {
        document.getElementById("resolve-complaint-modal").close();
        if(typeof showToast === 'function') showToast("Complaint resolved successfully!");

        // Trigger WhatsApp
        let cleanPhone = (phone || "").replace(/\D/g, "");
        if (cleanPhone.length === 10) cleanPhone = "91" + cleanPhone; // Assume India by default if 10 digits
        
        if (cleanPhone && await window.showCustomConfirm("Notify Student", "Complaint marked as Resolved. Do you want to notify the student via WhatsApp?", "Notify")) {
          const studentData = {
            id: "", // not strictly needed for wa link
            fullName: name,
            phone: cleanPhone
          };
          const text = `Hello ${name},\n\nYour complaint regarding '${category}' has been resolved.\n\nThank you for your patience.`;
          
          // Use global whatsapp service if available
          if (window.sendWhatsAppMessage) {
            window.sendWhatsAppMessage(studentData, "Complaint Update", text);
          } else {
            const encoded = encodeURIComponent(text);
            window.open(`https://wa.me/${cleanPhone}?text=${encoded}`, "_blank");
          }
        }
      } else {
        window.showToast(window.t ? window.t('Error resolving complaint: ') || "Error resolving complaint: " : "Error resolving complaint: " + res.error, "error");
      }
    } catch (err) {
      window.showToast(window.t ? window.t('Error: ') || "Error: " : "Error: " + err.message, "error");
    } finally {
      btn.innerText = "Mark Resolved";
      btn.disabled = false;
    }
  };

  window.handleMarkInProgress = async (id) => {
    const res = await updateComplaintStatus(id, "In Progress");
    if (!res.success) window.showToast(window.t ? window.t('Error: ') || "Error: " : "Error: " + res.error, "error");
  };

  window.handleMarkPending = async (id) => {
    const res = await updateComplaintStatus(id, "Pending");
    if (!res.success) window.showToast(window.t ? window.t('Error: ') || "Error: " : "Error: " + res.error, "error");
  };

  // Start Listener
  if (unsubscribe) unsubscribe();
  unsubscribe = listenToAllComplaints((records) => {
    allComplaints = records;
    renderComplaintAdminTable();
  });
};

const renderComplaintAdminTable = () => {
  const tbody = document.getElementById("complaint-table-body");
  const subtitle = document.getElementById("complaints-subtitle");
  if (!tbody) return;

  const role = localStorage.getItem("userRole");
  const canResolve = ["owner", "manager", "admin"].includes(role?.toLowerCase()); 

  const filtered = filterComplaints(allComplaints, currentFilters);

  // Update Counters
  const pendingCount = allComplaints.filter(r => r.status === "Pending").length;
  if (subtitle) subtitle.innerHTML = `${allComplaints.length} total complaints · <span style="color:var(--danger); font-weight:bold;">${pendingCount} pending</span>`;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color: var(--text-muted);">No complaints found.</td></tr>`;
    return;
  }

  let html = "";
  filtered.forEach(c => {
    let badgeClass = "badge-pending";
    if (c.status === "Resolved" || c.status === "Closed") badgeClass = "badge-paid";
    if (c.status === "In Progress") badgeClass = "badge-info";

    let actionsHtml = `<div style="display:flex; gap:0.25rem; justify-content:flex-end; flex-wrap:wrap;">
      ${c.status !== "Pending" ? `<button class="btn btn-ghost" style="color:var(--text-muted); font-size:10px; padding:2px 6px; border:1px solid var(--border); border-radius:4px;" onclick="window.handleMarkPending('${c.id}')">Pending</button>` : ''}
      ${c.status !== "In Progress" ? `<button class="btn btn-ghost" style="color:var(--primary); font-size:10px; padding:2px 6px; border:1px solid var(--border); border-radius:4px;" onclick="window.handleMarkInProgress('${c.id}')">In Progress</button>` : ''}
      ${c.status !== "Resolved" ? `<button class="btn btn-ghost" style="color:var(--success); font-size:10px; padding:2px 6px; border:1px solid var(--border); border-radius:4px;" onclick="window.handleResolveComplaint('${c.id}', '${c.studentPhone}', '${c.studentName}', '${c.category}')">Resolve</button>` : ''}
    </div>`;

    if (c.status === "Resolved") {
      actionsHtml += `<div style="font-size:0.7rem; color:var(--text-muted); text-align:right; margin-top:4px;">Resolved by: ${c.resolvedBy || 'Unknown'}</div>`;
    }
    
    const resNote = c.resolutionNote ? `<div style="font-size:0.8rem; color:var(--text-muted); margin-top:0.2rem;"><i>Admin: ${c.resolutionNote}</i></div>` : "";

    html += `
      <tr>
        <td>${new Date(c.date).toLocaleDateString()}</td>
        <td>
          <div style="font-weight: 500;">${c.studentName || "Unknown"}</div>
          <div style="font-size: 0.8rem; color: var(--text-muted);">${c.planName || "No Plan"}</div>
        </td>
        <td>${c.seatNumber || "-"}</td>
        <td style="font-weight:600;">${c.category}</td>
        <td><div style="max-width: 250px; overflow: hidden; text-overflow: ellipsis;">${c.description}</div>${resNote}</td>
        <td><span class="badge ${badgeClass}">${c.status.toUpperCase()}</span></td>
        <td><div style="display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap;">${actionsHtml}</div></td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
};
