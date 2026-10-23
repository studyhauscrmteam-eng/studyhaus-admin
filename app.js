// ==================== DARK / LIGHT THEME TOGGLE ====================
function toggleTheme() {
  const isLight = document.body.classList.toggle('light-mode');
  const moon = document.getElementById('icon-moon');
  const sun = document.getElementById('icon-sun');

  if (isLight) {
    if (moon) moon.style.display = 'block';
    if (sun) sun.style.display = 'none';
  } else {
    if (moon) moon.style.display = 'none';
    if (sun) sun.style.display = 'block';
  }
  // Persist preference
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
}

// Apply saved theme on load
(function applyTheme() {
  const isLight = localStorage.getItem('theme') === 'light';
  if (isLight) {
    document.body.classList.add('light-mode');
  }
  const moon = document.getElementById('icon-moon');
  const sun = document.getElementById('icon-sun');
  if (isLight) {
    if (moon) moon.style.display = 'block';
    if (sun) sun.style.display = 'none';
  } else {
    if (moon) moon.style.display = 'none';
    if (sun) sun.style.display = 'block';
  }
})();

// ==================== NAVIGATION ====================
function navigate(page) {
  // SPA Authorization check
  const role = localStorage.getItem("userRole");
  if (role === "Employee") {
    const restrictedPages = ["admissions", "documents", "expenses", "analytics", "reports", "settings", "staff", "old-students", "message-logs", "memberships"];
    if (restrictedPages.includes(page)) {
      if (typeof showToast === 'function') showToast("Access Denied: You do not have permission to view this page.", "error");
      return;
    }
  } else if (role === "Student") {
    const restrictedPages = ["admissions", "expenses", "analytics", "reports", "staff", "students", "seats", "message-logs", "memberships", "visitors", "attendance", "payments", "complaints"];
    if (restrictedPages.includes(page)) {
      if (typeof showToast === 'function') showToast("Access Denied.", "error");
      return;
    }
  }

  // Hide all pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  // Show target page
  const target = document.getElementById('page-' + page);
  if (target) target.classList.add('active');

  // Update sidebar active state
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.remove('active');
    if (item.getAttribute('data-page') === page) {
      item.classList.add('active');
    }
  });

  // Load dynamic data for specific pages
  if (page === 'students' && typeof window.renderStudentTable === 'function') {
    window.renderStudentTable();
  }
  if (page === 'documents' && typeof window.renderGlobalDocuments === 'function') {
    window.renderGlobalDocuments();
  }
  if (page === 'analytics' && typeof window.__renderAnalytics === 'function') {
    window.__renderAnalytics();
  }

  // Entering a page clears its unread badge on sight
  try {
    if (page === 'notifications') {
      if (typeof window.__onNotificationsPageOpened === 'function') {
        window.__onNotificationsPageOpened();
      } else if (typeof window.__refreshNotifBadges === 'function') {
        setTimeout(() => { try { window.__refreshNotifBadges(); } catch (_) {} }, 0);
      }
    } else if (page === 'complaints') {
      if (typeof window.__onComplaintsPageOpened === 'function') {
        window.__onComplaintsPageOpened();
      }
    }
  } catch (_) {}

  // On mobile, close sidebar after navigation
  if (window.innerWidth <= 768) {
    document.getElementById('sidebar').classList.remove('mobile-open');
  }
}

// ==================== SIDEBAR TOGGLE ====================
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (window.innerWidth <= 768) {
    sidebar.classList.toggle('mobile-open');
  } else {
    sidebar.classList.toggle('collapsed');
  }
}

// ==================== FILTER TABS ====================
document.querySelectorAll('.filter-tab').forEach(tab => {
  tab.addEventListener('click', function () {
    const group = this.closest('.filter-tabs');
    group.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
    this.classList.add('active');
  });
});

// ==================== SEAT CLICK ====================
document.querySelectorAll('.seat').forEach(seat => {
  seat.addEventListener('click', function () {
    const title = this.getAttribute('title') || 'Seat info';
    const parts = title.split(' - ');
    const seatId = parts[0];
    const info = parts[1] || 'No info';
    showToast(`${seatId}: ${info}`, 'info');
  });
});

