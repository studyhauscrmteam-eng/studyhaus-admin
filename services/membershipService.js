import { collection, onSnapshot, addDoc, deleteDoc, updateDoc, doc, getDocs, query } from "firebase/firestore";
import { db } from "../firebase/firebase.js";
import { validatePlan } from "./planValidation.js";
import { canEditPlans, canViewManualPlans, enforcePlanUIPermissions } from "./planPermissions.js";

// Live data backing the plan cards. The HTML shells ship only a loading
// placeholder — every card is rendered from Firestore here, so the page
// can never show hardcoded demo plans.
let latestPlans = null;
let plansListening = false;

const LOADING_HTML = `<div style="grid-column: 1 / -1; padding: 2rem; text-align: center; color: var(--text-muted);">Loading membership plans…</div>`;

const CANONICAL_PLANS = [
  {
    planName: "Half Day Plan",
    nameGu: "હાફ ડે પ્લાન",
    price: 700,
    duration: "6–8 hours daily",
    taglineGu: "રોજના ૬-૮ કલાક",
    seatType: "Fixed",
    featured: false,
    seatPreference: false,
    badge: "",
    badgeGu: "",
    status: "Active",
    benefits: [
      "Choice of morning / evening shift",
      "Personal desk allocation",
      "AC + High-Speed Wi-Fi + charging",
      "Personal locker access",
      "Purified RO drinking water",
      "Weekend access included"
    ],
    createdAt: new Date().toISOString()
  },
  {
    planName: "Full Day Plan",
    nameGu: "ફુલ ડે પ્લાન",
    price: 1000,
    duration: "17 hours daily (6 AM – 11 PM)",
    taglineGu: "રોજના ૧૭ કલાક (સવારે ૬ થી રાત્રે ૧૧)",
    seatType: "Fixed",
    featured: true,
    seatPreference: true,
    badge: "Recommended",
    badgeGu: "સૌથી વધુ પસંદગી",
    status: "Active",
    benefits: [
      "Full 17-hour access: 6:00 AM – 11:00 PM",
      "100% Guaranteed fixed reserved seat",
      "Personal dedicated locker facility",
      "AC + High-Speed Wi-Fi + switchboard",
      "Open terrace refreshment lounge access",
      "Purified chilled RO drinking water",
      "Open all 7 days including public holidays"
    ],
    createdAt: new Date().toISOString()
  }
];

// Kept for backwards-compat: same canonical set under the old name.
const DEFAULT_PLANS = CANONICAL_PLANS;

/**
 * Initializes the membership plans module
 */
