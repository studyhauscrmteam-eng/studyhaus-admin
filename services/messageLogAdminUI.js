import { listenToMessageLogs } from "./messageLogService.js";

let allLogs = [];

export const initMessageLogAdminUI = () => {
  const container = document.getElementById("page-message-logs");
  if (!container) return;

  const role = localStorage.getItem("userRole");
  if (role === "Student") return; // Blocked

  container.innerHTML = `
    <div class="page-header" style="display:flex; justify-content:space-between; align-items:center;">
      <div>
        <h1>WhatsApp Message Logs</h1>
        <p class="page-subtitle">History of all communications sent via WhatsApp</p>
      </div>
    </div>

    <div class="card" style="margin-bottom: 2rem;">
      <div class="toolbar" style="flex-wrap:wrap; gap:1rem;">
        <div class="search-box">
          <input type="text" id="log-search" placeholder="Search by name, phone, template..." />
        </div>
        <div>
          <select id="log-filter-template" class="input-field" style="width:180px;">
            <option value="All">All Templates</option>
          </select>
        </div>
        <div>
          <select id="log-filter-sender" class="input-field" style="width:150px;">
            <option value="All">All Senders</option>
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
              <th>Student Name</th>
              <th data-i18n="table.phone">\${window.t ? window.t("table.phone") : "Phone"}</th>
              <th>Template</th>
              <th>Message Preview</th>
              <th>Sent By</th>
              <th data-i18n="table.status">\${window.t ? window.t("table.status") : "Status"}</th>
            </tr>
          </thead>
          <tbody id="log-tbody">
            <tr><td colspan="7" style="text-align:center;">Loading logs...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Attach Listeners
  const renderList = () => renderLogs();
  document.getElementById("log-search").addEventListener("input", renderList);
  document.getElementById("log-filter-template").addEventListener("change", renderList);
  document.getElementById("log-filter-sender").addEventListener("change", renderList);

  listenToMessageLogs((logs) => {
    allLogs = logs;
    populateDropdowns();
    renderList();
  });
};

const populateDropdowns = () => {
  const tplSelect = document.getElementById("log-filter-template");
  const sndSelect = document.getElementById("log-filter-sender");
  if (!tplSelect || !sndSelect) return;

  const tplVal = tplSelect.value;
  const sndVal = sndSelect.value;

  const templates = new Set();
  const senders = new Set();

  allLogs.forEach(l => {
    templates.add(l.templateName);
    senders.add(l.sentBy);
  });

  let tplHtml = `<option value="All">All Templates</option>`;
  Array.from(templates).sort().forEach(t => {
    tplHtml += `<option value="${t}">${t}</option>`;
  });
  tplSelect.innerHTML = tplHtml;
  tplSelect.value = tplVal || "All";

  let sndHtml = `<option value="All">All Senders</option>`;
  Array.from(senders).sort().forEach(s => {
    sndHtml += `<option value="${s}">${s}</option>`;
  });
  sndSelect.innerHTML = sndHtml;
  sndSelect.value = sndVal || "All";
};

const getFilteredLogs = () => {
  let filtered = [...allLogs];
  const search = document.getElementById("log-search").value.toLowerCase();
  const tpl = document.getElementById("log-filter-template").value;
  const snd = document.getElementById("log-filter-sender").value;

  if (search) {
    filtered = filtered.filter(l => 
      l.studentName.toLowerCase().includes(search) || 
      l.phone.includes(search) ||
      l.templateName.toLowerCase().includes(search)
    );
  }
  if (tpl !== "All") filtered = filtered.filter(l => l.templateName === tpl);
  if (snd !== "All") filtered = filtered.filter(l => l.sentBy === snd);

  return filtered;
};

const renderLogs = () => {
  const tbody = document.getElementById("log-tbody");
  if (!tbody) return;

  const filtered = getFilteredLogs();

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;">No message logs found.</td></tr>`;
    return;
  }

  let html = "";
  filtered.forEach(l => {
    const snippet = l.message.length > 50 ? l.message.substring(0, 50) + "..." : l.message;
    html += `
      <tr>
        <td style="font-size:0.85rem; color:var(--text-muted);">${l.sentDate}</td>
        <td style="font-weight:600;">${l.studentName}</td>
        <td>${l.phone}</td>
        <td><span class="badge" style="background:#e5e7eb; color:#374151;">${l.templateName}</span></td>
        <td style="font-size:0.85rem; max-width: 250px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${l.message}">
          ${snippet}
        </td>
        <td>${l.sentBy}</td>
        <td><span class="badge badge-paid">${l.status}</span></td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
};