// ==================== TOAST NOTIFICATION ====================
function showToast(message, type = 'success') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast toast-' + type;
  toast.textContent = message;

  if (typeof toast.showPopover === 'function') {
    toast.setAttribute('popover', 'manual');
  }

  document.body.appendChild(toast);

  if (typeof toast.showPopover === 'function') {
    toast.showPopover();
  }

  // Animate in
  setTimeout(() => toast.classList.add('toast-visible'), 10);
  // Auto-dismiss
  setTimeout(() => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Toast styles injected dynamically
const toastStyles = document.createElement('style');
toastStyles.textContent = `
  .toast {
    position: fixed; top: auto; left: auto; bottom: 1.5rem; right: 1.5rem; z-index: 99999;
    padding: 0.75rem 1.25rem; border-radius: 10px; border: none;
    font-size: 13.5px; font-weight: 600; color: #fff;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    transform: translateY(20px); opacity: 0; margin: 0;
    transition: all 0.25s cubic-bezier(0.4,0,0.2,1);
    max-width: 320px;
  }

  .toast-visible { transform: translateY(0); opacity: 1; }
  .toast-success { background: #10b981; }
  .toast-info    { background: #3b82f6; }
  .toast-warning { background: #f59e0b; }
  .toast-error   { background: #f43f5e; }
`;
document.head.appendChild(toastStyles);

// Override native alert with custom toast
window.alert = function (msg) {
  let type = 'info';
  const lowerMsg = String(msg).toLowerCase();

  if (lowerMsg.includes('error') || lowerMsg.includes('fail') || lowerMsg.includes('invalid') || lowerMsg.includes('denied')) {
    type = 'error';
  } else if (lowerMsg.includes('success') || lowerMsg.includes('saved') || lowerMsg.includes('updated') || lowerMsg.includes('approved') || lowerMsg.includes('admitted')) {
    type = 'success';
  } else if (lowerMsg.includes('warning') || lowerMsg.includes('required') || lowerMsg.includes('missing') || lowerMsg.includes('please')) {
    type = 'warning';
  }

  window.showToast(msg, type);
};

// ==================== CUSTOM MODALS ====================
if (!document.getElementById('modal-styles')) {
  const modalStyles = document.createElement('style');
  modalStyles.id = 'modal-styles';
  modalStyles.textContent = `
    @keyframes smoothPopup {
      from { opacity: 0; transform: scale(0.95) translateY(-10px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }
    .smooth-modal {
      animation: smoothPopup 0.25s cubic-bezier(0.4, 0, 0.2, 1) forwards;
    }
    .smooth-modal::backdrop {
      background: rgba(0,0,0,0.4);
      backdrop-filter: blur(4px);
      animation: fadeIn 0.25s ease-out forwards;
    }
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
  `;
  document.head.appendChild(modalStyles);
}

window.showCustomConfirm = (title, message, confirmText = "Confirm", isDanger = false) => {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "card smooth-modal";
    dialog.style.cssText = "border:none; border-radius:12px; padding:0; box-shadow:0 10px 30px rgba(0,0,0,0.5); background: var(--bg-card, #fff); color: var(--text-primary, #0f172a); max-width: 400px; margin: auto;";
    dialog.innerHTML = `
      <div style="padding: 1.5rem; text-align: center;">
        <h3 style="margin-bottom: 0.5rem; font-size: 1.25rem;">${title}</h3>
        <p style="color: var(--text-secondary, #475569); margin-bottom: 1.5rem; font-size: 0.95rem;">${message}</p>
        <div style="display: flex; gap: 1rem; justify-content: center;">
          <button class="btn btn-ghost" id="confirm-cancel" style="flex: 1; border: 1px solid var(--border, #e2e8f0); border-radius: 999px;">Cancel</button>
          <button class="btn btn-primary" id="confirm-ok" style="flex: 1; border: none; border-radius: 999px; color: #fff; ${isDanger ? 'background: #f43f5e;' : 'background: #0f172a;'}">${confirmText}</button>
        </div>
      </div>
    `;
    document.body.appendChild(dialog);
    dialog.showModal();
    dialog.querySelector("#confirm-cancel").onclick = () => { dialog.close(); dialog.remove(); resolve(false); };
    dialog.querySelector("#confirm-ok").onclick = () => { dialog.close(); dialog.remove(); resolve(true); };
  });
};

