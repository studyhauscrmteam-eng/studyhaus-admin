import { getSettings, saveSettings } from "./settingsService.js";
import { fetchAllTemplates, addTemplate, updateTemplate, deleteTemplate } from "./messageTemplateService.js";

/**
 * Initializes the Settings Admin UI
 */
export const initSettingsAdminUI = async () => {
  const qrUpload = document.getElementById('setting-qr-upload');
  const qrPreview = document.getElementById('setting-qr-preview');
  const qrEmpty = document.getElementById('setting-qr-empty');
  const qrStatus = document.getElementById('setting-qr-status');
  const adminEmailInput = document.getElementById('setting-admin-email');
  const langSelect = document.getElementById('setting-language');

  if (!saveBtn) return;

  const paintQrPreview = (url) => {
    if (url) {
      if (qrPreview) { qrPreview.src = url; qrPreview.style.display = 'block'; }
      if (qrEmpty) qrEmpty.style.display = 'none';
    } else {
      if (qrPreview) { qrPreview.src = ''; qrPreview.style.display = 'none'; }
      if (qrEmpty) qrEmpty.style.display = 'block';
    }
  };

  // The currently saved QR (upload-only now). Kept so saving settings
  // without uploading a new QR never wipes the existing one.
  let savedQrUrl = "";

  // Load existing settings
  try {
    const currentSettings = await getSettings();
    if (currentSettings.qrCodeUrl) {
      // Backward compatible: shows previously saved uploads AND old image URLs.
      savedQrUrl = currentSettings.qrCodeUrl;
      paintQrPreview(savedQrUrl);
    }
    if (langSelect && currentSettings.language) {
      langSelect.value = currentSettings.language;
    }
    if (adminEmailInput && currentSettings.adminEmail) {
      adminEmailInput.value = currentSettings.adminEmail;
    }
  } catch (error) {
    console.error("Failed to load settings:", error);
  }

  if (langSelect) {
    langSelect.addEventListener('change', (e) => {
      import('./translationService.js').then(({ setLanguage }) => {
        setLanguage(e.target.value);
      });
    });
  }

  // Handle file upload preview
  let uploadedBase64 = null;
  if (qrUpload && qrPreview) {
    qrUpload.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        uploadedBase64 = ev.target.result;
        paintQrPreview(uploadedBase64);
        if (qrStatus) qrStatus.textContent = 'New QR selected — press Save Changes.';
      };
      reader.readAsDataURL(file);
    });
  }

  // Handle Save
  saveBtn.addEventListener('click', async () => {
    // Collect the original function behavior
    const oldBtnText = saveBtn.textContent;
    saveBtn.textContent = 'Saving...';
    saveBtn.disabled = true;

    try {
      // Upload-only: a fresh upload wins, otherwise the saved QR is kept.
      // Keys are included ONLY for fields present on this dashboard, so
      // saving from a page without the Payment card can never wipe the QR
      // or the admin email.
      const payload = {};
      if (qrUpload || qrPreview) {
        payload.qrCodeUrl = uploadedBase64 || savedQrUrl || "";
      }
      if (adminEmailInput) {
        payload.adminEmail = adminEmailInput.value.trim().toLowerCase();
      }
      if (langSelect) {
        payload.language = langSelect.value;
      }

      await saveSettings(payload);
      if (payload.qrCodeUrl !== undefined) {
        savedQrUrl = payload.qrCodeUrl;
        uploadedBase64 = null;
        // Refresh the portal-wide QR cache so the new code shows everywhere.
        import('./qrService.js').then(({ refreshQrCache }) => refreshQrCache()).catch(() => {});
        if (qrStatus) qrStatus.textContent = payload.qrCodeUrl ? 'QR live across the portal ✓' : '';
        if (qrUpload) qrUpload.value = '';
      }

      // Immediately trigger language switch
      if (langSelect) {
        import('./translationService.js').then(({ setLanguage }) => {
          setLanguage(langSelect.value);
        });
      }
      
      // showToast is defined globally in app.js
      if (typeof window.showToast === 'function') {
        window.showToast('Settings saved successfully!', 'success');
      } else {
        alert('Settings saved successfully!');
      }
    } catch (error) {
      console.error("Failed to save settings:", error);
      if (typeof window.showToast === 'function') {
        window.showToast('Failed to save settings', 'error');
      } else {
        alert('Failed to save settings');
      }
    } finally {
      saveBtn.textContent = oldBtnText;
      saveBtn.disabled = false;
    }
  });

  // --- Message Templates Logic ---
  let allTemplates = [];
  const templatesTbody = document.getElementById('settings-templates-tbody');
  const btnAddTemplate = document.getElementById('btn-add-template');
  const modalTemplate = document.getElementById('modal-template-form');
  const formTemplate = document.getElementById('form-template');

  const renderTemplates = () => {
    if (!templatesTbody) return;
    if (allTemplates.length === 0) {
      templatesTbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--text-muted);">No templates found.</td></tr>`;
      return;
    }
    
    templatesTbody.innerHTML = allTemplates.map(t => `
      <tr>
        <td style="font-weight: 500;">${t.name}</td>
        <td><div style="max-width: 300px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${t.message}">${t.message}</div></td>
        <td>
          <button class="btn btn-secondary btn-edit-template" data-id="${t.id}" style="padding: 4px 8px; font-size: 12px; margin-right: 4px;" data-i18n="btn.edit">${window.t ? window.t("btn.edit") : "Edit"}</button>
          <button class="btn btn-ghost btn-delete-template" data-id="${t.id}" style="padding: 4px 8px; font-size: 12px; color: var(--danger);" data-i18n="btn.delete">${window.t ? window.t("btn.delete") : "Delete"}</button>
        </td>
      </tr>
    `).join('');
  };

  const loadTemplates = async () => {
    try {
      allTemplates = await fetchAllTemplates();
      renderTemplates();
    } catch (e) {
      console.error("Failed to load templates:", e);
    }
  };

  // Initial load
  if (templatesTbody) {
    loadTemplates();
  }

  // Add Template button
  if (btnAddTemplate && modalTemplate) {
    btnAddTemplate.addEventListener('click', () => {
      document.getElementById('modal-template-title').innerText = "Add Template";
      document.getElementById('template-id').value = "";
      document.getElementById('template-name').value = "";
      document.getElementById('template-message').value = "";
      modalTemplate.showModal();
    });
  }

  // Edit and Delete Delegations
  if (templatesTbody) {
    templatesTbody.addEventListener('click', async (e) => {
      const editBtn = e.target.closest('.btn-edit-template');
      const deleteBtn = e.target.closest('.btn-delete-template');

      if (editBtn) {
        const id = editBtn.getAttribute('data-id');
        const template = allTemplates.find(t => t.id === id);
        if (template) {
          document.getElementById('modal-template-title').innerText = "Edit Template";
          document.getElementById('template-id').value = template.id;
          document.getElementById('template-name').value = template.name;
          document.getElementById('template-message').value = template.message;
          modalTemplate.showModal();
        }
      }

      if (deleteBtn) {
        const id = deleteBtn.getAttribute('data-id');
        if (confirm("Are you sure you want to delete this template?")) {
          deleteBtn.disabled = true;
          try {
            await deleteTemplate(id);
            allTemplates = allTemplates.filter(t => t.id !== id);
            renderTemplates();
            if (window.showToast) window.showToast('Template deleted successfully', 'success');
          } catch (err) {
            console.error(err);
            if (window.showToast) window.showToast('Failed to delete template', 'error');
            deleteBtn.disabled = false;
          }
        }
      }
    });
  }

  // Form Submit
  if (formTemplate) {
    formTemplate.addEventListener('submit', async (e) => {
      e.preventDefault();
      const saveBtn = document.getElementById('btn-save-template');
      saveBtn.disabled = true;
      const originalText = saveBtn.innerText;
      saveBtn.innerText = "Saving...";

      const id = document.getElementById('template-id').value;
      const name = document.getElementById('template-name').value.trim();
      const message = document.getElementById('template-message').value.trim();

      try {
        if (id) {
          const updated = await updateTemplate(id, { name, message });
          const index = allTemplates.findIndex(t => t.id === id);
          if (index !== -1) allTemplates[index] = updated;
          if (window.showToast) window.showToast('Template updated', 'success');
        } else {
          const added = await addTemplate({ name, message });
          allTemplates.push(added);
          if (window.showToast) window.showToast('Template added', 'success');
        }
        renderTemplates();
        modalTemplate.close();
      } catch (err) {
        console.error(err);
        if (window.showToast) window.showToast('Failed to save template', 'error');
      } finally {
        saveBtn.disabled = false;
        saveBtn.innerText = originalText;
      }
    });
  }
};
