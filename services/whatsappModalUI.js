import { fetchAllTemplates, seedInitialTemplates } from "./messageTemplateService.js";
import { sendWhatsAppMessage, replacePlaceholders } from "./whatsappService.js";

// Ensure templates are seeded
seedInitialTemplates();

let templates = [];
let modalInjected = false;

export const openWhatsAppModal = async (studentData) => {
  injectModal();
  
  if (templates.length === 0) {
    templates = await fetchAllTemplates();
  }

  const role = localStorage.getItem("userRole");
  const canCustom = (role === "Owner/Admin" || role === "Manager");

  const modal = document.getElementById("whatsapp-modal");
  const tplSelect = document.getElementById("wa-template");
  const msgPreview = document.getElementById("wa-preview");
  const sendBtn = document.getElementById("wa-send-btn");
  
  // Populate dropdown
  let html = `<option value="">-- Select a Template --</option>`;
  templates.forEach(t => {
    html += `<option value="${t.id}">${t.name}</option>`;
  });
  if (canCustom) {
    html += `<option value="custom">-- Custom Message --</option>`;
  }
  tplSelect.innerHTML = html;
  msgPreview.value = "";
  msgPreview.readOnly = true;
  
  tplSelect.onchange = () => {
    const val = tplSelect.value;
    if (!val) {
      msgPreview.value = "";
      msgPreview.readOnly = true;
      return;
    }
    if (val === "custom") {
      msgPreview.value = "";
      msgPreview.readOnly = false;
      msgPreview.placeholder = "Type your custom message here...";
    } else {
      const t = templates.find(x => x.id === val);
      if (t) {
        msgPreview.value = replacePlaceholders(t.message, studentData);
        msgPreview.readOnly = true;
      }
    }
  };

  sendBtn.onclick = async () => {
    const val = tplSelect.value;
    if (!val) return window.showToast("Select a template.", "warning");
    
    let templateName = "Custom";
    if (val !== "custom") {
      const t = templates.find(x => x.id === val);
      templateName = t ? t.name : "Template";
    }

    const finalMessage = msgPreview.value.trim();
    if (!finalMessage) return window.showToast("Message cannot be empty.", "warning");

    // The send service automatically logs and opens new tab
    const success = await sendWhatsAppMessage(studentData, templateName, finalMessage);
    if (success) {
      closeWhatsAppModal();
    }
  };

  if (typeof modal.showModal === "function") {
    modal.showModal();
  } else {
    modal.style.display = "block";
  }
};

export const closeWhatsAppModal = () => {
  const modal = document.getElementById("whatsapp-modal");
  if (modal) {
    if (typeof modal.close === "function") modal.close();
    else modal.style.display = "none";
  }
};

const injectModal = () => {
  let modal = document.getElementById("whatsapp-modal");
  if (!modal) {
    modal = document.createElement("dialog");
    modal.id = "whatsapp-modal";
    modal.className = "card";
    modal.style.cssText = "border:none; border-radius:14px; padding:0; box-shadow:0 25px 60px rgba(0,0,0,0.5); background:var(--bg-card); color:var(--text-primary); width:min(480px, 92vw); margin:auto;";
    document.body.appendChild(modal);
  }

  // Populate inner content
  modal.innerHTML = `
    <div style="padding:1.5rem; max-height:85vh; overflow-y:auto; box-sizing:border-box;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.25rem;">
        <h2 style="margin:0; font-size:1.2rem; font-weight:700; display:flex; align-items:center; gap:8px;">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#25D366" stroke-width="2.5"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
          <span>Send WhatsApp Message</span>
        </h2>
      </div>
      <div style="margin-top:0.75rem;">
        <label style="display:block; margin-bottom:0.4rem; font-size:0.85rem; font-weight:600;">Select Template</label>
        <select id="wa-template" class="input-field" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--border); background:var(--bg-card); color:var(--text-primary);"></select>
      </div>
      <div style="margin-top:1rem;">
        <label style="display:block; margin-bottom:0.4rem; font-size:0.85rem; font-weight:600;">Message Preview</label>
        <textarea id="wa-preview" class="input-field" style="width:100%; height:130px; resize:none; padding:10px; border-radius:8px; border:1px solid var(--border); background:var(--bg-hover); color:var(--text-primary); font-family:inherit; font-size:13px; line-height:1.45;" readonly></textarea>
      </div>
      <div style="margin-top:1.5rem; display:flex; gap:0.75rem; justify-content:flex-end;">
        <button type="button" class="btn btn-secondary" onclick="window.closeWhatsAppModal()" style="padding:8px 18px; border-radius:8px; font-weight:600;">Close</button>
        <button type="button" class="btn btn-primary" id="wa-send-btn" style="background:#25D366; border-color:#25D366; color:#fff; font-weight:700; padding:8px 20px; border-radius:8px; display:inline-flex; align-items:center; gap:6px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M22 2L11 13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          Send WhatsApp
        </button>
      </div>
    </div>
  `;
  modalInjected = true;
};

// Global Exposure for inline onclick hooks
window.openWhatsAppModal = openWhatsAppModal;
window.closeWhatsAppModal = closeWhatsAppModal;
window.sendWhatsAppMessage = sendWhatsAppMessage;