window.showCustomPrompt = (title, message, confirmText = "Submit", isDanger = false, defaultValue = "") => {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "card smooth-modal";
    dialog.style.cssText = "border:none; border-radius:12px; padding:0; box-shadow:0 10px 30px rgba(0,0,0,0.5); background: var(--bg-card, #fff); color: var(--text-primary, #0f172a); max-width: 400px; margin: auto;";
    dialog.innerHTML = `
      <div style="padding: 1.5rem;">
        <h3 style="margin-bottom: 0.5rem; font-size: 1.25rem; text-align: center;">${title}</h3>
        <p style="color: var(--text-secondary, #475569); margin-bottom: 1rem; font-size: 0.95rem; text-align: center;">${message}</p>
        <div class="form-group" style="margin-bottom: 1.5rem;">
          <input type="text" id="prompt-input" value="${defaultValue}" class="input-field" style="width: 100%; box-sizing: border-box; padding: 0.5rem; border:1px solid var(--border, #e2e8f0); border-radius:6px;" autofocus />
        </div>
        <div style="display: flex; gap: 1rem; justify-content: center;">
          <button class="btn btn-ghost" id="prompt-cancel" style="flex: 1; border: 1px solid var(--border, #e2e8f0); border-radius: 999px;">Cancel</button>
          <button class="btn btn-primary" id="prompt-ok" style="flex: 1; border: none; border-radius: 999px; color: #fff; ${isDanger ? 'background: #f43f5e;' : 'background: #0f172a;'}">${confirmText}</button>
        </div>
      </div>
    `;
    document.body.appendChild(dialog);
    dialog.showModal();
    dialog.querySelector("#prompt-cancel").onclick = () => { dialog.close(); dialog.remove(); resolve(null); };
    dialog.querySelector("#prompt-ok").onclick = () => {
      const val = dialog.querySelector("#prompt-input").value;
      dialog.close(); dialog.remove(); resolve(val);
    };
  });
};

// ==================== TASK CHECKBOXES ====================
document.querySelectorAll('.task-item input[type=checkbox]').forEach(cb => {
  cb.addEventListener('change', function () {
    const info = this.closest('.task-item').querySelector('.task-info');
    const badge = this.closest('.task-item').querySelector('.badge');
    if (this.checked) {
      info.classList.add('done');
      if (badge) {
        badge.className = 'badge badge-paid';
        badge.textContent = 'Done';
      }
      showToast('Task marked as complete ✓', 'success');
    } else {
      info.classList.remove('done');
      if (badge) {
        badge.className = 'badge badge-pending';
        badge.textContent = 'Open';
      }
    }
  });
});

// ==================== FORM INPUTS ====================
document.querySelectorAll('.form-group input, .form-group select, .form-group textarea').forEach(el => {
  el.addEventListener('focus', function () {
    this.closest('.form-group')?.querySelector('label')?.style.setProperty('color', '#10b981');
  });
  el.addEventListener('blur', function () {
    this.closest('.form-group')?.querySelector('label')?.style.removeProperty('color');
  });
});

// ==================== ADMISSION FORM STEPS ====================
const nextBtn = document.querySelector('.admission-form-card .btn-primary');
let currentStep = 1;
if (nextBtn) {
  nextBtn.addEventListener('click', function () {
    if (currentStep < 4) {
      currentStep++;
      updateStepper(currentStep);
      if (currentStep === 4) {
        this.textContent = 'Submit Admission';
        this.style.background = '#8b5cf6';
      }
    } else {
      showToast('Admission submitted successfully.', 'success');
      currentStep = 1;
      updateStepper(1);
      nextBtn.textContent = 'Next: Plan Selection →';
      nextBtn.style.background = '';
    }
  });
}

function updateStepper(step) {
  document.querySelectorAll('.step').forEach((s, i) => {
    s.classList.toggle('active', i < step);
  });
  const labels = ['Next: Plan Selection →', 'Next: Seat Assignment →', 'Next: Initial Payment →', 'Submit Admission'];
  if (nextBtn && step <= 4) {
    nextBtn.textContent = labels[step - 1];
  }
}