export const initMembershipPlans = async () => {
  const grid = document.getElementById("membership-plans-grid");
  if (!grid) return; // Not on the memberships page

  // Replace the shell placeholder immediately — real cards arrive via the
  // Firestore listener below. Guarded so a hypothetical re-init can't blank
  // cards that already rendered (the snapshot only fires on data changes).
  if (latestPlans === null) grid.innerHTML = LOADING_HTML;

  if (!document.getElementById("add-plan-modal")) {
    const modalDiv = document.createElement("div");
    modalDiv.innerHTML = `
      <dialog id="add-plan-modal" class="card" style="border:none; border-radius:12px; padding:0; box-shadow:0 10px 30px rgba(0,0,0,0.5); background: var(--bg-card); color: var(--text-primary);">
        <div style="padding: 1.5rem; min-width: 400px; max-width: 500px; max-height: 85vh; overflow-y: auto;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
            <h2 style="margin: 0;">Add New Plan</h2>
            <button class="btn btn-ghost" onclick="document.getElementById('add-plan-modal').close()" style="padding: 0.25rem 0.5rem;">✕</button>
          </div>
          <form id="add-plan-form" onsubmit="event.preventDefault(); window.submitPlanForm()">
            <div class="form-group" style="margin-bottom: 1rem;">
              <label style="display:block; margin-bottom:0.25rem; font-size:0.875rem; font-weight:600; color:var(--text-secondary);">Plan Name</label>
              <input type="text" id="add-plan-name" required placeholder="e.g. Weekend Pass" class="input-field" style="width: 100%; box-sizing: border-box; padding: 0.5rem;" />
            </div>
            <div class="form-group" style="margin-bottom: 1rem;">
              <label style="display:block; margin-bottom:0.25rem; font-size:0.875rem; font-weight:600; color:var(--text-secondary);">Price (₹)</label>
              <input type="number" id="add-plan-price" required min="1" placeholder="e.g. 500" class="input-field" style="width: 100%; box-sizing: border-box; padding: 0.5rem;" />
            </div>
            <div class="form-group" style="margin-bottom: 1rem;">
              <label style="display:block; margin-bottom:0.25rem; font-size:0.875rem; font-weight:600; color:var(--text-secondary);">Duration</label>
              <input type="text" id="add-plan-duration" required placeholder="e.g. 1 Week, 1 Month" class="input-field" style="width: 100%; box-sizing: border-box; padding: 0.5rem;" />
            </div>
            <div class="form-group" style="margin-bottom: 1.5rem;">
              <label style="display:block; margin-bottom:0.25rem; font-size:0.875rem; font-weight:600; color:var(--text-secondary);">Notes (Optional)</label>
              <textarea id="add-plan-notes" rows="2" placeholder="Any additional notes..." class="input-field" style="width: 100%; box-sizing: border-box; padding: 0.5rem;"></textarea>
            </div>
            <div class="form-group" style="margin-bottom: 1.5rem;">
              <label style="display:flex; align-items:center; gap:0.6rem; font-size:0.875rem; font-weight:600; color:var(--text-secondary); cursor:pointer; margin:0;">
                <input type="checkbox" id="add-plan-seatpref" style="width:16px; height:16px; cursor:pointer;" />
                Seat Preference — students on this plan can pick their seat on the website map
              </label>
            </div>
            <div style="display: flex; justify-content: flex-end; gap: 0.5rem;">
              <button type="button" class="btn btn-ghost" onclick="document.getElementById('add-plan-modal').close()">Cancel</button>
              <button type="submit" class="btn btn-primary" id="btn-save-plan">Save Plan</button>
            </div>
          </form>
        </div>
      </dialog>
    `;
    document.body.appendChild(modalDiv.firstElementChild);
  }

  // 1. Enforce UI Permissions for this page
  enforcePlanUIPermissions();

  // 2. Setup the "New Plan" button (Owner only)
  const newPlanBtn = document.getElementById("btn-new-plan");
  if (newPlanBtn) {
    newPlanBtn.onclick = handleCreateManualPlan;
  }

  // 3. Ensure Default Plans exist
  await seedDefaultPlans();

  // 4. Start the real-time listener for the UI. Guarded: initPageModule
  // normally runs this once, but a second call must not stack duplicate
  // listeners.
  if (!plansListening) {
    plansListening = true;
    listenToPlans();
  }
};

/**
 * Idempotent seeder — the SINGLE source of truth for default plans.
 * Writes the canonical Half-Day / Full-Day set ONLY when
 * `membershipPlans` is currently empty. Safe to call from any page,
 * guarded against concurrent double-fire (two tabs / two listeners).
 */
let __seedInFlight = false;
export const seedDefaultPlans = async () => {
  if (__seedInFlight) return;
  __seedInFlight = true;
  try {
    const snap = await getDocs(collection(db, "membershipPlans"));
    if (!snap.empty) return; // already seeded (or user data exists) — touch nothing
    for (const p of CANONICAL_PLANS) {
      const withMirror = { ...p, benefitsEn: [...p.benefits], createdAt: new Date().toISOString() };
      await addDoc(collection(db, "membershipPlans"), withMirror);
    }
    console.info("[membershipService] Seeded 2 canonical membership plans.");
  } catch (e) {
    // Permission errors here mean the signed-in user lacks Manager+ role
    // (see firestore.rules membershipPlans write). Surface the real code
    // so it never again looks like a mystery Write/channel 400.
    console.error("[membershipService] seedDefaultPlans failed:", e?.code || "", e?.message || e);
    throw e;
  } finally {
    __seedInFlight = false;
  }
};

