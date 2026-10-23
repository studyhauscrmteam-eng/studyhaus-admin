import { getSettings, saveSettings } from "./settingsService.js";
import { fetchAllTemplates, addTemplate, updateTemplate, deleteTemplate } from "./messageTemplateService.js";

/**
 * Initializes the Settings Admin UI
 */
export const initSettingsAdminUI = async () => {
  const saveBtn = document.getElementById('btn-save-settings') || document.querySelector('#page-settings button.btn-primary');
  const spaceNameInput = document.getElementById('settings-space-name');
  const addressInput = document.getElementById('settings-address');
  const phoneInput = document.getElementById('settings-phone');
  const emailInput = document.getElementById('settings-email');
  const gstInput = document.getElementById('settings-gst');
  const placeOfSupplyInput = document.getElementById('settings-place-of-supply');
  const subtitleInput = document.getElementById('settings-subtitle');
  const openingInput = document.getElementById('settings-opening');
  const closingInput = document.getElementById('settings-closing');
  const upiIdInput = document.getElementById('settings-upi-id');
  const adminEmailInput = document.getElementById('setting-admin-email');
  const langSelect = document.getElementById('setting-language');
  const whatsappEnabledInput = document.getElementById('settings-whatsapp-enabled');
  const whatsappStatusLabel = document.getElementById('settings-whatsapp-status-label');

  // Day & Night Schedules (Requirement 7)
  const normalDayStartInput = document.getElementById('settings-normal-day-start');
  const normalDayEndInput = document.getElementById('settings-normal-day-end');
  const normalNightStartInput = document.getElementById('settings-normal-night-start');
  const normalNightEndInput = document.getElementById('settings-normal-night-end');

  const premiumDayStartInput = document.getElementById('settings-premium-day-start');
  const premiumDayEndInput = document.getElementById('settings-premium-day-end');
  const premiumNightStartInput = document.getElementById('settings-premium-night-start');
  const premiumNightEndInput = document.getElementById('settings-premium-night-end');

  const qrUpload = document.getElementById('setting-qr-upload');
  const qrPreview = document.getElementById('setting-qr-preview');
  const qrEmpty = document.getElementById('setting-qr-empty');
  const qrStatus = document.getElementById('setting-qr-status');

  const paintQrPreview = (url) => {
    if (url) {
      if (qrPreview) { qrPreview.src = url; qrPreview.style.display = 'block'; }
      if (qrEmpty) qrEmpty.style.display = 'none';
    } else {
      if (qrPreview) { qrPreview.src = ''; qrPreview.style.display = 'none'; }
      if (qrEmpty) qrEmpty.style.display = 'block';
    }
  };

  let savedQrUrl = "";

  // Load existing settings
  try {
    const currentSettings = await getSettings();
    if (spaceNameInput) spaceNameInput.value = currentSettings.spaceName || "Shreeji Library";
    if (addressInput) addressInput.value = currentSettings.address || "";
    if (phoneInput) phoneInput.value = currentSettings.phone || "";
    if (emailInput) emailInput.value = currentSettings.email || "";
    if (gstInput) gstInput.value = currentSettings.gstNumber || "";
    if (placeOfSupplyInput) placeOfSupplyInput.value = currentSettings.placeOfSupply || "Gujarat (24)";
    if (subtitleInput) subtitleInput.value = currentSettings.subtitle || "PREMIUM STUDY LOUNGE & READING HALL";
    if (openingInput) openingInput.value = currentSettings.openingTime || "06:00";
    if (closingInput) closingInput.value = currentSettings.closingTime || "23:00";
    if (upiIdInput) upiIdInput.value = currentSettings.upiId || "";
    if (adminEmailInput) adminEmailInput.value = currentSettings.adminEmail || "";

    if (whatsappEnabledInput) {
      whatsappEnabledInput.checked = currentSettings.whatsappEnabled !== false;
      if (whatsappStatusLabel) {
        whatsappStatusLabel.textContent = whatsappEnabledInput.checked ? "WhatsApp Enabled" : "WhatsApp Disabled";
        whatsappStatusLabel.style.color = whatsappEnabledInput.checked ? "var(--accent-emerald)" : "var(--text-muted)";
      }
    }

    const sched = currentSettings.schedules || {};
    const norm = sched.normal || {};
    const prem = sched.premium || {};

    if (normalDayStartInput) normalDayStartInput.value = norm.dayStart || currentSettings.normalDayStart || "06:00";
    if (normalDayEndInput) normalDayEndInput.value = norm.dayEnd || currentSettings.normalDayEnd || "18:00";
    if (normalNightStartInput) normalNightStartInput.value = norm.nightStart || currentSettings.normalNightStart || "18:00";
    if (normalNightEndInput) normalNightEndInput.value = norm.nightEnd || currentSettings.normalNightEnd || "06:00";

    if (premiumDayStartInput) premiumDayStartInput.value = prem.dayStart || currentSettings.premiumDayStart || "06:00";
    if (premiumDayEndInput) premiumDayEndInput.value = prem.dayEnd || currentSettings.premiumDayEnd || "18:00";
    if (premiumNightStartInput) premiumNightStartInput.value = prem.nightStart || currentSettings.premiumNightStart || "18:00";
    if (premiumNightEndInput) premiumNightEndInput.value = prem.nightEnd || currentSettings.premiumNightEnd || "06:00";

    if (currentSettings.qrCodeUrl) {
      savedQrUrl = currentSettings.qrCodeUrl;
      paintQrPreview(savedQrUrl);
    }
    if (langSelect && currentSettings.language) {
      langSelect.value = currentSettings.language;
    }
  } catch (error) {
    console.error("Failed to load settings:", error);
  }

  if (whatsappEnabledInput && whatsappStatusLabel) {
    whatsappEnabledInput.addEventListener('change', () => {
      whatsappStatusLabel.textContent = whatsappEnabledInput.checked ? "WhatsApp Enabled" : "WhatsApp Disabled";
      whatsappStatusLabel.style.color = whatsappEnabledInput.checked ? "var(--accent-emerald)" : "var(--text-muted)";
    });
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
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const oldBtnText = saveBtn.textContent;
      saveBtn.textContent = 'Saving...';
      saveBtn.disabled = true;

      try {
        const payload = {};
        if (spaceNameInput) payload.spaceName = spaceNameInput.value.trim();
        if (addressInput) payload.address = addressInput.value.trim();
        if (phoneInput) payload.phone = phoneInput.value.trim();
        if (emailInput) payload.email = emailInput.value.trim().toLowerCase();
        if (gstInput) payload.gstNumber = gstInput.value.trim();
        if (placeOfSupplyInput) payload.placeOfSupply = placeOfSupplyInput.value.trim();
        if (subtitleInput) payload.subtitle = subtitleInput.value.trim();
        if (openingInput) payload.openingTime = openingInput.value;
        if (closingInput) payload.closingTime = closingInput.value;
        if (upiIdInput) payload.upiId = upiIdInput.value.trim();
        if (adminEmailInput) payload.adminEmail = adminEmailInput.value.trim().toLowerCase();
        if (whatsappEnabledInput) payload.whatsappEnabled = whatsappEnabledInput.checked;

        if (normalDayStartInput || premiumDayStartInput) {
          payload.schedules = {
            normal: {
              dayStart: (normalDayStartInput && normalDayStartInput.value) || "06:00",
              dayEnd: (normalDayEndInput && normalDayEndInput.value) || "18:00",
              nightStart: (normalNightStartInput && normalNightStartInput.value) || "18:00",
              nightEnd: (normalNightEndInput && normalNightEndInput.value) || "06:00"
            },
            premium: {
              dayStart: (premiumDayStartInput && premiumDayStartInput.value) || "06:00",
              dayEnd: (premiumDayEndInput && premiumDayEndInput.value) || "18:00",
              nightStart: (premiumNightStartInput && premiumNightStartInput.value) || "18:00",
              nightEnd: (premiumNightEndInput && premiumNightEndInput.value) || "06:00"
            }
          };
        }

        if (qrUpload || qrPreview) {
          payload.qrCodeUrl = uploadedBase64 || savedQrUrl || "";
        }
        if (langSelect) {
          payload.language = langSelect.value;
        }

        await saveSettings(payload);
        import('./scheduleService.js').then(({ invalidateScheduleCache }) => invalidateScheduleCache()).catch(() => {});

        if (payload.qrCodeUrl !== undefined) {
          savedQrUrl = payload.qrCodeUrl;
          uploadedBase64 = null;
          import('./qrService.js').then(({ refreshQrCache }) => refreshQrCache()).catch(() => {});
          if (qrStatus) qrStatus.textContent = payload.qrCodeUrl ? 'QR live across the portal ✓' : '';
          if (qrUpload) qrUpload.value = '';
        }

        if (langSelect) {
          import('./translationService.js').then(({ setLanguage }) => {
            setLanguage(langSelect.value);
          });
        }
        
        if (typeof window.showToast === 'function') {
          window.showToast('Settings saved successfully!', 'success');
        } else {
          alert('Settings saved successfully!');
        }
      } catch (error) {
        console.error("Failed to save settings:", error);
        if (typeof window.showToast === 'function') {
          window.showToast('Failed to save settings: ' + error.message, 'error');
        } else {
          alert('Failed to save settings: ' + error.message);
        }
      } finally {
        saveBtn.textContent = oldBtnText;
        saveBtn.disabled = false;
      }
    });
  }

  // --- Message Templates Logic ---
  let allTemplates = [];
  const templatesTbody = document.getElementById('settings-templates-tbody');
  const btnAddTemplate = document.getElementById('btn-add-template');
  const modalTemplate = document.getElementById('modal-template-form');
  const formTemplate = document.getElementById('form-template');
  const templateMsgTextarea = document.getElementById('template-message');

  // Token chip insertion handler
  const chipContainer = document.getElementById('template-field-chips');
  if (chipContainer && templateMsgTextarea) {
    chipContainer.addEventListener('click', (e) => {
      const chip = e.target.closest('.tag-chip');
      if (!chip) return;
      const token = chip.getAttribute('data-token');
      if (!token) return;

      const start = templateMsgTextarea.selectionStart || templateMsgTextarea.value.length;
      const end = templateMsgTextarea.selectionEnd || templateMsgTextarea.value.length;
      const text = templateMsgTextarea.value;
      templateMsgTextarea.value = text.substring(0, start) + token + text.substring(end);
      templateMsgTextarea.focus();
      templateMsgTextarea.selectionStart = templateMsgTextarea.selectionEnd = start + token.length;
    });
  }

  const renderTemplates = () => {
    if (!templatesTbody) return;
    if (allTemplates.length === 0) {
      templatesTbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--text-muted); padding: 1rem;">No templates found. Click "+ Add Template" to create one.</td></tr>`;
      return;
    }
    
    templatesTbody.innerHTML = allTemplates.map(t => `
      <tr>
        <td style="font-weight: 600; color:var(--text-primary);">${t.name}</td>
        <td><div style="max-width: 380px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size:12px; color:var(--text-secondary);" title="${t.message}">${t.message}</div></td>
        <td>
          <button class="btn btn-secondary btn-edit-template" data-id="${t.id}" style="padding: 4px 8px; font-size: 12px; margin-right: 4px;">Edit</button>
          <button class="btn btn-ghost btn-delete-template" data-id="${t.id}" style="padding: 4px 8px; font-size: 12px; color: var(--danger);">Delete</button>
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

  if (templatesTbody) {
    loadTemplates();
  }

  if (btnAddTemplate && modalTemplate) {
    btnAddTemplate.addEventListener('click', () => {
      document.getElementById('modal-template-title').innerText = "Add Template";
      document.getElementById('template-id').value = "";
      document.getElementById('template-name').value = "";
      document.getElementById('template-message').value = "";
      modalTemplate.showModal();
    });
  }

  if (templatesTbody) {
    templatesTbody.addEventListener('click', async (e) => {
      const editBtn = e.target.closest('.btn-edit-template');
      const deleteBtn = e.target.closest('.btn-delete-template');

      if (editBtn) {
        const id = editBtn.getAttribute('data-id');
        const template = allTemplates.find(t => t.id === id);
        if (template && modalTemplate) {
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

  if (formTemplate) {
    formTemplate.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btnSave = document.getElementById('btn-save-template');
      btnSave.disabled = true;
      const originalText = btnSave.innerText;
      btnSave.innerText = "Saving...";

      const id = document.getElementById('template-id').value;
      const name = document.getElementById('template-name').value.trim();
      const message = document.getElementById('template-message').value.trim();

      try {
        if (id) {
          const updated = await updateTemplate(id, { name, message });
          const index = allTemplates.findIndex(t => t.id === id);
          if (index !== -1) allTemplates[index] = updated;
          if (window.showToast) window.showToast('Template updated successfully', 'success');
        } else {
          const added = await addTemplate({ name, message });
          allTemplates.push(added);
          if (window.showToast) window.showToast('Template added successfully', 'success');
        }
        renderTemplates();
        modalTemplate.close();
      } catch (err) {
        console.error(err);
        if (window.showToast) window.showToast('Failed to save template', 'error');
      } finally {
        btnSave.disabled = false;
        btnSave.innerText = originalText;
      }
    });
  }
};