// ==================== SETTINGS SAVE ====================
const saveBtn = document.querySelector('#page-settings .btn-primary');
if (saveBtn) {
  saveBtn.addEventListener('click', () => showToast('Settings saved successfully!', 'success'));
}

// ==================== COLLECT PAYMENT BUTTONS ====================
document.querySelectorAll('.btn-xs').forEach(btn => {
  btn.addEventListener('click', function (e) {
    if (this.hasAttribute('onclick') || this.id) return;
    e.stopPropagation();
    const text = this.textContent.trim();
    if (text === 'Collect') showToast('Payment collected successfully!', 'success');
    else if (text === 'Receipt') showToast('Receipt downloaded!', 'info');
    else if (text === 'Download') showToast('Document downloaded!', 'info');
    else if (text === 'Generate PDF') showToast('Generating report…', 'info');
  });
});

// ==================== PRIMARY BUTTONS ====================
document.querySelectorAll('.btn-primary').forEach(btn => {
  if (!btn.closest('.admission-form-card') && btn.id !== 'save-settings') {
    btn.addEventListener('click', function (e) {
      if (this.hasAttribute('onclick') || this.id) return;
      const text = this.textContent.trim();
      if (text.includes('New admission') || text.includes('Add Student')) {
        navigate('admissions');
      } else if (text.includes('New Plan') || text.includes('Log') || text.includes('Add') || text.includes('Upload') || text.includes('Mark')) {
        showToast('Feature panel opening soon…', 'info');
      }
    });
  }
});

// ==================== KEYBOARD SHORTCUTS ====================
document.addEventListener('keydown', function (e) {
  if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
    const search = document.querySelector('.topbar-search input');
    if (document.activeElement !== search) {
      e.preventDefault();
      search?.focus();
    }
  }
  if (e.key === 'Escape') {
    const search = document.querySelector('.topbar-search input');
    search?.blur();
    document.getElementById('lang-dropdown')?.classList.remove('open');
    if (window.innerWidth <= 768) {
      document.getElementById('sidebar').classList.remove('mobile-open');
    }
  }
});

// ==================== ANIMATE BARS ON ANALYTICS PAGE ====================
function animateBars() {
  const bars = document.querySelectorAll('#page-analytics .bar');
  bars.forEach((bar, i) => {
    bar.style.height = '0%';
    setTimeout(() => {
      bar.style.height = bar.style.getPropertyValue('--h') || getComputedStyle(bar).getPropertyValue('--h');
    }, i * 100 + 100);
  });
}

// Observe when analytics page becomes active
const analyticsPage = document.getElementById('page-analytics');
const observer = new MutationObserver((mutations) => {
  mutations.forEach(m => {
    if (m.target.classList.contains('active')) animateBars();
  });
});
if (analyticsPage) observer.observe(analyticsPage, { attributes: true, attributeFilter: ['class'] });



// ==================== NOTIFICATION READ ====================
document.querySelectorAll('.notif-item.unread').forEach(item => {
  item.addEventListener('click', function () {
    this.classList.remove('unread');
    const dot = this.querySelector('.dot-unread');
    if (dot) dot.remove();
    // Update badge count
    const unread = document.querySelectorAll('.notif-item.unread').length;
    const badge = document.querySelector('.nav-badge');
    if (badge) badge.textContent = unread || '';
    if (!unread && badge) badge.style.display = 'none';
  });
});

// ==================== DOCUMENTS (upload / list / download) ====================
// Loads the document service directly if firebase-entry.js hasn't exposed it
// (e.g. that module failed to evaluate for an unrelated reason).
const ensureDocService = async () => {
  if (typeof window.uploadGlobalDocument === 'function' &&
      typeof window.loadGlobalDocuments === 'function' &&
      typeof window.downloadBase64File === 'function') return true;
  try {
    const mod = await import('./services/documentUploadService.js');
    window.uploadGlobalDocument = mod.uploadGlobalDocument;
    window.loadGlobalDocuments = mod.loadGlobalDocuments;
    window.loadAllStudentDocuments = mod.loadAllStudentDocuments;
    window.downloadBase64File = mod.downloadBase64File;
    return true;
  } catch (e) {
    console.error('Could not load document service:', e);
    return false;
  }
};