/**
 * Real-time listener — stores the latest snapshot and hands rendering to
 * renderPlans() so plan changes and student-count changes can both repaint.
 */
const listenToPlans = () => {
  const grid = document.getElementById("membership-plans-grid");
  if (!grid) return; // Not on a page that has this element

  const plansRef = collection(db, "membershipPlans");

  onSnapshot(plansRef, (snapshot) => {
    const plans = [];
    snapshot.forEach(docSnap => {
      plans.push({ id: docSnap.id, ...docSnap.data() });
    });
    latestPlans = plans;
    renderPlans();
  }, (error) => {
    console.error("Error listening to plans:", error?.code || "", error?.message || error);
    latestPlans = null;
    grid.innerHTML = `<div style="color: var(--danger); padding: 1rem;">Failed to load plans (${error?.code || "network error"}). Check login & connection, then reopen.</div>`;
  });
};

/**
 * Renders the plan cards from the latest Firestore data. Every card shows
 * the same fields stored on its plan document (benefits, badge, seat info),
 * and the popular badge mirrors the plan's own featured flag — truth only,
 * no fallback: no flag, no badge.
 */
const renderPlans = () => {
  const grid = document.getElementById("membership-plans-grid");
  if (!grid || latestPlans === null) return;

  const showManual = canViewManualPlans();
  const canEdit = canEditPlans();

  const visible = latestPlans.filter(plan => !(plan.isManual && !showManual));
  if (visible.length === 0) {
    grid.innerHTML = `<div style="grid-column: 1 / -1; padding: 2rem; text-align: center; color: var(--text-muted);">No membership plans yet.${canEdit ? " Use “+ New Plan” to create one." : ""}</div>`;
    return;
  }

  let html = "";

  visible.forEach(plan => {
    const id = plan.id;

    // Benefits are what the website shows — normalized the same way the
    // Website-manager does (older plans may only carry benefitsEn).
    const benefits = Array.isArray(plan.benefits)
      ? plan.benefits
      : (Array.isArray(plan.benefitsEn) ? plan.benefitsEn : []);
    let featuresHtml = benefits.map(b => `<div class="plan-feature">✓ ${b}</div>`).join("");
    featuresHtml += `<div class="plan-feature">✓ ${plan.duration || 'N/A'}</div>`;
    if (plan.seatType) featuresHtml += `<div class="plan-feature">✓ ${plan.seatType} seat</div>`;
    if (plan.capacity) featuresHtml += `<div class="plan-feature">✓ Max Capacity: ${plan.capacity}</div>`;
    if (plan.seatPreference === true) featuresHtml += `<div class="plan-feature">✓ Seat selection allowed</div>`;
    if (plan.allowedStartTime) featuresHtml += `<div class="plan-feature">✓ Timings: ${plan.allowedStartTime} to ${plan.allowedEndTime}</div>`;
    if (plan.notes) featuresHtml += `<div class="plan-feature muted">${plan.notes}</div>`;

    // Build Action Buttons for Owner
    let actionsHtml = "";
    if (canEdit) {
      actionsHtml = `
        <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--border); display: flex; gap: 1rem; font-size: 0.85rem;">
          <a href="#" onclick="window.editPlan('${id}', '${plan.planName}', '${plan.price}'); return false;" style="color: var(--primary); text-decoration: none;" data-i18n="btn.edit">${window.t ? window.t("btn.edit") : "Edit"}</a>
          <a href="#" onclick="window.deletePlan('${id}', '${plan.planName}'); return false;" style="color: var(--danger); text-decoration: none;" data-i18n="btn.delete">${window.t ? window.t("btn.delete") : "Delete"}</a>
        </div>
      `;
    }

    // "Most Popular" mirrors the plan's own featured flag (set in the
    // Website-manager). Flagged → badge, unflagged → none: truth only.
    const isPopular = plan.featured === true;
    const cardClass = isPopular ? "plan-card featured" : "plan-card";
    const badgeHtml = isPopular ? `<div class="plan-badge">${plan.badge || "Popular"}</div>` : "";

    html += `
      <div class="${cardClass}">
        ${badgeHtml}
        <div class="plan-top">
          <div class="plan-name">${plan.planName} ${plan.isManual ? ' <span style="font-size:0.7em; color:var(--text-muted);">(Manual)</span>' : ''}</div>
          <div class="plan-price">₹${plan.price}<span>/${plan.duration != null ? (typeof plan.duration === 'number' ? plan.duration + ' days' : String(plan.duration).toLowerCase()) : 'custom'}</span></div>
        </div>
        <div class="plan-features">
          ${featuresHtml}
        </div>
        ${actionsHtml}
      </div>
    `;
  });

  grid.innerHTML = html;
};

