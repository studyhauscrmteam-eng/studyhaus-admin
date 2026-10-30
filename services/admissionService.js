import { collection, addDoc, serverTimestamp, getDocs, getDoc, query, where, onSnapshot, doc, updateDoc, setDoc, runTransaction } from "firebase/firestore";
import { db } from "../firebase/firebase.js";
import { validateStudentData } from "./studentValidation.js";
import { approveAdmission, rejectAdmission, dismissAdmission } from "./approvalService.js";
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
 * Write the students record AND the "one request per phone/email" claim in
 * ONE transaction — both land or neither does. EVERY read is issued before
 * the first write (Firestore rejects a tx.get() after a tx.set()).
 *
 * A second request for the same number throws here, before anything is
 * created, with the friendly message the applicant sees. New prefixes
 * (`req_adm_` / `req_admmail_`) keep this clear of the portal's own
 * `phone_` / `email_` index claims.
 *
 * @returns {Promise<string>} the record id
 */
const createStudentWithClaim = async (ref, payload) => {
  const phone = String(payload.phone || "").trim();
  const email = String(payload.email || "").trim().toLowerCase();
  const phoneClaimRef = phone ? doc(db, "uniqueness", `req_adm_${phone}`) : null;
  const emailClaimRef = email ? doc(db, "uniqueness", `req_admmail_${email}`) : null;

  await runTransaction(db, async (tx) => {
    const pc = phoneClaimRef ? await tx.get(phoneClaimRef) : null;
    const ec = emailClaimRef ? await tx.get(emailClaimRef) : null;
    // `exists` is a METHOD on the web SDK's DocumentSnapshot.
    if ((pc && pc.exists()) || (ec && ec.exists())) {
      throw new Error(
        `We already have a request from ${phone || email} — no second one can be filed. We'll call you.`
      );
    }
    tx.set(ref, payload, { merge: true });
    const stamp = { docPath: ref.path, uid: "", createdAt: serverTimestamp() };
    if (phoneClaimRef) tx.set(phoneClaimRef, { kind: "phone-index", ...stamp });
    if (emailClaimRef) tx.set(emailClaimRef, { kind: "email", ...stamp });
  });
  return ref.id;
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
      {
        const ref = admissionId
          ? doc(db, "students", admissionId)
          : doc(collection(db, "students"));
        admissionId = await createStudentWithClaim(ref, formData);
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

      const studentId = await createStudentWithClaim(
        uid ? doc(db, "students", uid) : doc(collection(db, "students")),
        formData
      );
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
/**
 * 7 days: a request nobody has acted on leaves the queue by itself, so the
 * approval page can never sit jammed for a fortnight. Fires once per record
 * (guarded by `expiredThisSession`) and only while it is still Pending, so
 * it is idempotent and can never write-loop or swallow a living claim.
 * Records with no readable timestamp at all are skipped rather than nuked.
 */
const EXPIRE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const expiredThisSession = new Set();

const recordTimeMs = (r) => {
  // The clock starts when the APPLICATION was filed, not when the portal
  // account was created: a half-finished sign-up that finally completes months
  // later must still get its full 7 days in the queue.
  const v = r.submittedAt || r.createdAt || r.updatedAt;
  if (!v) return 0;
  if (typeof v.toMillis === "function") return v.toMillis();
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
};

const expireStaleRequests = (list) => {
  const cutoff = Date.now() - EXPIRE_AFTER_MS;
  list.forEach((r) => {
    // Not filed yet = not a request. Expiring one would flip approvalStatus
    // to "Expired", and a student may not write approvalStatus back to
    // "Pending" — so their finished application could never reach the queue.
    if (r.applicationReady === false) return;
    if (expiredThisSession.has(r.id)) return;
    const t = recordTimeMs(r);
    if (!t || t > cutoff) return;
    expiredThisSession.add(r.id);
    updateDoc(doc(db, "students", r.id), {
      approvalStatus: "Expired",
      status: "Expired",
      expiredAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }).catch(() => { expiredThisSession.delete(r.id); });
  });
};

/**
 * Owner rule: "the admission alert MUST appear after the student fills the
 * entire onboarding form — then and only then."
 *
 * The Student Portal writes `applicationReady: false` the moment the account
 * is created (before a single form field is filled) and flips it to `true`
 * only in `submitPaymentAndApplication`, i.e. once the whole onboarding form
 * plus payment proof has been submitted. The queue — and therefore the bell,
 * the tab badge and the admission alerts — filters on that flag.
 *
 * A record with NO flag predates this rule or was written by the website /
 * staff (complete by definition), so it counts as ready.
 */
const isApplicationReady = (r) => !!r && r.applicationReady !== false;

export const listenToPendingAdmissions = (onUpdate, onError) => {
  const q = query(collection(db, "students"), where("approvalStatus", "==", "Pending"));
  
  return onSnapshot(q, (snapshot) => {
    const list = [];
    snapshot.forEach(doc => {
      list.push({ id: doc.id, ...doc.data() });
    });
    const ageOf = (r) => {
      const v = r.submittedAt || r.createdAt;
      if (!v) return 0;
      return typeof v.toMillis === "function" ? v.toMillis() : (new Date(v).getTime() || 0);
    };
    list.sort((a, b) => ageOf(b) - ageOf(a));
    // Expiry runs over every FILED pending record; only COMPLETE applications
    // are handed on to the table, the badge and the bell.
    expireStaleRequests(list);
    onUpdate(list.filter(isApplicationReady));
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

/**
 * The "Pending approval" tab counter.
 *
 * BUG this replaces: the count used to be painted inside the table renderer,
 * AFTER `if (!tbody) return;` — so whenever the pending table was not in the
 * DOM (role-restricted markup, page not fully swapped in yet) the number was
 * simply never written and the badge stayed frozen at whatever it had last
 * shown. It also wrote its own inline `background`/`color`, which the tab
 * switcher then overwrote, so the pill turned into invisible text.
 *
 * Now: one function, called unconditionally from the listener, styled by the
 * `.adm-tab-count` / `.has-pending` classes that `switchAdmissionTab` never
 * touches.
 *
 * @param {number} count
 */
const paintPendingTabBadge = (records) => {
  const tab = document.getElementById("tab-pending-approval");
  if (!tab) return;
  // Visit-to-clear: the pill counts only applications the operator has NOT
  // seen yet. Opening the Pending approval tab marks the whole queue seen
  // (see switchAdmissionTab) so the badge drops with no clicking, no
  // buttons — a brand-new application lights it again. Deciding (approve /
  // reject / dismiss) removes the record from the queue entirely.
  const list = Array.isArray(records) ? records : [];
  const seen = getPendingSeen();
  const n = list.filter((r) => r && !seen.has(String(r.id))).length;
  tab.innerHTML = n > 0
    ? `Pending approval<span class="adm-tab-count">${n}</span>`
    : `Pending approval`;
  tab.classList.toggle("has-pending", n > 0);
  tab.setAttribute("aria-label", n > 0 ? `Pending approval, ${n} waiting` : "Pending approval");
};

/** Ids of pending applications already seen (visit-to-clear state). */
const PENDING_SEEN_KEY = "sh_pending_seen_v1";
const getPendingSeen = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(PENDING_SEEN_KEY) || "[]");
    return new Set(Array.isArray(raw) ? raw.map(String) : []);
  } catch (_) {
    return new Set();
  }
};
/** Mark every id in the current queue as seen; badge drops to zero. */
const markPendingSeen = (records) => {
  try {
    const list = Array.isArray(records) ? records : [];
    const s = getPendingSeen();
    for (const r of list) {
      if (r && r.id != null) s.add(String(r.id));
    }
    localStorage.setItem(PENDING_SEEN_KEY, JSON.stringify([...s].slice(-300)));
  } catch (_) { /* storage blocked — badge just keeps counting */ }
};
/** Latest queue snapshot (both listeners write here; the tab switcher reads). */
let lastPendingRecords = [];

export const initAdmissionsUI = async () => {
  const container = document.getElementById("page-admissions");
  if (!container) return; 

  const role = localStorage.getItem("userRole");
  const isStudent = role === "Student";
  const isAdminOrManager = role === "Owner/Admin" || role === "Manager";

  window.approveStudent = async (id) => {
    const confirmed = await window.showCustomConfirm("Approve Admission", "Are you sure you want to approve this student?", "Approve", false);
    if (confirmed) {
      const res = await approveAdmission(id);
      if (res.success) {
        window.showToast("Admission Approved! Student is now Active.", "success");
        if (typeof window.renderStudentTable === 'function') {
          try { window.renderStudentTable(); } catch (_) {}
        }
      }
      else window.showToast("Error: " + res.error, "error");
    }
  };

  window.rejectStudent = async (id) => {
    const reason = await window.showCustomPrompt("Reject Admission", "Please provide a reason for rejection (optional):", "Reject", true);
    if (reason !== null) {
      const res = await rejectAdmission(id, reason);
      if (res.success) {
        window.showToast("Admission Rejected.", "info");
      }
      else window.showToast("Error: " + res.error, "error");
    }
  };

  /**
   * Take the request out of the queue without approving or rejecting it.
   * Nothing is deleted: the record keeps everything and simply stops being
   * an open item (and stops holding the badge).
   */
  window.dismissStudent = async (id) => {
    const confirmed = await window.showCustomConfirm(
      "Dismiss Request",
      "Remove this request from the approval queue? Nothing is deleted — the record stays in Students, it just stops waiting for a decision.",
      "Dismiss",
      false
    );
    if (confirmed) {
      const res = await dismissAdmission(id);
      if (res.success) {
        window.showToast("Request dismissed — it is out of the queue.", "info");
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
            if (window.openProofViewer) {
              window.openProofViewer({ sources: [shot], title: "Payment Screenshot Proof" });
            } else {
              const win = window.open("", "_blank");
              win.document.write('<html><body style="margin:0; display:flex; justify-content:center; align-items:center; background:#111;"><img src="' + shot + '" style="max-width:100%; max-height:100vh; object-fit:contain;"/></body></html>');
            }
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

  /**
   * ── ONE "Details" panel for a pending applicant ─────────────────────────
   * Replaces the old Open + Docs pair.
   *
   * Deliberately NOT a copy of the student profile card (owner: "don't copy
   * the existing student card, make fresh"): an identity header, three small
   * fact panels laid out on a grid, a document strip, then the decision row.
   * Every uploaded file opens in a full-screen lightbox — the big
   * full-bleed viewer with prev/next, a counter and keyboard control.
   */
  const admDocIndex = {};
  let lbItems = [];
  let lbIndex = 0;

  const isPdfSrc = (s) => /^data:application\/(pdf|octet-stream)/i.test(String(s || ""))
    || /\.pdf(\?|#|$)/i.test(String(s || ""));

  const ensureLightbox = () => {
    let dlg = document.getElementById("adm-lightbox");
    if (dlg) return dlg;
    dlg = document.createElement("dialog");
    dlg.id = "adm-lightbox";
    dlg.className = "adm-lightbox";
    dlg.setAttribute("aria-label", "Document viewer");
    dlg.innerHTML = `
      <button type="button" class="lb-btn lb-close" aria-label="Close viewer">×</button>
      <button type="button" class="lb-btn lb-prev" aria-label="Previous document">‹</button>
      <div class="lb-stage">
        <figure>
          <img alt="" />
          <figcaption></figcaption>
        </figure>
      </div>
      <button type="button" class="lb-btn lb-next" aria-label="Next document">›</button>
      <div class="lb-hint">← → to move · Esc to close</div>
      <div class="lb-count"></div>`;
    document.body.appendChild(dlg);

    const paint = () => {
      const item = lbItems[lbIndex];
      if (!item) return;
      const img = dlg.querySelector("img");
      img.src = item.src;
      img.alt = item.label;
      dlg.querySelector("figcaption").textContent = item.label;
      dlg.querySelector(".lb-count").textContent =
        lbItems.length > 1 ? `${lbIndex + 1} / ${lbItems.length} · ${item.label}` : item.label;
      const multi = lbItems.length > 1;
      dlg.querySelector(".lb-prev").style.display = multi ? "flex" : "none";
      dlg.querySelector(".lb-next").style.display = multi ? "flex" : "none";
      dlg.querySelector(".lb-hint").style.display = multi ? "block" : "none";
    };
    const step = (delta) => {
      if (lbItems.length < 2) return;
      lbIndex = (lbIndex + delta + lbItems.length) % lbItems.length;
      paint();
    };
    dlg._paint = paint;
    dlg._step = step;

    dlg.querySelector(".lb-close").onclick = () => dlg.close();
    dlg.querySelector(".lb-prev").onclick = () => step(-1);
    dlg.querySelector(".lb-next").onclick = () => step(1);
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg || (e.target.classList && e.target.classList.contains("lb-stage"))) dlg.close();
    });
    dlg.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); dlg.close(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
    });
    return dlg;
  };

  const openLightbox = (items, index) => {
    const dlg = ensureLightbox();
    lbItems = items || [];
    lbIndex = Math.max(0, index || 0);
    dlg._paint();
    if (!dlg.open) dlg.showModal();
  };

  const ensureDetailsDialog = () => {
    let dlg = document.getElementById("adm-details-modal");
    if (dlg) return dlg;
    dlg = document.createElement("dialog");
    dlg.id = "adm-details-modal";
    dlg.className = "adm-details";
    dlg.setAttribute("aria-label", "Applicant details");
    document.body.appendChild(dlg);
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
    return dlg;
  };

  // Close the panel FIRST so the Approve/Reject/Dismiss confirmation owns
  // the screen instead of stacking underneath a modal dialog.
  window.__admDecide = async (action, id) => {
    const dlg = document.getElementById("adm-details-modal");
    if (dlg && dlg.open) dlg.close();
    if (action === "approve") await window.approveStudent(id);
    else if (action === "reject") await window.rejectStudent(id);
    else if (action === "dismiss") await window.dismissStudent(id);
  };

  window.__openAdmDoc = (sid, i) => {
    const all = admDocIndex[sid] || [];
    const item = all[i];
    if (!item) return;
    if (isPdfSrc(item.src)) { window.open(item.src, "_blank", "noopener"); return; }
    const imgs = all.filter((e) => !isPdfSrc(e.src));
    openLightbox(imgs, imgs.indexOf(item));
  };

  window.viewApplicantDetails = async (id) => {
    const dlg = ensureDetailsDialog();
    dlg.innerHTML = `<div class="ad-loading">Loading applicant…</div>`;
    if (!dlg.open) dlg.showModal();

    try {
      let data = (window.__pendingAdmissions || []).find((r) => r.id === id) || null;
      if (!data) {
        const { doc: fdoc, getDoc: fget } = await import("firebase/firestore");
        const { db: fdb } = await import("../firebase/firebase.js");
        const s = await fget(fdoc(fdb, "students", id));
        if (!s.exists()) throw new Error("This application is no longer in the queue.");
        data = { id: s.id, ...s.data() };
      }

      let docs = null;
      try {
        const { loadStudentDocuments } = await import("./documentUploadService.js");
        docs = await loadStudentDocuments(id, data);
      } catch (_) { /* no documents store row — the panel just shows none */ }

      // Merge documents from store + student data (e.g. data._documents or data.documents)
      const allDocs = {
        ...(typeof docs === "object" && docs ? docs : {}),
        ...(typeof data._documents === "object" && data._documents ? data._documents : {}),
        ...(typeof data.documents === "object" && data.documents ? data.documents : {})
      };

      // `firestore:<key>` markers mean "the value lives in studentDocuments".
      const resolve = (v) => {
        const s = v == null ? "" : String(v);
        if (!s) return "";
        if (s.startsWith("firestore:")) {
          const key = s.split(":")[1];
          return (allDocs && allDocs[key]) || (data && data[key]) || "";
        }
        return s;
      };

      const entries = [];
      const seenLabels = new Set();
      const pushDoc = (raw, label) => {
        const v = resolve(raw);
        if (!v || seenLabels.has(label)) return;
        seenLabels.add(label);
        entries.push({ src: v, label });
      };

      // 1. Photo
      const photoVal =
        allDocs.photo ||
        allDocs.profilePhoto ||
        allDocs.selfie ||
        allDocs.photoUrl ||
        allDocs.profilePhotoUrl ||
        data.profilePhotoUrl ||
        data.photoUrl ||
        data.photo ||
        data.selfie;
      pushDoc(photoVal, "Photo");

      // 2. Aadhaar front
      const aadhaarFrontVal =
        allDocs.aadhaarFront ||
        allDocs.aadharFront ||
        allDocs.aadhaarFrontUrl ||
        allDocs.aadharFrontUrl ||
        allDocs.aadhaar_front ||
        allDocs.aadhar_front ||
        data.aadhaarFront ||
        data.aadharFront ||
        data.aadhaarFrontUrl ||
        data.aadharFrontUrl ||
        data.aadhaar_front ||
        data.aadhar_front;
      pushDoc(aadhaarFrontVal, "Aadhaar front");

      // 3. Aadhaar back
      const aadhaarBackVal =
        allDocs.aadhaarBack ||
        allDocs.aadharBack ||
        allDocs.aadhaarBackUrl ||
        allDocs.aadharBackUrl ||
        allDocs.aadhaar_back ||
        allDocs.aadhar_back ||
        data.aadhaarBack ||
        data.aadharBack ||
        data.aadhaarBackUrl ||
        data.aadharBackUrl ||
        data.aadhaar_back ||
        data.aadhar_back;
      pushDoc(aadhaarBackVal, "Aadhaar back");

      // 4. Payment screenshot
      const paymentScreenshotVal =
        allDocs.paymentScreenshot ||
        allDocs.paymentScreenshotUrl ||
        allDocs.payment_screenshot ||
        allDocs.screenshot ||
        allDocs.paymentProof ||
        data.paymentScreenshot ||
        data.paymentScreenshotUrl ||
        data.payment_screenshot ||
        data.screenshot ||
        data.paymentProof;
      pushDoc(paymentScreenshotVal, "Payment screenshot");

      // 5. Catch-all for any other files uploaded in studentDocuments or data
      const handledKeys = new Set([
        "photo", "profilePhoto", "selfie", "photoUrl", "profilePhotoUrl",
        "aadhaarFront", "aadharFront", "aadhaarFrontUrl", "aadharFrontUrl", "aadhaar_front", "aadhar_front",
        "aadhaarBack", "aadharBack", "aadhaarBackUrl", "aadharBackUrl", "aadhaar_back", "aadhar_back",
        "paymentScreenshot", "paymentScreenshotUrl", "payment_screenshot", "screenshot", "paymentProof",
        "studentId", "uid", "updatedAt", "createdAt", "migratedTo", "verificationNote", "id"
      ]);
      const combinedDocPool = { ...allDocs, ...(data || {}) };
      for (const [k, v] of Object.entries(combinedDocPool)) {
        if (handledKeys.has(k)) continue;
        if (typeof v === "string" && (v.startsWith("data:") || v.startsWith("http://") || v.startsWith("https://") || v.startsWith("firestore:"))) {
          const label = k.replace(/([A-Z])/g, " $1").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
          pushDoc(v, label || "Document");
        }
      }

      admDocIndex[id] = entries;

      const esc = (v) => escHtml(v);
      const val = (v) => (v == null || String(v).trim() === "" ? "" : String(v).trim());
      const row = (label, inner) => (inner ? `<dt>${esc(label)}</dt><dd>${inner}</dd>` : "");
      const plain = (label, v) => (val(v) ? row(label, esc(v)) : "");
      const tel = (label, v) => (val(v) ? row(label, `<a href="tel:${esc(v)}">${esc(v)}</a>`) : "");
      const mail = (label, v) => (val(v) ? row(label, `<a href="mailto:${esc(v)}">${esc(v)}</a>`) : "");

      // Deterministic header tint — same idea as the students table avatar.
      const pairs = [["#1d4ed8", "#dbeafe"], ["#0f766e", "#ccfbf1"], ["#b45309", "#fef3c7"],
        ["#6d28d9", "#ede9fe"], ["#be123c", "#ffe4e6"], ["#0369a1", "#e0f2fe"],
        ["#15803d", "#dcfce7"], ["#c2410c", "#ffedd5"]];
      let h = 0;
      for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
      const [fg, bg] = pairs[h % pairs.length];
      const initials = val(data.name)
        ? esc(String(data.name).trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase())
        : "??";

      // Submitted timestamp, rendered for humans in both shapes.
      let submitted = "";
      if (data.createdAt) {
        const t = typeof data.createdAt.toMillis === "function"
          ? new Date(data.createdAt.toMillis())
          : new Date(data.createdAt);
        if (!Number.isNaN(t.getTime())) {
          submitted = `${t.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })} · ` +
            t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        }
      }

      const source = data.isStudentSubmission
        ? (data.uid ? "Student portal" : "Website form")
        : "Entered by staff";

      const docStrip = entries.length
        ? `<div class="ad-doc-grid">${entries.map((e, i) => `
            <button type="button" class="ad-doc" onclick="window.__openAdmDoc('${id}', ${i})" title="Click to view full size">
              ${isPdfSrc(e.src)
                ? `<span class="thumb" style="font-size:30px;">📄</span>`
                : `<span class="thumb"><img src="${esc(e.src)}" alt="${esc(e.label)}" loading="lazy" /></span>`}
              <span class="cap">${esc(e.label)}</span>
              <span class="zoom">${isPdfSrc(e.src) ? "Open PDF" : "Click to enlarge"}</span>
            </button>`).join("")}</div>`
        : `<div class="ad-none">No documents have been uploaded for this application yet.</div>`;

      const remarks = val(data.remarks) || val(data.adminNotes) || "";

      // Effective subscription end date: never truncated to Pay Later due date
      const effectiveEndDate = (() => {
        const sDate = data.startDate || "";
        const eDate = data.endDate;
        const pDue = data.paymentDueDate;
        if (eDate && sDate) {
          const d1 = new Date(`${sDate}T00:00:00`);
          const d2 = new Date(`${eDate}T00:00:00`);
          const diff = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
          if (diff >= 14) return eDate;
          if (eDate === pDue || data.paymentMethod === "Pay Later" || diff <= 7) {
            const corr = new Date(d1);
            corr.setMonth(corr.getMonth() + 1);
            return corr.toISOString().split("T")[0];
          }
          return eDate;
        }
        if (eDate) return eDate;
        if (sDate) {
          const corr = new Date(`${sDate}T00:00:00`);
          corr.setMonth(corr.getMonth() + 1);
          return corr.toISOString().split("T")[0];
        }
        return pDue || "";
      })();

      dlg.innerHTML = `
        <div class="ad-head">
          <div class="ad-av" style="background:${bg}; color:${fg};">${initials}</div>
          <div class="ad-title">
            <h2>${esc(data.name || "Unnamed applicant")}</h2>
            <div class="ad-sub">
              <b>${esc(data.studentId || data.admissionNo || id)}</b>
              <span>${esc(source)}</span>
              ${submitted ? `<span>Submitted ${esc(submitted)}</span>` : ""}
            </div>
          </div>
          <button type="button" class="ad-x" aria-label="Close" onclick="document.getElementById('adm-details-modal').close()">×</button>
        </div>

        <div class="ad-body">
          <section class="ad-panel">
            <h3>Contact</h3>
            <dl class="ad-grid">
              ${tel("Mobile", data.phone)}
              ${tel("Parent mobile", data.parentPhone)}
              ${mail("Email", data.email)}
              ${plain("Date of birth", data.dob)}
              ${plain("Gender", data.gender)}
              ${plain("College", data.college)}
              ${plain("Course", data.course)}
            </dl>
          </section>

          <section class="ad-panel">
            <h3>Admission</h3>
            <dl class="ad-grid">
              ${plain("Application no.", data.studentId || data.admissionNo)}
              ${plain("Plan", data.planName)}
              ${plain("Start date", data.startDate)}
              ${plain("End date", effectiveEndDate)}
              ${plain("Duration", data.duration ? `${data.duration} days` : "")}
              ${val(data.seatAssigned || data.seatNumber)
                ? row("Preferred seat", `${esc(data.seatAssigned || data.seatNumber)} (${esc(data.seatFloor || data.floor || "Ground Floor")})`) : ""}
              ${plain("Address", data.address)}
              <dt>Status</dt><dd>${esc(data.approvalStatus || data.status || "Pending")}</dd>
            </dl>
          </section>

          <section class="ad-panel">
            <h3>Payment</h3>
            <dl class="ad-grid">
              ${plain("Method", data.paymentMethod)}
              ${plain("Transaction id", data.transactionId)}
              ${plain("Due date", data.paymentDueDate)}
              ${entries.some((e) => /payment/i.test(e.label))
                ? row("Screenshot", `<span style="color:var(--primary);">Uploaded — see below</span>`) : ""}
              ${!val(data.paymentMethod) && !val(data.transactionId)
                ? `<dt></dt><dd class="muted">No payment details yet</dd>` : ""}
            </dl>
          </section>

          <section class="ad-panel ad-docs">
            <h3>Documents <span>${entries.length ? `${entries.length} file${entries.length === 1 ? "" : "s"} · click to enlarge` : ""}</span></h3>
            ${docStrip}
          </section>

          ${remarks ? `<section class="ad-panel ad-remarks"><h3>Notes</h3><p>${esc(remarks)}</p></section>` : ""}
        </div>

        <div class="ad-foot">
          <button type="button" class="btn btn-approve" onclick="window.__admDecide('approve', '${id}')">Approve</button>
          <button type="button" class="btn btn-reject" onclick="window.__admDecide('reject', '${id}')">Reject</button>
          <button type="button" class="btn btn-dismiss" onclick="window.__admDecide('dismiss', '${id}')">Dismiss</button>
          <span class="ad-spacer"></span>
          <button type="button" class="btn btn-ghost" onclick="document.getElementById('adm-details-modal').close()">Close</button>
        </div>`;
    } catch (e) {
      dlg.innerHTML = `<div class="ad-loading">${escHtml(e.message || "Could not load this application.")}</div>`;
    }
  };

  // Setup tabs if admin
  if (isAdminOrManager) {
    // Theme-aware Admission UI (dark default + light-mode).
    // Injected once so both themes stay in sync — no hardcoded colors.
    if (!document.getElementById("admission-action-styles")) {
      const st = document.createElement("style");
      st.id = "admission-action-styles";
      st.textContent = `
        /* ── Admissions / Pending-approval tab pills ───────────────────────
           Class-driven on purpose. The old build wrote the active/inactive
           look straight onto the element's inline style, which meant the
           NEXT paint of the pending-count badge (or a later tab switch)
           overwrote it and the badge appeared "stuck". */
        .adm-tab { display: inline-block; border-radius: 999px; font-size: 13px; font-weight: 600; padding: 6px 16px;
          border: none; cursor: pointer; transition: background .15s, color .15s, box-shadow .15s, border-color .15s; }
        .adm-tab.is-active { background: var(--bg-card); color: var(--text-primary);
          border: 1px solid var(--border); box-shadow: 0 1px 3px rgba(0,0,0,.05); font-weight: 600; }
        .adm-tab:not(.is-active) { background: var(--bg-gray); color: var(--text-muted);
          border: none; box-shadow: none; font-weight: 500; }
        .adm-tab-count { display: inline-block; min-width: 17px; text-align: center;
          background: var(--danger); color: #fff; font-size: 10px; font-weight: 800;
          padding: 1px 5px; border-radius: 999px; margin-left: 7px; line-height: 1.55;
          font-variant-numeric: tabular-nums; }
        .adm-tab.has-pending { background: var(--danger); color: #fff; border-color: transparent; font-weight: 700; }
        .adm-tab.has-pending .adm-tab-count { background: rgba(255,255,255,.28); color: #fff; }

        /* ── Decision row ────────────────────────────────────────────────
           Four evenly sized controls, generous hit area, no edge-to-edge
           jam. Wrap onto two rows on narrow screens. */
        .approval-actions { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end;
          align-items: center; margin-left: auto; min-width: 216px; }
        .approval-actions .btn { flex: 0 0 auto; min-height: 34px; padding: 7px 14px;
          font-size: 12.5px; font-weight: 700; line-height: 1.2; border-radius: 8px;
          letter-spacing: .01em; white-space: nowrap; justify-content: center; }
        .approval-actions .btn-approve, .approval-actions .btn-reject { flex: 1 1 86px; }
        .btn-approve, .btn-reject, .btn-dismiss, .btn-info {
          cursor: pointer; transition: filter .15s, transform .1s, box-shadow .15s; }
        .btn-approve { background: rgba(16,185,129,.15); color: var(--accent-emerald); border: 1px solid rgba(16,185,129,.45); }
        .btn-reject { background: rgba(244,63,94,.15); color: var(--accent-red); border: 1px solid rgba(244,63,94,.45); }
        .btn-info { background: rgba(14,165,233,.15); color: var(--primary); border: 1px solid rgba(14,165,233,.45); }
        .btn-dismiss { background: var(--bg-hover); color: var(--text-secondary); border: 1px solid var(--border); }
        .btn-approve:hover, .btn-reject:hover, .btn-info:hover, .btn-dismiss:hover {
          filter: brightness(1.12); box-shadow: 0 2px 8px rgba(0,0,0,.18); }
        .btn-approve:active, .btn-reject:active, .btn-info:active, .btn-dismiss:active { transform: scale(.97); }
        .btn-approve:focus-visible, .btn-reject:focus-visible,
        .btn-info:focus-visible, .btn-dismiss:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }

        /* ── Applicant details panel (FRESH — not the student profile card) ── */
        dialog.adm-details { border: none; padding: 0; border-radius: 16px; width: min(920px, 94vw);
          max-width: none; background: var(--bg-card); color: var(--text-primary);
          box-shadow: 0 24px 70px rgba(0,0,0,.55); overflow: hidden; display: none; }
        dialog.adm-details[open] { display: flex; flex-direction: column; max-height: 92vh; }
        dialog.adm-details::backdrop { background: rgba(2,6,16,.72); backdrop-filter: blur(2px); }
        .ad-head { display: flex; align-items: flex-start; gap: 14px; padding: 20px 22px 16px;
          border-bottom: 1px solid var(--border); background:
          linear-gradient(180deg, rgba(14,165,233,.10), transparent); }
        .ad-av { width: 52px; height: 52px; border-radius: 14px; flex: 0 0 52px; display: flex;
          align-items: center; justify-content: center; font-weight: 800; font-size: 18px; letter-spacing: .02em; }
        .ad-title { flex: 1 1 auto; min-width: 0; }
        .ad-title h2 { margin: 0 0 3px; font-size: 1.15rem; line-height: 1.25; overflow-wrap: anywhere; }
        .ad-sub { font-size: 12px; color: var(--text-muted); display: flex; flex-wrap: wrap; gap: 4px 10px; }
        .ad-sub b { color: var(--primary); font-weight: 700; }
        .ad-x { background: var(--bg-hover); border: 1px solid var(--border); color: var(--text-secondary);
          width: 32px; height: 32px; border-radius: 9px; font-size: 17px; line-height: 1; cursor: pointer; flex: 0 0 32px; }
        .ad-x:hover { filter: brightness(1.15); }
        .ad-body { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: 14px; padding: 18px 22px; overflow-y: auto; flex: 1 1 auto; min-height: 0; }
        .ad-panel { background: var(--bg-hover); border: 1px solid var(--border);
          border-radius: 12px; padding: 13px 15px; }
        .ad-panel h3 { margin: 0 0 10px; font-size: 10.5px; font-weight: 800; letter-spacing: .09em;
          text-transform: uppercase; color: var(--text-muted); display: flex; justify-content: space-between;
          align-items: baseline; gap: 8px; }
        .ad-panel h3 span { font-weight: 600; letter-spacing: 0; text-transform: none; font-size: 11px; }
        .ad-grid { display: grid; grid-template-columns: auto 1fr; gap: 7px 12px; font-size: 13px; align-items: baseline; }
        .ad-grid dt { color: var(--text-muted); font-size: 12px; white-space: nowrap; }
        .ad-grid dd { margin: 0; color: var(--text-primary); font-weight: 600; overflow-wrap: anywhere; }
        .ad-grid dd a { color: var(--primary); text-decoration: none; }
        .ad-grid dd a:hover { text-decoration: underline; }
        .ad-grid dd.muted { color: var(--text-muted); font-weight: 500; }
        .ad-wide { grid-column: 1 / -1; }
        .ad-docs { grid-column: 1 / -1; }
        .ad-doc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 12px; }
        .ad-doc { background: var(--bg-card); border: 1px solid var(--border); border-radius: 11px;
          padding: 8px; cursor: zoom-in; text-align: center; transition: transform .14s, border-color .14s, box-shadow .14s; }
        .ad-doc:hover { transform: translateY(-3px); border-color: var(--primary);
          box-shadow: 0 8px 20px rgba(0,0,0,.25); }
        .ad-doc .thumb { width: 100%; aspect-ratio: 4 / 3; border-radius: 7px; overflow: hidden;
          background: var(--bg-base); display: flex; align-items: center; justify-content: center; }
        .ad-doc .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .ad-doc .cap { display: block; margin-top: 7px; font-size: 11px; font-weight: 600;
          color: var(--text-secondary); line-height: 1.3; overflow-wrap: anywhere; }
        .ad-doc .zoom { display: block; font-size: 10px; color: var(--primary); font-weight: 700; margin-top: 2px; }
        .ad-none { font-size: 13px; color: var(--text-muted); font-style: italic; }
        .ad-remarks { grid-column: 1 / -1; }
        .ad-remarks p { margin: 0; font-size: 13px; line-height: 1.55; color: var(--text-secondary);
          white-space: pre-wrap; overflow-wrap: anywhere; }
        .ad-foot { display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
          padding: 14px 22px; border-top: 1px solid var(--border); background: var(--bg-hover); }
        .ad-foot .ad-spacer { flex: 1 1 auto; }
        .ad-foot .btn { min-height: 36px; padding: 8px 18px; font-size: 13px; font-weight: 700; border-radius: 9px; }
        .ad-loading { padding: 3rem 2rem; text-align: center; color: var(--text-muted); font-size: 13px; }

        /* ── Lightbox: big, full-bleed media viewer ───────────────────── */
        dialog.adm-lightbox { border: none; padding: 0; margin: 0; width: 100vw; max-width: none;
          height: 100vh; max-height: none; background: rgba(3,7,15,.96); color: #f8fafc;
          display: none; overflow: hidden; }
        dialog.adm-lightbox[open] { display: flex; align-items: center; justify-content: center; }
        dialog.adm-lightbox::backdrop { background: rgba(2,6,16,.94); }
        .lb-stage { display: flex; align-items: center; justify-content: center; gap: 4px;
          width: 100%; height: 100%; padding: 46px 8px 60px; }
        .lb-stage figure { margin: 0; max-width: min(1100px, 82vw); display: flex; flex-direction: column;
          align-items: center; gap: 12px; }
        .lb-stage img { max-width: 100%; max-height: calc(100vh - 170px); object-fit: contain;
          border-radius: 8px; background: #0b1220; box-shadow: 0 20px 60px rgba(0,0,0,.6); }
        .lb-stage figcaption { font-size: 13px; color: #cbd5e1; text-align: center; letter-spacing: .01em; }
        .lb-btn { position: absolute; z-index: 2; background: rgba(255,255,255,.10);
          border: 1px solid rgba(255,255,255,.22); color: #f8fafc; cursor: pointer;
          display: flex; align-items: center; justify-content: center; transition: background .15s, transform .1s; }
        .lb-btn:hover { background: rgba(255,255,255,.2); }
        .lb-btn:active { transform: scale(.94); }
        .lb-close { top: 16px; right: 18px; width: 42px; height: 42px; border-radius: 12px; font-size: 24px; line-height: 1; }
        .lb-prev, .lb-next { top: 50%; margin-top: -26px; width: 52px; height: 52px; border-radius: 50%; font-size: 30px; }
        .lb-prev { left: 16px; }
        .lb-next { right: 16px; }
        .lb-count { position: absolute; left: 0; right: 0; bottom: 18px; text-align: center;
          font-size: 12px; color: #94a3b8; letter-spacing: .12em; text-transform: uppercase; }
        .lb-hint { position: absolute; left: 0; right: 0; bottom: 40px; text-align: center;
          font-size: 11px; color: #64748b; letter-spacing: .04em; }
        @media (max-width: 640px) {
          .lb-prev, .lb-next { width: 42px; height: 42px; font-size: 24px; }
          .lb-stage figure { max-width: 94vw; }
          .approval-actions { min-width: 0; justify-content: flex-start; margin-left: 0; }
        }
      `;
      document.head.appendChild(st);
    }

    window.approveProfileUpdateRequest = async (requestId) => {
      try {
        const reqRef = doc(db, "profileUpdateRequests", requestId);
        const snap = await getDoc(reqRef);
        if (!snap.exists()) throw new Error("Request not found.");
        const data = snap.data();
        if (data.status !== "Pending") throw new Error(`Request is already ${data.status}.`);

        let targetStudentId = data.studentId;
        let studentRef = doc(db, "students", targetStudentId);
        let studentSnap = await getDoc(studentRef);
        if (!studentSnap.exists() && data.uid) {
          targetStudentId = data.uid;
          studentRef = doc(db, "students", targetStudentId);
          studentSnap = await getDoc(studentRef);
        }
        if (!studentSnap.exists()) {
          const qSt = query(collection(db, "students"), where("studentId", "==", data.studentId));
          const snapSt = await getDocs(qSt);
          if (!snapSt.empty) {
            targetStudentId = snapSt.docs[0].id;
            studentRef = doc(db, "students", targetStudentId);
            studentSnap = snapSt.docs[0];
          }
        }
        if (!studentSnap.exists()) throw new Error("Student record not found in database.");

        const requested = data.requestedChanges || {};
        const updates = { ...requested, updatedAt: serverTimestamp() };
        if (requested.photo) {
          updates.profilePhotoUrl = requested.photo;
          updates.photoUrl = requested.photo;
          updates.photo = requested.photo;
        }
        await updateDoc(studentRef, updates);

        // Also update canonical store in studentDocuments if photo or documents were changed
        const docUpdates = {};
        if (requested.photo) docUpdates.photo = requested.photo;
        if (requested.aadhaarFront) docUpdates.aadhaarFront = requested.aadhaarFront;
        if (requested.aadhaarBack) docUpdates.aadhaarBack = requested.aadhaarBack;
        if (Object.keys(docUpdates).length > 0) {
          const { setDoc } = await import("firebase/firestore");
          await setDoc(doc(db, "studentDocuments", data.studentId), {
            ...docUpdates,
            updatedAt: new Date().toISOString()
          }, { merge: true });
        }

        const adminName = localStorage.getItem("userName") || "Admin";
        await updateDoc(reqRef, {
          status: "Approved",
          reviewedAt: serverTimestamp(),
          reviewedBy: adminName
        });

        // Notify student
        try {
          await addDoc(collection(db, "notifications"), {
            studentId: data.studentId,
            title: "Profile Update Approved",
            message: "Your requested profile details / documents have been approved and updated by admin.",
            type: "profile_update",
            read: false,
            createdAt: serverTimestamp()
          });
        } catch (_) {}

        if (window.showToast) window.showToast("Profile update request approved!", "success");
      } catch (error) {
        console.error("approveProfileUpdateRequest error:", error);
        if (window.showToast) window.showToast("Failed to approve: " + error.message, "error");
      }
    };

    window.rejectProfileUpdateRequest = async (requestId) => {
      try {
        const reqRef = doc(db, "profileUpdateRequests", requestId);
        const snap = await getDoc(reqRef);
        if (!snap.exists()) throw new Error("Request not found.");
        const data = snap.data();
        if (data.status !== "Pending") throw new Error(`Request is already ${data.status}.`);

        const adminName = localStorage.getItem("userName") || "Admin";
        await updateDoc(reqRef, {
          status: "Rejected",
          reviewedAt: serverTimestamp(),
          reviewedBy: adminName
        });

        // Notify student
        try {
          await addDoc(collection(db, "notifications"), {
            studentId: data.studentId,
            title: "Profile Update Rejected",
            message: "Your requested profile update was reviewed and rejected by admin.",
            type: "profile_update",
            read: false,
            createdAt: serverTimestamp()
          });
        } catch (_) {}

        if (window.showToast) window.showToast("Profile update request rejected.", "info");
      } catch (error) {
        console.error("rejectProfileUpdateRequest error:", error);
        if (window.showToast) window.showToast("Failed to reject: " + error.message, "error");
      }
    };

    const listenToPendingProfileUpdates = (callback) => {
      const q = query(
        collection(db, "profileUpdateRequests"),
        where("status", "==", "Pending")
      );
      return onSnapshot(q, (snap) => {
        const list = [];
        snap.forEach(d => list.push({ id: d.id, ...d.data() }));
        list.sort((a, b) => {
          const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt || 0);
          const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt || 0);
          return tb - ta;
        });
        callback(list);
      }, (err) => {
        console.warn("listenToPendingProfileUpdates error:", err);
        callback([]);
      });
    };

    const paintProfileUpdateRequests = (requests) => {
      const tbody = document.getElementById("pending-profile-updates-body");
      const badge = document.getElementById("badge-pending-profile-updates");
      if (badge) {
        if (requests.length > 0) {
          badge.textContent = `${requests.length} Pending`;
          badge.style.display = "inline-block";
        } else {
          badge.style.display = "none";
        }
      }
      if (!tbody) return;
      if (!requests || requests.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:2rem; color:var(--text-muted);">No pending profile update requests.</td></tr>';
        return;
      }
      tbody.innerHTML = requests.map(req => {
        const changes = req.requestedChanges || {};
        const old = req.oldData || {};
        const changesHtml = Object.keys(changes).map(field => {
          const oldVal = old[field] || "—";
          const newVal = changes[field] || "—";
          const label = field.charAt(0).toUpperCase() + field.slice(1);

          if (typeof newVal === "string" && (newVal.startsWith("data:image/") || newVal.startsWith("http://") || newVal.startsWith("https://"))) {
            return `<div style="font-size:12px; margin-bottom:4px; display:flex; align-items:center; gap:8px;">
              <span style="font-weight:600; color:var(--text-secondary);">${label}:</span>
              ${typeof oldVal === "string" && (oldVal.startsWith("data:") || oldVal.startsWith("http")) ? `<img src="${oldVal}" style="width:34px; height:34px; border-radius:4px; object-fit:cover; border:1px solid var(--border);" />` : ''}
              <span>→</span>
              <img src="${newVal}" style="width:40px; height:40px; border-radius:6px; object-fit:cover; border:2px solid var(--accent-emerald, #10b981); cursor:pointer;" onclick="window.enlargeDocument ? window.enlargeDocument('${newVal}', 'New ${label}') : window.open('${newVal}')" title="Click to enlarge" />
            </div>`;
          }

          return `<div style="font-size:12px; margin-bottom:3px;">
            <span style="font-weight:600; color:var(--text-secondary);">${label}:</span>
            <span style="color:var(--text-muted); text-decoration:line-through; margin-right:4px;">${escHtml(String(oldVal))}</span>
            <span style="color:var(--accent-emerald, #10b981); font-weight:700;">→ ${escHtml(String(newVal))}</span>
          </div>`;
        }).join("");

        const d = req.createdAt?.toMillis
          ? new Date(req.createdAt.toMillis()).toLocaleString()
          : "Just now";

        return `
          <tr>
            <td style="vertical-align: middle;">
              <div style="font-weight:700; color:var(--text-primary); font-size:13.5px;">${escHtml(req.studentName || "Student")}</div>
              <div style="font-size:11.5px; color:var(--text-muted);">${escHtml(req.studentPhone || "")}</div>
              <div style="font-size:11px; color:var(--text-muted); font-variant-numeric:tabular-nums;">${escHtml(req.studentId || "")}</div>
            </td>
            <td style="vertical-align: middle;">${changesHtml || "<span style='color:var(--text-muted);'>No changes</span>"}</td>
            <td style="vertical-align: middle; white-space:nowrap; font-size:12px; color:var(--text-muted);">${d}</td>
            <td style="vertical-align: middle; text-align:right; white-space:nowrap;">
              <button class="btn btn-primary" onclick="window.approveProfileUpdateRequest('${req.id}')" style="padding:6px 12px; font-size:12px; margin-right:6px;">Approve</button>
              <button class="btn btn-ghost" onclick="window.rejectProfileUpdateRequest('${req.id}')" style="padding:6px 10px; font-size:12px; color:var(--danger);">Reject</button>
            </td>
          </tr>
        `;
      }).join("");
    };

    // Tab pills are class-driven (see .adm-tab): clear the hardcoded inline
    // look the HTML ships with so a tab switch can never clobber the badge.
    ["tab-new-admission", "tab-pending-approval"].forEach((id, i) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.add("adm-tab");
      el.classList.toggle("is-active", i === 0);
      // Wipe every inline look the HTML ships with — including the old
      // `display` hack. .adm-tab now owns the display, so NOTHING on these
      // two buttons is written per-tab; a switch can only toggle classes and
      // can never bury the badge count again (owner item 4).
      el.style.cssText = "";
    });

    // Listen to queue (new-arrival toast + beep live in adminNotificationUI —
    // single alert path, no duplicate toasts).
    listenToPendingAdmissions((records) => {
      // Badge FIRST, and unconditionally. It must never depend on the pending
      // table being present in the DOM — that coupling is exactly how the
      // count used to freeze.
      lastPendingRecords = Array.isArray(records) ? records : [];
      paintPendingTabBadge(lastPendingRecords);

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

      const tbody = document.getElementById("pending-admissions-body");
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
        const seatFloor = r.seatFloor || r.floor || "Ground Floor";
        const seatInfo = (seatValue && seatValue !== "undefined")
          ? `<div style="font-size:11px; color:var(--primary); font-weight:600; margin-top:4px;">Seat: ${escHtml(seatValue)} (${escHtml(seatFloor)})</div>`
          : "";

        // Source tag removed on request — no chip, no pill, nothing here.

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
            <td style="vertical-align: middle;">
              <div style="font-weight:700; color:var(--text-primary); font-size:13.5px; line-height:1.3; overflow-wrap:anywhere;">${escHtml(r.name)}</div>
              <div style="font-size:11.5px; color:var(--text-muted); margin-top:2px; overflow-wrap:anywhere;">${escHtml(r.email || "—")}</div>
              <div style="font-size:11px; color:var(--text-muted); margin-top:3px; font-variant-numeric:tabular-nums;">${escHtml(r.studentId || r.admissionNo || r.id)}</div>
            </td>
            <td style="vertical-align: middle;">
              <div style="font-weight:600; color:var(--text-primary); font-size:13.5px; font-variant-numeric:tabular-nums;">${escHtml(r.phone)}</div>
              ${paymentLine}
            </td>
            <td style="vertical-align: middle;">${escHtml(r.planName || "")}${seatInfo}</td>
            <td style="vertical-align: middle; white-space: nowrap;">${d}</td>
            <td style="vertical-align: middle; text-align:right; min-width: 300px;">
              <div class="approval-actions">
                <button class="btn btn-approve" title="Approve this applicant and activate them" onclick="window.approveStudent('${r.id}')">Approve</button>
                <button class="btn btn-reject" title="Reject this applicant — their record and documents are removed" onclick="window.rejectStudent('${r.id}')">Reject</button>
                <button class="btn btn-info" title="Everything about this applicant, plus their uploaded documents" onclick="window.viewApplicantDetails('${r.id}')">Details</button>
                <button class="btn btn-dismiss" title="Take it out of the queue without deciding — nothing is deleted" onclick="window.dismissStudent('${r.id}')">Dismiss</button>
              </div>
            </td>
          </tr>
        `;
      });
      tbody.innerHTML = html;
    });

    // Profile update requests listener & renderer (Task 5)
    listenToPendingProfileUpdates((profileRequests) => {
      paintProfileUpdateRequests(profileRequests);
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

  // Populate seats dropdown — plain numbers only ("20", never "A20").
  // Value = seat doc id (ground-20 / first-20) so duplicate numbers across
  // floors stay unambiguous; label = plain number, grouped by floor.
  const seatSelect = document.getElementById("adm-seat");
  if (seatSelect) {
    seatSelect.innerHTML = "<option value=''>Loading...</option>";
    try {
      const q = query(collection(db, "seats"), where("status", "==", "Available"));
      const snap = await getDocs(q);
      const stripToPlain = (v) => {
        const raw = String(v == null ? "" : v).trim().toUpperCase().replace(/\s+/g, "");
        const m = raw.match(/^[AB]?0*(\d+)[AB]?$/);
        return m ? String(Number(m[1])) : "";
      };
      const byFloor = { "Ground Floor": [], "First Floor": [] };
      snap.forEach(d => {
        const s = d.data() || {};
        const plain = stripToPlain(s.seatNumber);
        if (!plain) return;
        const floor = s.floor || "Ground Floor";
        const maxN = floor === "First Floor" ? 40 : 68;
        const n = Number(plain);
        if (!(n >= 1 && n <= maxN)) return;
        if (!byFloor[floor]) byFloor[floor] = [];
        byFloor[floor].push({ id: d.id, num: plain });
      });
      const sortNum = (a, b) => Number(a.num) - Number(b.num);
      Object.values(byFloor).forEach(arr => {
        const seen = new Set();
        arr.sort(sortNum);
        for (let i = arr.length - 1; i >= 0; i--) {
          if (seen.has(arr[i].num)) arr.splice(i, 1);
          else seen.add(arr[i].num);
        }
      });
      const total = (byFloor["Ground Floor"] || []).length + (byFloor["First Floor"] || []).length;
      let html = `<option value=''>${total} available</option>`;
      for (const floor of ["Ground Floor", "First Floor"]) {
        const arr = byFloor[floor] || [];
        if (!arr.length) continue;
        html += `<optgroup label="${floor} — ${arr.length} free">`;
        arr.forEach(({ id, num }) => {
          html += `<option value="${id}">${floor} · Seat ${num}</option>`;
        });
        html += `</optgroup>`;
      }
      seatSelect.innerHTML = html;
    } catch (e) {
      seatSelect.innerHTML = "<option value=''>Failed to load seats</option>";
    }
  }

  // Tab switcher logic
  // Class-driven ONLY. The previous version wrote background/color/border
  // straight onto the buttons as inline styles, which silently clobbered the
  // pending-count badge every time the operator flipped tabs.
  window.switchAdmissionTab = (tab) => {
    const isNew = tab === 'new';

    document.getElementById("view-new-admission").style.display = isNew ? "flex" : "none";
    document.getElementById("view-pending-approval").style.display = isNew ? "none" : "block";

    const newBtn = document.getElementById("tab-new-admission");
    const pendBtn = document.getElementById("tab-pending-approval");
    if (newBtn) newBtn.classList.toggle("is-active", isNew);
    if (pendBtn) pendBtn.classList.toggle("is-active", !isNew);

    // Visit-to-clear: opening the Pending approval tab means the operator
    // has seen the queue — badge drops immediately, no buttons. Anything
    // arriving afterwards lights it again.
    if (!isNew) {
      markPendingSeen(lastPendingRecords);
      paintPendingTabBadge(lastPendingRecords);
    }
  };

  // ── Admission Duration & Dates Logic ─────────────────────────────
  window.__admDurationMode = "month"; // "month", "days", "custom"

  const getTodayStr = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  const addDaysToDateStr = (dateStr, days) => {
    if (!dateStr) return "";
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + Number(days));
    const ry = date.getFullYear();
    const rm = String(date.getMonth() + 1).padStart(2, "0");
    const rd = String(date.getDate()).padStart(2, "0");
    return `${ry}-${rm}-${rd}`;
  };

  window.setAdmissionDurationMode = (mode) => {
    window.__admDurationMode = mode || "month";
    const modeInput = document.getElementById("adm-duration-mode");
    if (modeInput) modeInput.value = window.__admDurationMode;

    const monthPill = document.getElementById("adm-duration-pill-month");
    const daysPill = document.getElementById("adm-duration-pill-days");
    const customPill = document.getElementById("adm-duration-pill-custom");
    if (monthPill) monthPill.classList.toggle("active", window.__admDurationMode === "month");
    if (daysPill) daysPill.classList.toggle("active", window.__admDurationMode === "days");
    if (customPill) customPill.classList.toggle("active", window.__admDurationMode === "custom");

    const monthWrap = document.getElementById("adm-duration-month-wrap");
    const daysWrap = document.getElementById("adm-duration-days-wrap");
    if (monthWrap) monthWrap.style.display = window.__admDurationMode === "month" ? "block" : "none";
    if (daysWrap) daysWrap.style.display = window.__admDurationMode === "days" ? "block" : "none";

    const endEl = document.getElementById("adm-end-date");
    if (endEl) {
      if (window.__admDurationMode === "custom") {
        endEl.removeAttribute("readonly");
        endEl.focus();
      } else {
        endEl.setAttribute("readonly", "true");
      }
    }

    window.recomputeAdmissionEndDate();
  };

  window.onStartDateChange = () => {
    window.recomputeAdmissionEndDate();
  };

  window.onDurationMonthChange = () => {
    window.recomputeAdmissionEndDate();
  };

  window.onDurationDaysChange = () => {
    window.recomputeAdmissionEndDate();
  };

  window.onEndDateChange = () => {
    const startEl = document.getElementById("adm-start-date");
    const endEl = document.getElementById("adm-end-date");
    if (startEl && endEl && startEl.value && endEl.value) {
      if (endEl.value < startEl.value) {
        if (typeof window.showToast === "function") {
          window.showToast("End date cannot be earlier than start date", "warning");
        }
        endEl.value = startEl.value;
      }
    }
    window.updateSummary();
  };

  window.recomputeAdmissionEndDate = () => {
    const startEl = document.getElementById("adm-start-date");
    const endEl = document.getElementById("adm-end-date");
    if (!startEl || !endEl) return;
    if (!startEl.value) {
      startEl.value = getTodayStr();
    }
    const mode = window.__admDurationMode || document.getElementById("adm-duration-mode")?.value || "month";

    if (mode === "month") {
      const months = Number(document.getElementById("adm-duration-months")?.value || 1);
      const totalDays = months * 30; // 30-day month
      endEl.value = addDaysToDateStr(startEl.value, totalDays);
    } else if (mode === "days") {
      const days = Number(document.getElementById("adm-duration-days")?.value || 30);
      endEl.value = addDaysToDateStr(startEl.value, days);
    } else if (mode === "custom") {
      if (!endEl.value) {
        endEl.value = addDaysToDateStr(startEl.value, 30);
      }
    }
    window.updateSummary();
  };

  window.updateSummary = () => {
    const planId = document.getElementById("adm-plan")?.value;
    const plan = availablePlansList.find(p => p.id === planId);
    
    const planEl = document.getElementById("summary-plan");
    const amtEl = document.getElementById("summary-amount");
    if (plan) {
      if (planEl) planEl.innerText = plan.planName;
      if (amtEl) amtEl.innerText = `₹${plan.price}`;
    } else {
      if (planEl) planEl.innerText = "—";
      if (amtEl) amtEl.innerText = "—";
    }

    const startVal = document.getElementById("adm-start-date")?.value;
    const endVal = document.getElementById("adm-end-date")?.value;
    const mode = window.__admDurationMode || document.getElementById("adm-duration-mode")?.value || "month";

    const startSummaryEl = document.getElementById("summary-start");
    const endsSummaryEl = document.getElementById("summary-ends");
    const durSummaryEl = document.getElementById("summary-duration");

    if (startVal) {
      const parts = startVal.split("-");
      if (parts.length === 3 && startSummaryEl) {
        startSummaryEl.innerText = `${parts[2]}/${parts[1]}/${parts[0]}`;
      }
    } else if (startSummaryEl) {
      startSummaryEl.innerText = "—";
    }

    if (endVal) {
      const parts = endVal.split("-");
      if (parts.length === 3 && endsSummaryEl) {
        endsSummaryEl.innerText = `${parts[2]}/${parts[1]}/${parts[0]}`;
      }
    } else if (endsSummaryEl) {
      endsSummaryEl.innerText = "—";
    }

    if (durSummaryEl) {
      if (startVal && endVal) {
        const d1 = new Date(startVal);
        const d2 = new Date(endVal);
        const diffTime = d2.getTime() - d1.getTime();
        const diffDays = Math.max(0, Math.round(diffTime / (1000 * 60 * 60 * 24)));
        if (mode === "month") {
          const months = Number(document.getElementById("adm-duration-months")?.value || 1);
          durSummaryEl.innerText = `${months} Month (${diffDays} days)`;
        } else if (mode === "days") {
          durSummaryEl.innerText = `${diffDays} Days`;
        } else {
          durSummaryEl.innerText = `${diffDays} Days (Custom)`;
        }
      } else {
        durSummaryEl.innerText = "—";
      }
    }
  };

  window.resetAdmission = () => {
    const form = document.getElementById("admission-form");
    if (form) form.reset();
    const startEl = document.getElementById("adm-start-date");
    if (startEl) startEl.value = getTodayStr();
    window.setAdmissionDurationMode("month");
    window.recomputeAdmissionEndDate();
    window.updateSummary();
  };

  window.submitAdmissionForm = async (overridePaymentMethod = null, txnId = null, dueDate = null) => {
    const formPaymentEl = document.getElementById("adm-payment-method");
    const chosenFormMethod = formPaymentEl?.value || "";

    // If operator chose Cash directly in the dropdown on the form
    let effectiveOverride = overridePaymentMethod;
    if (!effectiveOverride && chosenFormMethod) {
      if (chosenFormMethod === "Paid (Cash)" || chosenFormMethod === "Cash") {
        effectiveOverride = "Paid (Cash)";
      } else if (chosenFormMethod === "Pay Later") {
        const d = new Date();
        d.setDate(d.getDate() + 3);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const dt = String(d.getDate()).padStart(2, "0");
        dueDate = dueDate || `${y}-${m}-${dt}`;
        effectiveOverride = "Pay Later";
      }
    }

    // If Admin/Manager and no payment method chosen yet, show popup
    if (isAdminOrManager && !effectiveOverride) {
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
          window.submitAdmissionForm('Paid (Cash)', null, null);
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
        window.submitAdmissionForm(method === 'Paid (UPI)' ? 'Paid (UPI)' : 'Pay Later', tId, dDate);
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
              <button type="button" class="btn btn-primary" onclick="window.processAdminPayment('Paid (Cash)')" style="width: 100%; padding: 12px; font-size: 15px; background: #16a34a; border: none;">Paid via Cash</button>
              <button type="button" class="btn btn-primary" onclick="window.processAdminPayment('Paid (UPI)')" style="width: 100%; padding: 12px; font-size: 15px;">Paid via UPI</button>
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
      const selectedSeatId = seatEl?.value || "";

      let selectedSeat = null;
      let selectedSeatNumber = "";
      let selectedSeatFloor = "";
      if (selectedSeatId) {
        // Dropdown value is the seat doc id (ground-20 / first-20, legacy A20
        // ids still resolve via direct read for backward compatibility).
        const { doc: fsDoc, getDoc: fsGet } = await import("firebase/firestore");
        try {
          const direct = await fsGet(fsDoc(db, "seats", selectedSeatId));
          if (direct.exists() && (direct.data() || {}).status === "Available") {
            selectedSeat = direct;
          }
        } catch (_) { /* fall through to query scan */ }
        if (!selectedSeat) {
          const availableSeats = await getDocs(query(collection(db, "seats"), where("status", "==", "Available")));
          selectedSeat = availableSeats.docs.find(seatDoc => seatDoc.id === selectedSeatId) || null;
        }
        if (!selectedSeat) {
          throw new Error("That seat is no longer available. Please choose another seat.");
        }
        const sd = selectedSeat.data() || {};
        const raw = String(sd.seatNumber || "").trim().toUpperCase().replace(/\s+/g, "");
        const m = raw.match(/^[AB]?0*(\d+)[AB]?$/);
        selectedSeatNumber = m ? String(Number(m[1])) : String(sd.seatNumber || "");
        selectedSeatFloor = sd.floor || "Ground Floor";
      }

      const startDateVal = document.getElementById("adm-start-date")?.value || getTodayStr();
      const endDateVal = document.getElementById("adm-end-date")?.value || "";
      const durationModeVal = window.__admDurationMode || document.getElementById("adm-duration-mode")?.value || "month";
      let calcDurationDays = 30;
      if (startDateVal && endDateVal) {
        const d1 = new Date(startDateVal);
        const d2 = new Date(endDateVal);
        calcDurationDays = Math.max(0, Math.round((d2 - d1) / (1000 * 60 * 60 * 24)));
      }

      let finalPaymentMethod = "Pending";
      if (isAdminOrManager) {
        if (effectiveOverride === "Paid (Cash)" || effectiveOverride === "Cash") {
          finalPaymentMethod = "Paid (Cash)";
        } else if (effectiveOverride === "Paid (UPI)" || effectiveOverride === "Paid") {
          finalPaymentMethod = "Paid (UPI)";
        } else if (effectiveOverride === "Pay Later") {
          finalPaymentMethod = "Pay Later";
        } else {
          finalPaymentMethod = effectiveOverride || "Admin Created";
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
        startDate: startDateVal,
        endDate: endDateVal,
        duration: calcDurationDays,
        durationMode: durationModeVal,
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
        seatFloor: selectedSeatFloor,
        seatId: selectedSeatId || "",
        paymentMethod: finalPaymentMethod,
        termsAccepted: true
      };

      if (txnId) data.transactionId = txnId;
      if (dueDate) data.paymentDueDate = dueDate;
      else if (endDateVal) data.paymentDueDate = endDateVal;

      const res = await submitAdmission(data, isStudent);
      if (res.success) {
        if (isStudent) {
            if (data.paymentMethod === "Paid" || data.paymentMethod === "Paid (Cash)" || data.paymentMethod === "Paid (UPI)") {
                window.showToast("Payment verified! You are now admitted and will be redirected to your dashboard.", "success");
            } else {
                window.showToast("Admission request submitted and is Pending Approval!", "success");
            }
        } else {
            if (selectedSeat) {
              // Assignment = Reserved ("Preferred"); Occupied happens on check-in.
              await updateDoc(doc(db, "seats", selectedSeat.id), {
                status: "Reserved",
                assignedStudentId: res.studentId,
                assignedStudentName: data.name,
                planType: data.planName,
                lastUpdated: serverTimestamp()
              });
            }

            // Create cash / UPI payment record in payments collection if paid
            if (finalPaymentMethod === "Paid (Cash)" || finalPaymentMethod === "Cash" || finalPaymentMethod === "Paid (UPI)" || finalPaymentMethod === "Paid") {
              try {
                const isCash = finalPaymentMethod === "Paid (Cash)" || finalPaymentMethod === "Cash";
                const payDoc = {
                  studentId: res.studentId || "",
                  studentName: data.name,
                  planName: data.planName,
                  amount: Number(plan?.price || 0),
                  paymentMethod: isCash ? "Cash" : "UPI",
                  transactionId: isCash ? "CASH" : (txnId || "UPI"),
                  status: "approved",
                  date: new Date().toISOString(),
                  createdAt: serverTimestamp(),
                  approvedBy: role || "Admin",
                  approvalDate: serverTimestamp()
                };
                if (data.paymentScreenshotUrl) {
                  payDoc.screenshot = data.paymentScreenshotUrl;
                  payDoc.paymentScreenshotUrl = data.paymentScreenshotUrl;
                  payDoc.screenshots = [data.paymentScreenshotUrl];
                }
                try {
                  const { getNextReceiptNumber } = await import("./receiptService.js");
                  const rNo = await getNextReceiptNumber();
                  payDoc.receiptNo = rNo;
                  payDoc.invoiceNo = rNo;
                } catch (_) {}
await addDoc(collection(db, "payments"), payDoc);

                // Also record in renewals collection so renewal history is synchronized
                try {
                  const renDoc = {
                    studentId: res.studentId || "",
                    studentName: data.name,
                    oldPlan: "",
                    newPlan: data.planName || "",
                    startDate: data.startDate || new Date().toISOString().split("T")[0],
                    endDate: data.endDate || "",
                    durationDays: Number(data.duration || 30),
                    durationMode: data.durationMode || "monthly",
                    amount: Number(plan?.price || 0),
                    paymentMethod: isCash ? "Cash" : "UPI",
                    transactionId: isCash ? "CASH" : (txnId || "UPI"),
                    renewedBy: role || "Admin",
                    renewalNotes: "Initial admission payment",
                    status: "Completed",
                    type: "Initial Admission",
                    createdAt: serverTimestamp()
                  };
                  if (data.paymentScreenshotUrl) {
                    renDoc.screenshot = data.paymentScreenshotUrl;
                    renDoc.paymentScreenshotUrl = data.paymentScreenshotUrl;
                    renDoc.screenshots = [data.paymentScreenshotUrl];
                  }
                  await addDoc(collection(db, "renewals"), renDoc);
                } catch (renErr) {
                  console.warn("[admission] Could not record initial renewal in renewals collection:", renErr);
                }
              } catch (payErr) {
                console.warn("[admission] Could not record direct payment in payments collection:", payErr);
              }
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

  // Auto-init admission dates and mode
  try {
    const startEl = document.getElementById("adm-start-date");
    if (startEl && !startEl.value) {
      startEl.value = getTodayStr();
    }
    if (typeof window.setAdmissionDurationMode === "function") {
      window.setAdmissionDurationMode("month");
    }
  } catch (_) {}
};