window.uploadGenericDocument = async (input) => {
  if (input.files && input.files.length > 0) {
    const file = input.files[0];
    if (typeof showToast === 'function') showToast(`Uploading ${file.name}...`, 'info');
    try {
      if (!(await ensureDocService())) {
        throw new Error("Document service could not be loaded.");
      }
      await window.uploadGlobalDocument(file, file.name, "Generic Document");
      if (typeof showToast === 'function') showToast('Document uploaded successfully!', 'success');
      input.value = ''; // reset
      if (typeof window.renderGlobalDocuments === 'function') {
        window.renderGlobalDocuments();
      }
    } catch (e) {
      console.error("Upload error:", e);
      if (typeof showToast === 'function') showToast(`Upload failed: ${e.message}`, 'error');
    }
  }
};

window.renderGlobalDocuments = async () => {
  const container = document.getElementById("document-list-container");
  if (!container) return;

  if (!document.getElementById("doc-spinner-style")) {
    const st = document.createElement("style");
    st.id = "doc-spinner-style";
    st.textContent = `@keyframes doc-spin { to { transform: rotate(360deg); } }
      #document-list-container .doc-spinner { width:28px; height:28px; border-radius:50%;
        border:3px solid rgba(128,128,128,.25); border-top-color: var(--primary, #8b5cf6);
        animation: doc-spin .8s linear infinite; }
      #document-list-container .lib-docs-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:1.25rem; }
      #document-list-container .doc-thumb { width:56px; height:56px; border-radius:10px; overflow:hidden; flex-shrink:0;
        background:var(--bg-hover); display:flex; align-items:center; justify-content:center; color:var(--primary); cursor:pointer; }
      #document-list-container .doc-thumb img { width:100%; height:100%; object-fit:cover; }`;
    document.head.appendChild(st);
  }

  container.innerHTML = `<div style="text-align:center;padding:2.5rem;"><div class="doc-spinner" style="margin:0 auto;"></div><p style="margin-top:.75rem;color:var(--text-secondary);font-size:13.5px;">Loading library documents...</p></div>`;

  try {
    if (!(await ensureDocService())) {
      throw new Error("Document service could not be loaded.");
    }

    // Load ONLY Library Documents (globalDocuments) — No student KYC here!
    const docs = await window.loadGlobalDocuments();
    window.__globalDocs = docs || [];

    if (!docs || docs.length === 0) {
      container.innerHTML = `
        <div style="text-align:center;padding:3.5rem 1.5rem;border:1.5px dashed var(--border);border-radius:14px;background:var(--bg-card);">
          <div style="width:52px; height:52px; border-radius:12px; background:rgba(152,49,50,0.1); color:var(--primary); display:flex; align-items:center; justify-content:center; margin:0 auto 1rem;">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
          </div>
          <h3 style="margin:0 0 0.5rem 0; font-size:1.15rem; font-weight:700;">No Library Documents Uploaded Yet</h3>
          <p style="color:var(--text-muted);font-size:13.5px;max-width:440px;margin:0 auto 1.5rem;line-height:1.5;">Upload official library rules, guidelines, notices, agreements, floor plans, and certificates for central library reference.</p>
          <button class="btn btn-primary" onclick="window.openUploadLibraryDocModal()" style="display:inline-flex; align-items:center; gap:6px;">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Upload First Library Document
          </button>
        </div>
      `;
      return;
    }

    const escapeHtml = (str) => String(str ?? '').replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
    const fileIcon = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;

    let html = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.25rem; flex-wrap:wrap; gap:10px;">
        <div>
          <h3 style="margin:0; font-size:1.1rem; font-weight:700;">Library Repository (${docs.length} document${docs.length === 1 ? '' : 's'})</h3>
          <div style="font-size:12.5px; color:var(--text-muted); margin-top:2px;">Official rules, guidelines, circulars, agreements and certificates</div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="window.openUploadLibraryDocModal()" style="display:inline-flex; align-items:center; gap:6px; font-weight:600;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Upload Document
        </button>
      </div>
      <div class="lib-docs-grid">
    `;

    docs.forEach((doc, index) => {
      const uploadedAt = doc.uploadedAt ? new Date(doc.uploadedAt) : null;
      const date = uploadedAt && !isNaN(uploadedAt) ? uploadedAt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Recent';
      const fileType = doc.fileType || '';
      const isImg = fileType.includes("image") || (doc.base64Data && String(doc.base64Data).startsWith("data:image"));
      const title = escapeHtml(doc.title || doc.fileName || 'Untitled Document');
      const category = escapeHtml(doc.category || 'General Document');
      const thumb = isImg
        ? `<img src="${doc.base64Data}" alt="${title}" onclick="window.enlargeDocument('${doc.base64Data.replace(/'/g, "\\'")}', '${title.replace(/'/g, "\\'")}')" title="Click to enlarge" />`
        : fileIcon;

      html += `
        <div style="display:flex; flex-direction:column; justify-content:space-between; padding:1.2rem; background:var(--bg-card); border:1px solid var(--border); border-radius:14px; box-shadow:0 2px 8px rgba(0,0,0,0.04); transition:transform 0.15s ease, border-color 0.15s ease;">
          <div>
            <div style="display:flex; align-items:flex-start; gap:0.9rem; margin-bottom:0.75rem;">
              <div class="doc-thumb" ${isImg ? '' : `onclick="window.enlargeDocument('${doc.base64Data.replace(/'/g, "\\'")}', '${title.replace(/'/g, "\\'")}')"`} title="Click to preview">
                ${thumb}
              </div>
              <div style="min-width:0; flex:1;">
                <span class="badge" style="background:rgba(152,49,50,0.1); color:var(--primary); font-size:11px; font-weight:700; padding:2px 8px; border-radius:6px; margin-bottom:4px; display:inline-block;">${category}</span>
                <h4 style="margin:2px 0 0 0; font-size:14.5px; font-weight:700; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${title}">${title}</h4>
                <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">Added ${date} · ${escapeHtml(doc.fileName || '')}</div>
              </div>
            </div>
            ${doc.description ? `<p style="margin:0 0 1rem 0; font-size:12.5px; color:var(--text-secondary); line-height:1.45; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${escapeHtml(doc.description)}</p>` : ''}
          </div>
          <div style="display:flex; gap:0.5rem; border-top:1px solid var(--border); padding-top:0.85rem; margin-top:0.75rem;">
            <button type="button" class="btn btn-secondary btn-sm" onclick="window.enlargeDocument('${doc.base64Data.replace(/'/g, "\\'")}', '${title.replace(/'/g, "\\'")}')" style="flex:1; justify-content:center; font-size:12px; padding:6px 10px; display:inline-flex; align-items:center; gap:4px;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> Preview
            </button>
            <button type="button" class="btn btn-ghost btn-sm" onclick="window.__downloadDoc(${index})" style="padding:6px 10px; font-size:12px; border:1px solid var(--border); border-radius:6px;" title="Download File">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </button>
            <button type="button" class="btn btn-ghost btn-sm" onclick="window.deleteLibraryDocument('${doc.id}', '${title.replace(/'/g, "\\'")}')" style="padding:6px 10px; font-size:12px; color:var(--danger, #ef4444); border:1px solid var(--border); border-radius:6px;" title="Delete Document">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
      `;
    });

    html += `</div>`;
    container.innerHTML = html;
  } catch (e) {
    console.error(e);
    container.innerHTML = `<p style="color:#ef4444;text-align:center;padding:2rem;">Failed to load library documents. ${escapeErr(e)}</p>`;
  }
};

window.openUploadLibraryDocModal = () => {
  document.getElementById("upload-library-doc-modal")?.remove();
  const modal = document.createElement("dialog");
  modal.id = "upload-library-doc-modal";
  modal.className = "card smooth-modal";
  modal.style.cssText = "border:none; border-radius:14px; padding:0; box-shadow:0 20px 50px rgba(0,0,0,0.5); background:var(--bg-card); color:var(--text-primary); width:min(520px, 94vw); margin:auto;";
  modal.innerHTML = `
    <div style="padding:1.25rem 1.5rem; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center;">
      <div style="display:flex; align-items:center; gap:8px;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--primary);"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <h3 style="margin:0; font-size:1.1rem; font-weight:700;">Upload Library Document</h3>
      </div>
      <button class="btn btn-ghost" id="ulm-close" style="padding:0.25rem 0.5rem; font-size:1.15rem; line-height:1; cursor:pointer;">✕</button>
    </div>
    <form id="ulm-form" style="padding:1.25rem 1.5rem; display:flex; flex-direction:column; gap:1rem;">
      <div class="form-group">
        <label style="font-size:12px; font-weight:700; text-transform:uppercase;">Document Title *</label>
        <input type="text" id="ulm-title" required class="sp-input" placeholder="e.g. Shreeji Library Rules & Regulations 2026" />
      </div>
      <div class="form-group">
        <label style="font-size:12px; font-weight:700; text-transform:uppercase;">Category *</label>
        <select id="ulm-category" required class="sp-input">
          <option value="Rules & Regulations">Library Rules & Regulations</option>
          <option value="Policies & Notices">Policies & General Notices</option>
          <option value="Government & Registration">Government & Registration Certificate</option>
          <option value="Membership Agreement">Membership Agreement / Terms</option>
          <option value="Floor Plan & Safety">Floor Plan & Safety Guidelines</option>
          <option value="Fee Circular">Fee & Renewal Circular</option>
          <option value="Other">Other Library Document</option>
        </select>
      </div>
      <div class="form-group">
        <label style="font-size:12px; font-weight:700; text-transform:uppercase;">Description <span style="font-size:11px; color:var(--text-muted); font-weight:normal;">(optional)</span></label>
        <textarea id="ulm-desc" rows="2" class="sp-input" placeholder="Brief note or description of this document..." style="resize:vertical;"></textarea>
      </div>
      <div class="form-group">
        <label style="font-size:12px; font-weight:700; text-transform:uppercase;">Select File (PDF, JPG, PNG) *</label>
        <input type="file" id="ulm-file" accept="image/*,.pdf" required class="sp-input" style="padding:8px;" />
        <small style="font-size:11.5px; color:var(--text-muted); margin-top:4px;">Maximum file size: 10 MB.</small>
      </div>
      <div id="ulm-progress-bar" style="display:none; margin-top:4px;">
        <div style="font-size:12px; color:var(--text-muted); margin-bottom:4px;">Uploading document… <span id="ulm-progress-pct">0</span>%</div>
        <div style="height:5px; background:var(--bg-hover); border-radius:99px; overflow:hidden;">
          <div id="ulm-progress-fill" style="height:100%; width:0%; background:var(--primary); transition:width 0.2s;"></div>
        </div>
      </div>
      <div style="display:flex; justify-content:flex-end; gap:0.6rem; margin-top:0.75rem;">
        <button type="button" class="btn btn-ghost" id="ulm-cancel">Cancel</button>
        <button type="submit" class="btn btn-primary" id="ulm-submit" style="padding:8px 20px; font-weight:700;">Upload to Repository</button>
      </div>
    </form>
  `;
  document.body.appendChild(modal);
  const close = () => { modal.close(); modal.remove(); };
  modal.querySelector("#ulm-close").onclick = close;
  modal.querySelector("#ulm-cancel").onclick = close;
  modal.addEventListener("close", () => modal.remove());
  modal.showModal();

  const form = modal.querySelector("#ulm-form");
  form.onsubmit = async (e) => {
    e.preventDefault();
    const file = modal.querySelector("#ulm-file").files[0];
    if (!file) return;
    const title = modal.querySelector("#ulm-title").value.trim();
    const category = modal.querySelector("#ulm-category").value;
    const description = modal.querySelector("#ulm-desc").value.trim();

    const submitBtn = modal.querySelector("#ulm-submit");
    const pWrap = modal.querySelector("#ulm-progress-bar");
    const pFill = modal.querySelector("#ulm-progress-fill");
    const pPct = modal.querySelector("#ulm-progress-pct");

    submitBtn.disabled = true;
    submitBtn.textContent = "Uploading...";
    pWrap.style.display = "block";

    try {
      const { uploadGlobalDocument } = await import("./services/documentUploadService.js");
      await uploadGlobalDocument(file, title, `${category ? `[${category}] ` : ''}${description}`, (pct) => {
        pFill.style.width = `${pct}%`;
        pPct.textContent = String(pct);
      });
      if (window.showToast) window.showToast("Library document uploaded successfully!", "success");
      close();
      window.renderGlobalDocuments();
    } catch (err) {
      console.error("Library doc upload error:", err);
      if (window.showToast) window.showToast("Upload failed: " + err.message, "error");
      submitBtn.disabled = false;
      submitBtn.textContent = "Upload to Repository";
    }
  };
};

window.deleteLibraryDocument = async (docId, title) => {
  if (!confirm(`Are you sure you want to delete "${title || 'this library document'}" from the repository?`)) {
    return;
  }
  try {
    const { deleteGlobalDocument } = await import("./services/documentUploadService.js");
    const res = await deleteGlobalDocument(docId);
    if (res.success) {
      if (window.showToast) window.showToast("Document deleted successfully.", "success");
      window.renderGlobalDocuments();
    } else {
      if (window.showToast) window.showToast("Failed to delete document: " + res.error, "error");
    }
  } catch (err) {
    if (window.showToast) window.showToast("Error: " + err.message, "error");
  }
};

const escapeErr = (e) => {
  const msg = (e && e.message) ? e.message : String(e);
  return /permission/i.test(msg)
    ? 'You do not have permission to view these documents.'
    : 'Please check your connection and try again.';
};

window.__downloadDoc = async (index) => {
  const d = (window.__globalDocs || [])[index];
  if (!d) {
    if (typeof showToast === 'function') showToast('Document not found.', 'error');
    return;
  }
  if (!d.base64Data) {
    if (typeof showToast === 'function') showToast('This document\'s data could not be loaded. It may still be syncing.', 'error');
    return;
  }
  if (typeof window.downloadBase64File !== 'function') {
    const ok = await ensureDocService();
    if (!ok) {
      if (typeof showToast === 'function') showToast('Downloader could not be loaded. Please refresh the page.', 'error');
      return;
    }
  }
  window.downloadBase64File(d.base64Data || '', d.fileName || d.title || 'document');
};


// ==================== LANGUAGE DROPDOWN (custom menu) ====================
function toggleLangMenu(e) {
  if (e) e.stopPropagation();
  document.getElementById('lang-dropdown')?.classList.toggle('open');
}

function syncLangUI() {
  const lang = (localStorage.getItem('appLanguage') || 'en').toLowerCase();
  const label = document.getElementById('lang-current');
  if (label) label.textContent = lang === 'gu' ? 'GU' : 'EN';
  document.querySelectorAll('.lang-item').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-lang') === lang);
  });
}

async function selectLanguage(lang) {
  try {
    const prefix = window.location.pathname.match(/\/(admin|employee|manager|student)\//) ? '../' : './';
    const m = await import(prefix + 'services/translationService.js');
    await m.setLanguage(lang);
  } catch (err) {
    console.error('Language switch failed:', err);
  }
  syncLangUI();
  document.getElementById('lang-dropdown')?.classList.remove('open');
}

document.addEventListener('click', (e) => {
  if (!e.target.closest?.('.lang-dropdown')) {
    document.getElementById('lang-dropdown')?.classList.remove('open');
  }
});

// ==================== COLLAPSED SIDEBAR TOOLTIPS ====================
// Copies each nav item's text label into data-tip so the icon-only
// (collapsed) sidebar shows a hover tooltip. Re-synced on language change.
function syncNavTips() {
  document.querySelectorAll('.nav-item[data-page]').forEach(item => {
    const label = item.querySelector('span:not(.nav-badge)');
    const text = label ? label.textContent.trim() : '';
    if (text) item.setAttribute('data-tip', text);
    else item.removeAttribute('data-tip');
  });
}

window.addEventListener('languageChanged', syncLangUI);
window.addEventListener('languageChanged', syncNavTips);

document.addEventListener('DOMContentLoaded', () => {
  const defaultPage = document.body.getAttribute('data-default-page') || 'dashboard';
  navigate(defaultPage);
  syncLangUI();
  syncNavTips();
  // Stagger metric cards animation
  document.querySelectorAll('.metric-card').forEach((card, i) => {
    card.style.opacity = '0';
    card.style.transform = 'translateY(12px)';
    setTimeout(() => {
      card.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      card.style.opacity = '1';
      card.style.transform = 'translateY(0)';
    }, i * 60);
  });


});