/**
 * Handle Manual Plan Creation
 */
const handleCreateManualPlan = async () => {
  document.getElementById("add-plan-name").value = "";
  document.getElementById("add-plan-price").value = "";
  document.getElementById("add-plan-duration").value = "";
  document.getElementById("add-plan-notes").value = "";
  document.getElementById("add-plan-seatpref").checked = false;
  document.getElementById("add-plan-modal").showModal();
};

window.submitPlanForm = async () => {
  const name = document.getElementById("add-plan-name").value.trim();
  const price = document.getElementById("add-plan-price").value;
  const duration = document.getElementById("add-plan-duration").value.trim();
  const notes = document.getElementById("add-plan-notes").value.trim();
  const seatPreference = document.getElementById("add-plan-seatpref")?.checked === true;

  if (!name || !price || !duration) {
    window.showToast(window.t ? window.t('Please fill in all required fields.') || "Please fill in all required fields." : "Please fill in all required fields.", "warning");
    return;
  }

  const btn = document.getElementById("btn-save-plan");
  const originalText = btn.innerText;
  btn.innerText = "Saving...";
  btn.disabled = true;

  const newPlan = {
    planName: name,
    price: Number(price),
    duration: duration,
    notes: notes || "",
    seatPreference: seatPreference,
    isManual: false,
    status: "Active",
    createdAt: new Date().toISOString()
  };

  try {
    await validatePlan(newPlan);
    const plansRef = collection(db, "membershipPlans");
    await addDoc(plansRef, newPlan);
    document.getElementById("add-plan-modal").close();
    if(typeof showToast === 'function') showToast("Plan created successfully!");
  } catch (error) {
    window.showToast(window.t ? window.t('Error: ') || "Error: " : "Error: " + error.message, "error");
  } finally {
    btn.innerText = originalText;
    btn.disabled = false;
  }
};

/**
 * Global edit handler
 */
window.editPlan = async (id, currentName, currentPrice) => {
  const newPriceStr = await window.showCustomPrompt("Update Price", `Update price for ${currentName}:`, "Update");
  if (!newPriceStr) return;

  const newPrice = Number(newPriceStr);
  if (isNaN(newPrice) || newPrice <= 0) {
    window.showToast(window.t ? window.t('Invalid price.') || "Invalid price." : "Invalid price.", "error");
    return;
  }

  try {
    const docRef = doc(db, "membershipPlans", id);
    await updateDoc(docRef, {
      price: newPrice,
      updatedAt: new Date().toISOString()
    });
    window.showToast(window.t ? window.t('Plan updated successfully!') || "Plan updated successfully!" : "Plan updated successfully!", "success");
  } catch (error) {
    window.showToast(window.t ? window.t('Failed to update plan: ') || "Failed to update plan: " : "Failed to update plan: " + error.message, "error");
  }
};

/**
 * Global delete handler
 */
window.deletePlan = async (id, planName) => {
  const confirmed = await window.showCustomConfirm("Delete Plan", `Are you sure you want to delete '${planName}'?`, "Delete", true);
  if (confirmed) {
    try {
      const docRef = doc(db, "membershipPlans", id);
      await deleteDoc(docRef);
      window.showToast(window.t ? window.t('Plan deleted.') || "Plan deleted." : "Plan deleted.", "success");
    } catch (error) {
      window.showToast(window.t ? window.t('Failed to delete plan: ') || "Failed to delete plan: " : "Failed to delete plan: " + error.message, "error");
    }
  }
};
