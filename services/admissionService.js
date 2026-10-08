import { collection, addDoc, serverTimestamp, getDocs, getDoc, query, where, onSnapshot, doc, updateDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase/firebase.js";
import { validateStudentData } from "./studentValidation.js";
import { approveAdmission, rejectAdmission } from "./approvalService.js";
import { createPortalAccount } from "./authService.js";
import { ensureStudentId } from "./studentIdService.js";
import { getAuth } from "firebase/auth";

/**
 * Fetch available plans for the dropdown.
 * Students only see non-manual plans.
 */
export const fetchPlansForDropdown = async (isStudent) => {
  const plansRef = collection(db, "membershipPlans");
  // Fetch all plans so student sign up sees everything created in admin
  const q = plansRef;
  const snapshot = await getDocs(q);
  
  const plans = [];
  snapshot.forEach(doc => {
    plans.push({ id: doc.id, ...doc.data() });
  });
  return plans;
};

/**
 * Update payment details for an existing pending application.
 * Pending applications now live in `students`; the legacy `admissions/{id}`
 * path is kept as a fallback for the 11 retired history records.
 * NOTE: paying does NOT auto-approve. The request stays in the
 * "Pending approval" queue until an admin explicitly approves it.
 */
export const updateAdmissionPayment = async (admissionId, transactionId, paymentScreenshotUrl) => {
  try {
    const updates = {
      paymentMethod: "Paid",
      transactionId: transactionId,
      updatedAt: serverTimestamp()
    };
    if (paymentScreenshotUrl) {
      updates.paymentScreenshotUrl = paymentScreenshotUrl;
    }
    try {
      await updateDoc(doc(db, "students", admissionId), updates);
    } catch (e) {
      // Legacy record — only fall back when the students doc doesn't exist.
      const snap = await getDoc(doc(db, "students", admissionId));
      if (snap.exists()) throw e;
      await updateDoc(doc(db, "admissions", admissionId), updates);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

/**
 * Submit an admission form.
 *
 * WEBSITE / STUDENT submissions (isStudent = true) land in the 'students'
 * collection with approvalStatus "Pending" — they NEVER become Active
 * directly. An admin must Approve (or Reject) them from
 * Admissions → Pending approval. Paying only attaches payment info.
 * (The 'admissions' collection is RETIRED as a data store — no new writes.)
 *
 * ADMIN submissions (isStudent = false) go straight to 'students' as
 * approvalStatus "Approved" / status "Active" and get a sequential admission
 * number (SH-0001, SH-0002, …).
 */
export const submitAdmission = async (formData, isStudent) => {
  try {
    formData.isStudentSubmission = isStudent;

    // Normalise once so duplicates compare correctly everywhere.
    if (formData.email) formData.email = String(formData.email).trim().toLowerCase();
    if (formData.phone) formData.phone = String(formData.phone).trim();

    // Website submissions need no portal account: if the visitor is signed in
    // (portal student OR anonymous website session) we key by uid, otherwise
    // we use an auto-ID. Either way it lands in students/{id} as Pending —
    // never as an Active student.
    if (isStudent) {
      const auth = getAuth();
      const uid = auth.currentUser ? auth.currentUser.uid : null;
      if (uid) {
        formData.uid = uid;
        formData._selfUid = uid;
      }
    }

    await validateStudentData(formData);

    // Every request gets a unique sequential admission number. It is kept on
    // the pending record and carried over to the student record on approval,
    // so the number never changes and never repeats.
    const admissionNo = await ensureStudentId(formData);
    formData.admissionNo = admissionNo;

    // Add timestamps and role
    formData.createdAt = serverTimestamp();
    formData.updatedAt = serverTimestamp();
    formData.role = "Student"; // Crucial for login routing

    if (isStudent) {
      const uid = formData.uid || null;
      delete formData._selfUid;

      // Seat Preference guard (website/portal only — admin flow below is
      // untouched): when the chosen plan does not allow seat selection,
      // any seat sent along is stripped. View-only means view-only, even
      // if the request was tampered with.
      try {
        if ((formData.seatNumber || formData.seatAssigned || formData.seatId) && formData.planId) {
          const { planAllowsSeatSelection } = await import("./planValidation.js");
          const allowed = await planAllowsSeatSelection(formData.planId);
          if (!allowed) {
            delete formData.seatNumber;
            delete formData.seatAssigned;
            delete formData.seatId;
          }
        }
      } catch (_) { /* guard is best-effort here; approval re-checks */ }

      // Website / self submission — ALWAYS pending, NEVER directly active.
      formData.approvalStatus = "Pending";
      formData.status = "Pending";
      let admissionId = uid;
      if (admissionId) {
        await setDoc(doc(db, "students", admissionId), formData, { merge: true });
      } else {
        // Pure website form (no account at all) — auto-ID record.
        const ref = await addDoc(collection(db, "students"), formData);
        admissionId = ref.id;
      }

      // Notify the admin (in-app + email). Failures here must never block
      // the submission itself.
      try {
        const { notifyNewAdmission } = await import("./notificationService.js");
        notifyNewAdmission({ id: admissionId, ...formData }).catch(() => {});
        const { sendAdmissionReceivedMail, sendAdminNewAdmissionMail } = await import("./emailService.js");
        sendAdmissionReceivedMail({ id: admissionId, ...formData }).catch(() => {});
        const { getSettings } = await import("./settingsService.js");
        getSettings().then((settings) => {
          if (settings && settings.adminEmail) {
            sendAdminNewAdmissionMail(settings.adminEmail, { id: admissionId, ...formData }).catch(() => {});
          }
        }).catch(() => {});
      } catch (_) { /* notifications are best-effort */ }

      return { success: true, admissionId, admissionNo };
    } else {
      // Admin Admission
      formData.approvalStatus = "Approved";
      formData.status = "Active";

      // ── Student Portal login ──────────────────────────────────────────
      // If Login ID + Password were entered on the admission form, create a
      // REAL Firebase Auth account first, then key the student document by
      // that uid — the portal and auth guard both look up students/{uid}.
      const loginId = String(formData.loginId || "").trim();
      const loginPassword = String(formData.loginPassword || "").trim();

      if ((loginId && !loginPassword) || (!loginId && loginPassword)) {
        throw new Error("Fill in BOTH Login ID and Password to create a portal login (or leave both empty).");
      }

      let uid = null;
      if (loginId && loginPassword) {
        const account = await createPortalAccount(loginId, loginPassword); // throws with a clear message on failure
        uid = account.uid;
        formData.uid = uid;
        formData.authEmail = account.authEmail;
      }

      let studentId;
      if (uid) {
        await setDoc(doc(db, "students", uid), formData);
        studentId = uid;
      } else {
        const studentRef = await addDoc(collection(db, "students"), formData);
        studentId = studentRef.id;
      }
      return { success: true, studentId, accountCreated: !!uid };
    }
    
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

/**
 * Listen to pending admissions for the Admin queue.
 * `students` is the single source of truth: a pending application is a
 * students doc with approvalStatus == "Pending". The `admissions`
 * collection is retired as a data store (11 legacy history docs only).
 */
export const listenToPendingAdmissions = (onUpdate, onError) => {
  const q = query(collection(db, "students"), where("approvalStatus", "==", "Pending"));
  
  return onSnapshot(q, (snapshot) => {
    const list = [];
    snapshot.forEach(doc => {
      list.push({ id: doc.id, ...doc.data() });
    });
    list.sort((a, b) => {
      const ta = a.createdAt ? (typeof a.createdAt.toMillis === "function" ? a.createdAt.toMillis() : new Date(a.createdAt).getTime()) : 0;
      const tb = b.createdAt ? (typeof b.createdAt.toMillis === "function" ? b.createdAt.toMillis() : new Date(b.createdAt).getTime()) : 0;
      return (tb || 0) - (ta || 0);
    });
    onUpdate(list);
  }, onError);
};

// ==========================================
// UI ORCHESTRATION LOGIC
// ==========================================

let availablePlansList = [];

/** Minimal HTML escaping for user-supplied strings rendered into the queue. */
const escHtml = (v) => String(v == null ? "" : v)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export const initAdmissionsUI = async () => {
  const container = document.getElementById("page-admissions");
  if (!container) return; 

  const role = localStorage.getItem("userRole");
  const isStudent = role === "Student";
  const isAdminOrManager = role === "Owner/Admin" || role === "Manager";

  window.approveStudent = async (id) => {
    const confirmed = await window.showCustomConfirm("Approve Admission", "Are you sure you want to approve this student?", "Approve", false);
    if (confirmed) {
      const rec = (window.__pendingAdmissions || []).find(r => r.id === id) || {};
      const res = await approveAdmission(id);
      if (res.success) {
        // Log the decision so it stays visible on the Notifications page
        // after the item leaves the live pending queue.
        if (typeof window.recordAdmissionDecision === "function") {
          window.recordAdmissionDecision({
            admissionId: id,
            name: rec.name || "Admission",
            phone: rec.phone || "",
            planName: rec.planName || "",
            seat: rec.seatAssigned || rec.seatNumber || "",
            decision: "Approved",
          });
        }
        window.showToast("Admission Approved! Student is now Active.", "success");
      }
      else window.showToast("Error: " + res.error, "error");
    }
  };

  window.rejectStudent = async (id) => {
    const reason = await window.showCustomPrompt("Reject Admission", "Please provide a reason for rejection (optional):", "Reject", true);
    if (reason !== null) {
      const rec = (window.__pendingAdmissions || []).find(r => r.id === id) || {};
      const res = await rejectAdmission(id, reason);
      if (res.success) {
        if (typeof window.recordAdmissionDecision === "function") {
          window.recordAdmissionDecision({
            admissionId: id,
            name: rec.name || "Admission",
            phone: rec.phone || "",
            planName: rec.planName || "",
            seat: rec.seatAssigned || rec.seatNumber || "",
            decision: "Rejected",
            reason: reason || "",
          });
        }
        window.showToast("Admission Rejected.", "info");
      }
      else window.showToast("Error: " + res.error, "error");
    }
  };

  window.viewPaymentScreenshot = async (studentId) => {
    try {
        // 1. Prefer the payment screenshot stored on the student record
        //    (legacy fallback: the retired admissions doc).
        const { doc: fsDoc, getDoc: fsGet } = await import("firebase/firestore");
        const { db: _db } = await import("../firebase/firebase.js");
        let shot = null;
        for (const colName of ["students", "admissions"]) {
          try {
            const sSnap = await fsGet(fsDoc(_db, colName, studentId));
            if (sSnap.exists() && sSnap.data().paymentScreenshotUrl) { shot = sSnap.data().paymentScreenshotUrl; break; }
          } catch (_) { /* fall through to documents */ }
        }
        // 2. Fall back to the single student photo (or legacy selfie/profile).
        if (!shot) {
          const { loadStudentDocuments, getStudentPhoto } = await import("./documentUploadService.js");
          const docs = await loadStudentDocuments(studentId);
          // Payment screenshots are stored under `paymentScreenshot`;
          // otherwise show the student's single photo.
          shot = (docs && docs.paymentScreenshot) || getStudentPhoto(docs, null);
        }
        // 3. Resolve "firestore:<key>" markers to the real stored file.
        if (shot && String(shot).startsWith("firestore:")) {
          const key = String(shot).split(":")[1];
          const { loadStudentDocuments } = await import("./documentUploadService.js");
          const docs = await loadStudentDocuments(studentId);
          shot = (docs && docs[key]) || null;
        }
        if (shot) {
            const win = window.open("", "_blank");
            win.document.write('<html><body style="margin:0; display:flex; justify-content:center; align-items:center; background:#111;"><img src="' + shot + '" style="max-width:100%; max-height:100vh; object-fit:contain;"/></body></html>');
        } else {
            window.showToast("No screenshot found.", "warning");
        }
    } catch (e) {
        window.showToast("Error loading screenshot: " + e.message, "error");
    }
  };

  /**
   * Open the uploaded documents (studentDocuments/{id} → aadhaarFront,
   * aadhaarBack, photo, paymentScreenshot) for a pending applicant in a
   * modal — the profile card's Documents tab, reused read-only.
   */
  window.viewStudentDocuments = async (studentId) => {
    try {
      const { renderStudentDocuments } = await import("./documentUploadService.js");
      let modal = document.getElementById("adm-docs-modal");
      if (!modal) {
        modal = document.createElement("dialog");
        modal.id = "adm-docs-modal";
        modal.className = "card";
        modal.style.cssText = "border:none; border-radius:12px; padding:0; box-shadow:0 10px 30px rgba(0,0,0,0.5); background:var(--bg-card); color:var(--text-primary); max-width:760px; width:92%; margin:auto;";
        document.body.appendChild(modal);
      }
      modal.innerHTML = `
        <div style="padding:1.5rem; max-height:85vh; overflow-y:auto;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
            <div>
              <h2 style="margin:0; font-size:1.1rem;">Uploaded Documents</h2>
              <div style="font-size:12px; color:var(--text-muted);">Aadhaar front/back, photo and payment screenshot.</div>
            </div>
            <button class="btn btn-ghost" onclick="document.getElementById('adm-docs-modal').close()" style="padding:0.25rem 0.5rem;">✕</button>
          </div>
          <div id="adm-docs-list"></div>
        </div>`;
      if (!modal.open) modal.showModal();
      await renderStudentDocuments(studentId, "adm-docs-list");
    } catch (e) {
      window.showToast("Could not load documents: " + e.message, "error");
    }
  };

  // Setup tabs if admin
  if (isAdminOrManager) {
    // Theme-aware Approve / Reject buttons (dark default + light-mode).
    // Injected once so both themes stay in sync — no hardcoded colors.
    if (!document.getElementById("admission-action-styles")) {
      const st = document.createElement("style");
      st.id = "admission-action-styles";
      st.textContent = `
        /* Decision row: 2 primary actions over 2 secondary, never four buttons
           jammed edge-to-edge in one line. Wraps cleanly on narrow screens. */
        .approval-actions { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; align-items: center; max-width: 240px; margin-left: auto; }
        .approval-actions .btn { flex: 0 0 auto; min-height: 32px; padding: 7px 15px; font-size: 13px; font-weight: 700; line-height: 1.2; border-radius: 999px; letter-spacing: .01em; }
        .approval-actions .btn-approve, .approval-actions .btn-reject { flex: 1 1 84px; }
        .btn-approve, .btn-reject { padding: 7px 15px; border-radius: 999px; font-weight: 700; cursor: pointer; transition: filter .15s, transform .1s; }
        .btn-approve { background: rgba(16,185,129,.14); color: var(--accent-emerald); border: 1px solid rgba(16,185,129,.45); }
        .btn-reject { background: rgba(244,63,94,.14); color: var(--accent-red); border: 1px solid rgba(244,63,94,.45); }
        .btn-approve:hover, .btn-reject:hover { filter: brightness(1.15); }
        .btn-approve:active, .btn-reject:active { transform: scale(.97); }
      `;
      document.head.appendChild(st);
    }
    const pendingTab = document.getElementById("tab-pending-approval");
    if (pendingTab) pendingTab.style.display = "inline-block";

    // Listen to queue (new-arrival toast + beep live in adminNotificationUI —
    // single alert path, no duplicate toasts).
    listenToPendingAdmissions((records) => {
      const tbody = document.getElementById("pending-admissions-body");
      if (!tbody) return;

      // Self-heal: records created before admission numbers existed (or
      // written directly by the website without one) get a unique SH- number
      // assigned silently in the background. Approval carries it forward.
      // (Queue records ARE students docs now — never write to `admissions`.)
      records
        .filter((r) => !r.studentId && !r.admissionNo)
        .forEach(async (r) => {
          try {
            const tmp = {};
            await ensureStudentId(tmp);
            await updateDoc(doc(db, "students", r.id), {
              studentId: tmp.studentId,
              admissionNo: tmp.studentId,
              updatedAt: serverTimestamp(),
            });
          } catch (_) { /* one failure never blocks the list */ }
        });

      // Update tab badge with count
      const pendingTab = document.getElementById("tab-pending-approval");
      if (pendingTab && records.length > 0) {
        pendingTab.innerHTML = `Pending approval <span style="background:var(--danger); color:white; font-size:10px; font-weight:700; padding:1px 6px; border-radius:999px; margin-left:6px;">${records.length}</span>`;
        pendingTab.style.background = "var(--danger)";
        pendingTab.style.color = "white";
        pendingTab.style.border = "none";
      } else if (pendingTab) {
        pendingTab.innerHTML = "Pending approval";
        pendingTab.style.background = "var(--bg-gray)";
        pendingTab.style.color = "var(--text-muted)";
        pendingTab.style.border = "none";
      }
      
      if (!tbody) return;
      if (records.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:2rem; color:var(--text-muted);">No pending admissions.</td></tr>';
        return;
      }
      let html = "";
      records.forEach(r => {
        let createdAtDate = null;
        if (r.createdAt) {
          if (typeof r.createdAt.toMillis === 'function') {
            // Firestore Timestamp
            createdAtDate = new Date(r.createdAt.toMillis());
          } else if (r.createdAt instanceof Date) {
            // Date object
            createdAtDate = r.createdAt;
          } else if (typeof r.createdAt === 'string' || typeof r.createdAt === 'number') {
            // ISO string or timestamp
            createdAtDate = new Date(r.createdAt);
          }
        }
        const d = createdAtDate
          ? `${createdAtDate.toLocaleDateString()}<div style="font-size:10px; color:var(--text-muted);">${createdAtDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>`
          : "Just now";

        // Preferred seat — only exists when the plan allows seat selection
        // and one was picked (plans without seat preference strip the field
        // at submit/approve, so nothing renders there).
        const seatValue = String(r.seatAssigned || r.seatNumber || "").trim();
        const seatInfo = (seatValue && seatValue !== "undefined")
          ? `<div style="font-size:11px; color:var(--primary); font-weight:600; margin-top:4px;">Seat: ${escHtml(seatValue)}</div>`
          : "";

        // Source badge (Website | Portal | Admin) — what the applicant filled in
        const sourceVal = r.source ? String(r.source) : "";
        const sourceBadge = sourceVal
          ? `<span class="badge badge-info" style="margin-left:6px; font-size:10px;">${escHtml(sourceVal)}</span>`
          : "";

        // Payment line: method + transaction id OR payment due date
        const method = r.paymentMethod ? String(r.paymentMethod) : "";
        let paymentLine = "";
        if (method === "Paid") {
          paymentLine = `<div style="font-size:11px; color:var(--primary); font-weight:600; margin-top:4px;">Paid${r.transactionId ? ` · Txn: ${escHtml(r.transactionId)}` : ""}</div>`;
        } else if (method === "Pay Later") {
          paymentLine = `<div style="font-size:11px; color:var(--warning); font-weight:600; margin-top:4px;">Pay Later${r.paymentDueDate ? ` · due ${escHtml(r.paymentDueDate)}` : ""}</div>`;
        } else if (method) {
          paymentLine = `<div style="font-size:11px; color:var(--text-muted); font-weight:600; margin-top:4px;">${escHtml(method)}</div>`;
        }
        if (method !== "Paid" && r.transactionId) {
          paymentLine += `<div style="font-size:11px; color:var(--primary); font-weight:600; margin-top:4px;">Txn: ${escHtml(r.transactionId)}</div>`;
        }
        if (r.paymentScreenshotUrl) {
          paymentLine += `<button class="btn btn-sm btn-ghost" onclick="window.viewPaymentScreenshot('${r.id}')" style="padding:2px 6px; font-size:10px; margin-top:4px; height:auto; line-height:1.2;">View Screenshot</button>`;
        }

        html += `
          <tr>
            <td>
              <div style="font-weight:600; color:var(--text-primary);">${escHtml(r.name)}${sourceBadge}</div>
              <div style="font-size:11px; color:var(--text-muted);">${escHtml(r.email || "")}</div>
              <div style="font-size:10px; color:var(--text-muted);">${escHtml(r.studentId || r.admissionNo || r.id)}</div>
            </td>
            <td>${escHtml(r.phone)}${paymentLine}</td>
            <td>${escHtml(r.planName || "")}${seatInfo}</td>
            <td>${d}</td>
            <td style="text-align:right;">
              <div class="approval-actions">
                <button class="btn btn-approve" onclick="window.approveStudent('${r.id}')">Approve</button>
                <button class="btn btn-reject" onclick="window.rejectStudent('${r.id}')">Reject</button>
                <button class="btn btn-ghost" title="Open full student card" onclick="window.openStudentProfileById('${r.id}')">Open</button>
                <button class="btn btn-ghost" title="View uploaded documents" onclick="window.viewStudentDocuments('${r.id}')">Docs</button>
              </div>
            </td>
          </tr>
        `;
      });
      tbody.innerHTML = html;
    });
  } else {
    // Hide pending approval tab for students
    const pendingTab = document.getElementById("tab-pending-approval");
    if (pendingTab) pendingTab.style.display = "none";
  }

  // Populate plans dropdown
  const planSelect = document.getElementById("adm-plan");
  if (planSelect) {
    planSelect.innerHTML = "<option value=''>Choose plan</option>";
    try {
      availablePlansList = await fetchPlansForDropdown(isStudent);
      let html = "<option value=''>Choose plan</option>";
      availablePlansList.forEach(p => {
        html += `<option value="${p.id}">${p.planName} - ₹${p.price}</option>`;
      });
      planSelect.innerHTML = html;
    } catch (e) {
      planSelect.innerHTML = "<option value=''>Failed to load plans</option>";
    }
  }

  // Populate seats dropdown
  const seatSelect = document.getElementById("adm-seat");
  if (seatSelect) {
    seatSelect.innerHTML = "<option value=''>Loading...</option>";
    try {
      const q = query(collection(db, "seats"), where("status", "==", "Available"));
      const snap = await getDocs(q);
      let validSeats = [];
      snap.forEach(doc => {
        const s = doc.data();
        if (s.seatNumber && String(s.seatNumber).trim() !== "" && String(s.seatNumber) !== "undefined") {
          const seatStr = String(s.seatNumber).trim();
          const match = seatStr.match(/^([AB])(\d+)$/i);
          if (match) {
            const prefix = match[1].toUpperCase();
            const number = Number(match[2]);
            const maxNumber = prefix === "A" ? 68 : 40;
            if (number >= 1 && number <= maxNumber) {
              validSeats.push(`${prefix}${String(number).padStart(2, "0")}`);
            }
          }
        }
      });
      
      validSeats = [...new Set(validSeats)].sort((a, b) => a.localeCompare(b, undefined, {numeric: true, sensitivity: 'base'}));
      
      let html = `<option value=''>${validSeats.length} available</option>`;
      validSeats.forEach(seat => {
        html += `<option value="${seat}">${seat}</option>`;
      });
      seatSelect.innerHTML = html;
    } catch (e) {
      seatSelect.innerHTML = "<option value=''>Failed to load seats</option>";
    }
  }

  // Tab switcher logic
  window.switchAdmissionTab = (tab) => {
    const isNew = tab === 'new';
    
    document.getElementById("view-new-admission").style.display = isNew ? "flex" : "none";
    document.getElementById("view-pending-approval").style.display = isNew ? "none" : "block";
    
    const newBtn = document.getElementById("tab-new-admission");
    const pendBtn = document.getElementById("tab-pending-approval");
    
    if (isNew) {
      newBtn.style.background = "var(--bg-card)";
      newBtn.style.color = "var(--text-primary)";
      newBtn.style.border = "1px solid var(--border)";
      newBtn.style.boxShadow = "0 1px 3px rgba(0,0,0,0.05)";
      
      pendBtn.style.background = "var(--bg-hover)";
      pendBtn.style.color = "var(--text-secondary)";
      pendBtn.style.border = "none";
      pendBtn.style.boxShadow = "none";
    } else {
      pendBtn.style.background = "var(--bg-card)";
      pendBtn.style.color = "var(--text-primary)";
      pendBtn.style.border = "1px solid var(--border)";
      pendBtn.style.boxShadow = "0 1px 3px rgba(0,0,0,0.05)";
      
      newBtn.style.background = "var(--bg-hover)";
      newBtn.style.color = "var(--text-secondary)";
      newBtn.style.border = "none";
      newBtn.style.boxShadow = "none";
    }
  };

  window.updateSummary = () => {
    const planId = document.getElementById("adm-plan").value;
    if (!planId) {
      document.getElementById("summary-plan").innerText = "—";
      document.getElementById("summary-amount").innerText = "—";
      document.getElementById("summary-start").innerText = "—";
      document.getElementById("summary-ends").innerText = "—";
      return;
    }
    
    const plan = availablePlansList.find(p => p.id === planId);
    if (plan) {
      document.getElementById("summary-plan").innerText = plan.planName;
      document.getElementById("summary-amount").innerText = `₹${plan.price}`;
      
      const today = new Date();
      document.getElementById("summary-start").innerText = today.toLocaleDateString('en-GB'); // dd/mm/yyyy
      
      if (typeof plan.duration === 'number') {
        const endDate = new Date(today);
        endDate.setDate(endDate.getDate() + plan.duration);
        document.getElementById("summary-ends").innerText = endDate.toLocaleDateString('en-GB');
      } else {
        document.getElementById("summary-ends").innerText = "Custom";
      }
    }
  };

  window.resetAdmission = () => {
    document.getElementById("admission-form").reset();
    window.updateSummary();
  };

  window.submitAdmissionForm = async (overridePaymentMethod = null, txnId = null, dueDate = null) => {
    // If Admin/Manager and no payment method chosen yet, show popup
    if (isAdminOrManager && !overridePaymentMethod) {
      if (!document.getElementById("admission-form").checkValidity()) {
        document.getElementById("admission-form").reportValidity();
        return;
      }
      const planEl = document.getElementById("adm-plan");
      if (!planEl || !planEl.value) {
        if(typeof showToast === 'function') showToast("Please select a plan first.", "warning");
        return;
      }

      window.processAdminPayment = (method) => {
        if (method === 'Paid (Cash)') {
          document.getElementById('admin-payment-modal').remove();
          window.submitAdmissionForm('Paid', null, null);
        } else if (method === 'Paid (UPI)') {
          document.getElementById('admin-payment-step-1').style.display = 'none';
          document.getElementById('admin-payment-step-upi').style.display = 'block';
        } else if (method === 'Pay Later') {
          document.getElementById('admin-payment-step-1').style.display = 'none';
          document.getElementById('admin-payment-step-later').style.display = 'block';
          // Set default due date to 3 days from now
          const d = new Date();
          d.setDate(d.getDate() + 3);
          document.getElementById('admin-due-date').value = d.toISOString().split('T')[0];
        }
      };

      window.finalizeAdminPayment = (method) => {
        let tId = null;
        let dDate = null;
        if (method === 'Paid (UPI)') {
          tId = document.getElementById('admin-txn-id').value;
          if (!tId) {
             if(typeof showToast === 'function') showToast("Transaction ID is required", "warning");
             return;
          }
        } else if (method === 'Pay Later') {
          dDate = document.getElementById('admin-due-date').value;
          if (!dDate) {
             if(typeof showToast === 'function') showToast("Due Date is required", "warning");
             return;
          }
        }
        document.getElementById('admin-payment-modal').remove();
        window.submitAdmissionForm(method === 'Paid (UPI)' ? 'Paid' : 'Pay Later', tId, dDate);
      };

      const amountText = document.getElementById("summary-amount") ? document.getElementById("summary-amount").innerText : "Amount";

      const modalHtml = `
        <dialog id="admin-payment-modal" class="card" style="border:none; border-radius:12px; padding:0; box-shadow:0 10px 30px rgba(0,0,0,0.5); background: var(--bg-card); color: var(--text-primary); max-width: 450px; margin: auto;">
          <div style="padding: 1.5rem; border-bottom: 1px solid var(--borderBright); display: flex; justify-content: space-between; align-items: center;">
            <h2 style="font-size: 1.1rem; font-weight: 600; margin: 0;">Payment Options</h2>
            <button onclick="document.getElementById('admin-payment-modal').remove()" style="background: none; border: none; font-size: 1.2rem; cursor: pointer; color: var(--text-muted);">&times;</button>
          </div>
          
          <div id="admin-payment-step-1" style="padding: 1.5rem; text-align: center;">
            <p style="margin-bottom: 1.5rem; color: var(--text-secondary); font-size: 0.95rem;">How is the student paying the admission fee?</p>
            <div style="display: flex; gap: 1rem; justify-content: center; flex-direction: column;">
              <button type="button" class="btn btn-primary" onclick="window.processAdminPayment('Paid (UPI)')" style="width: 100%; padding: 12px; font-size: 15px;">Paid via UPI</button>
              <button type="button" class="btn btn-primary" onclick="window.processAdminPayment('Paid (Cash)')" style="width: 100%; padding: 12px; font-size: 15px; background: #16a34a; border: none;">Paid via Cash</button>
              <button type="button" class="btn btn-ghost" onclick="window.processAdminPayment('Pay Later')" style="width: 100%; padding: 12px; font-size: 15px; border: 1px solid var(--borderBright);">Pay Later</button>
            </div>
          </div>

          <div id="admin-payment-step-upi" style="display: none; padding: 1.5rem;">
            <div style="text-align: center; margin-bottom: 1.5rem;">
              <img src="" class="payment-qr-img" alt="Scan to Pay" style="width: 180px; height: 180px; object-fit: contain; border: 1px solid var(--border); border-radius: 8px; margin-bottom: 0.5rem;" />
              <div style="font-weight: 600; color: var(--text-primary);">Scan to Pay: <span style="color: var(--primary);">${amountText}</span></div>
            </div>
            <div class="form-group" style="margin-bottom: 1.5rem;">
              <label>Transaction ID *</label>
              <input type="text" id="admin-txn-id" required style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid var(--border);" placeholder="Enter UPI Ref ID" />
            </div>
            <button type="button" class="btn btn-primary" onclick="window.finalizeAdminPayment('Paid (UPI)')" style="width: 100%; padding: 12px; font-size: 15px;">Mark as Paid & Submit</button>
          </div>

          <div id="admin-payment-step-later" style="display: none; padding: 1.5rem;">
            <div class="form-group" style="margin-bottom: 1.5rem;">
              <label>Payment Due Date *</label>
              <input type="date" id="admin-due-date" required style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid var(--border);" />
            </div>
            <button type="button" class="btn btn-primary" onclick="window.finalizeAdminPayment('Pay Later')" style="width: 100%; padding: 12px; font-size: 15px;">Confirm Pay Later</button>
          </div>
        </dialog>
      `;
      const existing = document.getElementById("admin-payment-modal");
      if (existing) existing.remove();
      document.body.insertAdjacentHTML('beforeend', modalHtml);
      document.getElementById("admin-payment-modal").showModal();
      
      // Paint the single live QR (upload once in Settings → Payment Settings).
      import("./qrService.js").then(({ paintQrImages }) => paintQrImages()).catch(() => {});
      return;
    }

    const btn = document.getElementById("btn-submit-admission");
    const originalContent = btn.innerHTML;
    btn.innerHTML = "Submitting...";
    btn.disabled = true;

    try {
      const planEl = document.getElementById("adm-plan");
      const seatEl = document.getElementById("adm-seat");
      
      const planId = planEl.value;
      const plan = availablePlansList.find(p => p.id === planId);
      const selectedSeatNumber = seatEl?.value || "";

      let selectedSeat = null;
      if (selectedSeatNumber) {
        const availableSeats = await getDocs(query(collection(db, "seats"), where("status", "==", "Available")));
        selectedSeat = availableSeats.docs.find(seatDoc => {
          const seatValue = String(seatDoc.data().seatNumber || "").match(/^([AB])(\d+)$/i);
          if (!seatValue) return false;
          return `${seatValue[1].toUpperCase()}${String(Number(seatValue[2])).padStart(2, "0")}` === selectedSeatNumber;
        });
        if (!selectedSeat) {
          throw new Error("That seat is no longer available. Please choose another seat.");
        }
      }

      const data = {
        name: document.getElementById("adm-name").value,
        phone: document.getElementById("adm-phone").value,
        email: document.getElementById("adm-email")?.value || "",
        dob: document.getElementById("adm-dob")?.value || "",
        gender: document.getElementById("adm-gender")?.value || "",
        parentPhone: document.getElementById("adm-parent-phone")?.value || "",
        college: document.getElementById("adm-college")?.value || "",
        course: document.getElementById("adm-course")?.value || "",
        address: document.getElementById("adm-address")?.value || "",
        remarks: document.getElementById("adm-remarks")?.value || "",
        loginCredentials: (() => {
          const id = document.getElementById("adm-login-id")?.value?.trim() || "";
          const pass = document.getElementById("adm-login-pass")?.value?.trim() || "";
          if (id && pass) return `${id} / ${pass}`;
          if (id) return id;
          if (pass) return pass;
          return "";
        })(),
        // Raw fields used to create the real Student Portal login account
        loginId: document.getElementById("adm-login-id")?.value?.trim() || "",
        loginPassword: document.getElementById("adm-login-pass")?.value?.trim() || "",
        planId: planId,
        planName: plan ? plan.planName : "",
        seatAssigned: selectedSeatNumber,
        seatNumber: selectedSeatNumber,
        paymentMethod: isAdminOrManager ? (overridePaymentMethod || "Admin Created") : "Pending",
        termsAccepted: true
      };

      if (txnId) data.transactionId = txnId;
      if (dueDate) data.paymentDueDate = dueDate;

      const res = await submitAdmission(data, isStudent);
      if (res.success) {
        if (isStudent) {
            if (data.paymentMethod === "Paid") {
                window.showToast("Payment verified! You are now admitted and will be redirected to your dashboard.", "success");
            } else {
                window.showToast("Admission request submitted and is Pending Approval!", "success");
            }
        } else {
            if (selectedSeat) {
              await updateDoc(doc(db, "seats", selectedSeat.id), {
                status: "Occupied",
                assignedStudentId: res.studentId,
                assignedStudentName: data.name,
                planType: data.planName,
                lastUpdated: serverTimestamp()
              });
            }
            window.showToast(
              res.accountCreated
                ? `Student admitted! Portal login created — student signs in with: ${data.loginId}`
                : "Student successfully admitted as Active!",
              "success"
            );
        }
        window.resetAdmission();
      } else {
        window.showToast("Error: " + res.error, "error");
      }
    } catch (e) {
      window.showToast("Validation Error: " + e.message, "error");
    } finally {
      btn.innerHTML = originalContent;
      btn.disabled = false;
    }
  };
};
