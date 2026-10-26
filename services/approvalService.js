import { doc, getDoc, deleteDoc, setDoc, updateDoc, collection, query, where, getDocs, runTransaction, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase/firebase.js";

// ──────────────────────────────────────────────────────────────────────────
// Shared helpers
// ──────────────────────────────────────────────────────────────────────────

/**
 * Locate a seat by its number (plain "20", legacy "A20" also accepted).
 * New deterministic ids are floor-aware ("ground-20"/"first-20"); legacy
 * "A20"-style ids still resolve via direct read for backward compatibility.
 * Optional floorHint disambiguates duplicate numbers across floors.
 * @returns {{ref: any, data: Object}|null}
 */
const stripSeatPlain = (v) => {
  const raw = String(v == null ? "" : v).trim().toUpperCase().replace(/\s+/g, "");
  const m = raw.match(/^[AB]?0*(\d+)[AB]?$/);
  if (m) return String(Number(m[1]));
  return String(v);
};
const findSeat = async (seatNumber, floorHint = "") => {
  const plain = stripSeatPlain(seatNumber);
  // Try deterministic + legacy direct ids first.
  const candidates = [String(seatNumber)];
  if (floorHint) {
    candidates.unshift(floorHint === "First Floor" ? `first-${plain}` : `ground-${plain}`);
  } else {
    candidates.push(`ground-${plain}`, `first-${plain}`);
  }
  for (const id of candidates) {
    try {
      const ref = doc(db, "seats", id);
      const snap = await getDoc(ref);
      if (snap.exists()) return { ref, data: snap.data() };
    } catch (_) { /* try next */ }
  }
  try {
    const q = query(collection(db, "seats"), where("seatNumber", "==", plain));
    const snap = await getDocs(q);
    if (snap.empty) {
      // Legacy docs may still carry "A20" — try the raw value too.
      if (String(seatNumber) !== plain) {
        const q2 = query(collection(db, "seats"), where("seatNumber", "==", String(seatNumber)));
        const s2 = await getDocs(q2);
        if (!s2.empty) {
          const pick = floorHint
            ? (s2.docs.find(d => ((d.data() || {}).floor || "") === floorHint) || s2.docs[0])
            : s2.docs[0];
          return { ref: pick.ref, data: pick.data() };
        }
      }
      return null;
    }
    const pick = floorHint
      ? (snap.docs.find(d => ((d.data() || {}).floor || "Ground Floor") === floorHint) || snap.docs[0])
      : snap.docs[0];
    return { ref: pick.ref, data: pick.data() };
  } catch (_) { /* no seat doc — nothing to resolve */ }
  return null;
};

/**
 * Whether this record may occupy a seat at all: only plans with
 * `seatPreference === true` (fixed / seat-preferred plans) hand out seats.
 * When the plan can't be read the guard fails OPEN, exactly as before.
 * @returns {Promise<{number: string, allowed: boolean}>}
 */
const resolveSeat = async (data) => {
  let seatNumber = String(data.seatAssigned || data.seatNumber || "").trim();
  if (!seatNumber || seatNumber === "undefined") return { number: "", floor: "", allowed: false };

  if (data.planId) {
    try {
      const { planAllowsSeatSelection } = await import("./planValidation.js");
      const allowed = await planAllowsSeatSelection(data.planId);
      if (!allowed) return { number: "", floor: "", allowed: false };
    } catch (_) { /* fail open only when the plan can't be read */ }
  }
  seatNumber = stripSeatPlain(seatNumber);
  const floor = data.seatFloor || data.seatfloor || "";
  return { number: seatNumber, floor, allowed: true };
};

/**
 * Allocate a sequential SH-xxxx number when the record hasn't got one yet.
 * (Never runs inside a Firestore transaction — it uses its own.)
 */
const assignAdmissionNumber = async (data) => {
  let allocated = false;
  if (!data.studentId || String(data.studentId).trim() === "") {
    try {
      const { ensureStudentId } = await import("./studentIdService.js");
      const tmp = { ...data };
      await ensureStudentId(tmp);
      data.studentId = tmp.studentId;
      data.admissionNo = tmp.admissionNo || tmp.studentId;
      allocated = true;
    } catch (e) {
      console.warn("Could not assign admission number:", e?.message || e);
    }
  }
  if (!data.admissionNo) {
    data.admissionNo = data.studentId || "";
    allocated = true;
  }
  return allocated;
};

/**
 * Final duplicate guard (staff can read all collections): the same phone or
 * email must never enter the main students list twice.
 * @returns {string|null} error message when blocked
 */
const duplicateError = async (admissionId, data) => {
  try {
    const phoneQ = query(collection(db, "students"), where("phone", "==", data.phone));
    const phoneSnap = await getDocs(phoneQ);
    if (phoneSnap.docs.some(d => d.id !== admissionId)) {
      return `Phone number ${data.phone} is already registered for another student.`;
    }
    const normEmail = String(data.email || "").trim().toLowerCase();
    if (normEmail) {
      const emailQ = query(collection(db, "students"), where("email", "==", normEmail));
      const emailSnap = await getDocs(emailQ);
      if (emailSnap.docs.some(d => d.id !== admissionId)) {
        return `Email ${data.email} is already registered for another student.`;
      }
    }
  } catch (e) {
    console.warn("Pre-approval duplicate check skipped:", e?.message || e);
  }
  return null;
};

/** Best-effort: flip users/{uid} to the new lifecycle status. */
const syncUserStatus = async (id, status) => {
  try {
    await updateDoc(doc(db, "users", id), { status: status });
  } catch (e) {
    console.warn("Could not update users document (it may not exist if created via manual admin admission):", e);
  }
};

/** In-app notification + approval email (both best-effort). */
const announceDecision = async (id, data, decision, extra = {}) => {
  // Rejections deliberately skip the in-app notification: the record is about
  // to be purged, so an alert pointing at it would be a dead link the moment
  // it landed. The applicant still gets the email below.
  if (!extra.skipNotify) {
    try {
      const { notifyAdmins } = await import("./notificationService.js");
      await notifyAdmins({
        type: decision === "Approved" ? "admission-approved" : "admission-rejected",
        title: decision === "Approved" ? "Admission approved" : "Admission rejected",
        body: `${data.name || "A student"}${data.phone ? ` (${data.phone})` : ""} — ${decision}${extra.reason ? ` · ${extra.reason}` : ""}.`,
        admissionId: id,
        studentId: id,
      });
    } catch (_) { /* notifications are best-effort */ }
  }

  try {
    const { sendAdmissionApprovedMail, sendAdmissionRejectedMail } = await import("./emailService.js");
    if (decision === "Approved") {
      sendAdmissionApprovedMail({ id, ...data }).catch(() => {});
    } else {
      sendAdmissionRejectedMail({ id, ...data }, extra.reason || "").catch(() => {});
    }
  } catch (_) { /* email is best-effort — approval already succeeded */ }
};

// ──────────────────────────────────────────────────────────────────────────
// Approve
// ──────────────────────────────────────────────────────────────────────────

/**
 * Approve a pending admission.
 *
 * `id` is normally a **students** doc id (students is the single source of
 * truth: pending applications are students docs with
 * approvalStatus === "Pending"). In that case NOTHING is created and
 * NOTHING is deleted — the same document is updated inside one
 * `runTransaction` that also occupies the chosen seat (when the plan allows
 * seat selection).
 *
 * When `students/{id}` does not exist we fall back to the legacy
 * `admissions/{id}` record (the 11 retired history docs) and keep the old
 * move-into-students behaviour intact.
 */
export const approveAdmission = async (admissionId) => {
  try {
    const studentRef = doc(db, "students", admissionId);
    const studentSnap = await getDoc(studentRef);

    if (studentSnap.exists()) {
      return await approveStudentsDoc(admissionId, studentRef, studentSnap.data() || {});
    }
    return await approveLegacyAdmission(admissionId);
  } catch (error) {
    return { success: false, error: error.message };
  }
};

/** Normal case: the record already lives in `students`. */
const approveStudentsDoc = async (id, studentRef, existing) => {
  const data = { ...existing };

  // Admission number for records written before the counters existed.
  const allocatedNumber = await assignAdmissionNumber(data);

  const dupError = await duplicateError(id, data);
  if (dupError) return { success: false, error: dupError };

  // Seat Preference guard: a plan without seat selection keeps the
  // approval seat-free even if a seat number arrived with the request.
  const seat = await resolveSeat(data);

  const payload = {
    approvalStatus: "Approved",
    status: "Active",
    applicationReady: true,
    updatedAt: serverTimestamp(),
  };
  if (allocatedNumber) {
    payload.studentId = data.studentId || "";
    payload.admissionNo = data.admissionNo || data.studentId || "";
  }
  const todayStr = new Date().toISOString().split("T")[0];
  const appDate = data.submittedAt?.toDate ? data.submittedAt.toDate().toISOString().split("T")[0] : (data.createdAt?.toDate ? data.createdAt.toDate().toISOString().split("T")[0] : todayStr);

  let effectiveStartDate = data.startDate || todayStr;
  // If startDate on this new approval is older than the application submission date, normalize to application date
  if (effectiveStartDate < appDate) {
    effectiveStartDate = appDate;
  }
  payload.startDate = effectiveStartDate;

  // Permanent joinedDate for anniversaries / original admission reference
  payload.joinedDate = data.joinedDate || data.joiningDate || data.admissionDate || effectiveStartDate;

  // Real subscription end date calculation (never truncated by Pay Later due date)
  const calcSubEndDate = () => {
    const sDate = new Date(`${effectiveStartDate}T00:00:00`);
    let eDate = data.plannedExitDate || data.endDate;
    const pDue = data.paymentDueDate;

    // If eDate is older than effectiveStartDate, it cannot be genuine for this new admission
    if (eDate && eDate < effectiveStartDate) {
      eDate = null;
    }

    if (eDate) {
      const d1 = sDate.getTime();
      const d2 = new Date(`${eDate}T00:00:00`).getTime();
      const diff = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
      if (diff >= 14) return eDate;
      if (eDate === pDue || data.paymentMethod === "Pay Later" || diff <= 7) {
        const corr = new Date(sDate);
        corr.setMonth(corr.getMonth() + 1);
        return corr.toISOString().split("T")[0];
      }
      return eDate;
    }
    const corr = new Date(sDate);
    corr.setMonth(corr.getMonth() + 1);
    return corr.toISOString().split("T")[0];
  };

  payload.endDate = calcSubEndDate();

  // Payment due date remains the agreed pay-by date for Pay Later, or falls back to endDate
  payload.paymentDueDate = (data.paymentMethod === "Pay Later" && data.paymentDueDate) ? data.paymentDueDate : (data.paymentDueDate || payload.endDate);

  // One transaction: the student flips to Active and the seat becomes
  // Occupied together — never one without the other.
  await runTransaction(db, async (tx) => {
    const fresh = await tx.get(studentRef);
    if (!fresh.exists()) throw new Error("Admission record not found.");

    // Resolve the seat doc inside the txn (floor-aware, legacy-safe).
    let seatRef = null;
    if (seat.allowed && seat.number) {
      const found = await findSeat(seat.number, seat.floor);
      if (found) {
        seatRef = found.ref;
        const sd = found.data || {};
        const holder = sd.assignedStudentId || "";
        const taken = sd.status === "Occupied" || sd.status === "Reserved";
        if (taken && holder && holder !== id) {
          throw new Error(`Seat ${seat.number} is already taken (${sd.assignedStudentName || holder}). Re-submit with a different seat.`);
        }
      } else if (seat.floor) {
        seatRef = doc(db, "seats", seat.floor === "First Floor" ? `first-${seat.number}` : `ground-${seat.number}`);
      } else {
        seatRef = doc(db, "seats", `ground-${seat.number}`);
      }
    }

    tx.update(studentRef, payload);

    if (seat.allowed && seat.number && seatRef) {
      // merge:true preserves floor/col/row on the existing seat doc.
      // Assignment marks the seat Reserved ("Preferred"): the student has
      // claimed it, but Occupied is only set when they check in.
      tx.set(seatRef, {
        seatNumber: seat.number,
        ...(seat.floor ? { floor: seat.floor } : {}),
        status: "Reserved",
        assignedStudentId: id,
        assignedStudentName: data.name || "",
        planType: data.planName || "",
        lastUpdated: serverTimestamp(),
      }, { merge: true });
    }
  });

  await syncUserStatus(id, "Active");
  await announceDecision(id, data, "Approved");

  // ── Mirror or approve initial admission payment into renewals & payments ──
  // So Renewal History and Payment History tabs on BOTH Admin Panel and Student
  // Portal show the admission payment + screenshot proof!
  try {
    const payQ = query(
      collection(db, "payments"),
      where("studentId", "==", id)
    );
    const paySnap = await getDocs(payQ);
    let foundOnbPay = false;
    for (const pDoc of paySnap.docs) {
      const pData = pDoc.data() || {};
      if (pData.source === "onboarding" || pData.source === "admission" || pData.status === "pending") {
        foundOnbPay = true;
        const shot = pData.screenshot || pData.paymentScreenshotUrl || (Array.isArray(pData.screenshots) ? pData.screenshots[0] : "") || data.paymentScreenshotUrl || "";
        await updateDoc(pDoc.ref, {
          status: "approved",
          approvedBy: "Admin",
          approvalDate: serverTimestamp(),
          ...(shot ? { screenshot: shot, paymentScreenshotUrl: shot, screenshots: [shot] } : {})
        });
        const rQ = query(collection(db, "renewals"), where("paymentId", "==", pDoc.id));
        const rSnap = await getDocs(rQ);
        if (rSnap.empty) {
          const { addDoc } = await import("firebase/firestore");
          await addDoc(collection(db, "renewals"), {
            studentId: id,
            studentName: data.name || pData.studentName || "",
            oldPlan: "",
            newPlan: data.planName || pData.planName || "",
            startDate: pData.startDate || payload.startDate || data.startDate || "",
            endDate: pData.endDate || payload.endDate || data.endDate || data.paymentDueDate || "",
            amount: Number(pData.amount || data.planPrice || 0),
            paymentMethod: pData.paymentMethod || data.paymentMethod || "Paid",
            transactionId: pData.transactionId || data.transactionId || "",
            screenshot: shot,
            paymentScreenshotUrl: shot,
            screenshots: shot ? [shot] : [],
            paymentId: pDoc.id,
            source: "onboarding",
            renewedBy: "Admin",
            status: "Completed",
            createdAt: serverTimestamp()
          });
        }
      }
    }
    if (!foundOnbPay && (data.paymentMethod === "Paid" || data.paymentMethod === "Paid (UPI)" || data.paymentMethod === "Paid (Cash)" || data.paymentMethod === "UPI" || data.paymentMethod === "Cash" || data.transactionId || data.paymentScreenshotUrl)) {
      const { addDoc } = await import("firebase/firestore");
      const shot = data.paymentScreenshotUrl || data.paymentScreenshot || "";
      const pRef = await addDoc(collection(db, "payments"), {
        studentId: id,
        studentName: data.name || "",
        planId: data.planId || "",
        planName: data.planName || "",
        amount: Number(data.planPrice || data.amount || 0),
        paymentMethod: data.paymentMethod || "Paid",
        transactionId: data.transactionId || "ADMISSION",
        screenshot: shot,
        paymentScreenshotUrl: shot,
        screenshots: shot ? [shot] : [],
        source: "onboarding",
        status: "approved",
        approvedBy: "Admin",
        approvalDate: serverTimestamp(),
        date: new Date().toISOString(),
        createdAt: serverTimestamp()
      });
      await addDoc(collection(db, "renewals"), {
        studentId: id,
        studentName: data.name || "",
        oldPlan: "",
        newPlan: data.planName || "",
        startDate: payload.startDate || data.startDate || "",
        endDate: payload.endDate || data.endDate || "",
        amount: Number(data.planPrice || data.amount || 0),
        paymentMethod: data.paymentMethod || "Paid",
        transactionId: data.transactionId || "",
        screenshot: shot,
        paymentScreenshotUrl: shot,
        screenshots: shot ? [shot] : [],
        paymentId: pRef.id,
        source: "onboarding",
        renewedBy: "Admin",
        status: "Completed",
        createdAt: serverTimestamp()
      });
    }
  } catch (payApproveErr) {
    console.warn("[approval] initial payment mirror skipped:", payApproveErr);
  }

  return { success: true };
};

/** Legacy case: record still lives in the retired `admissions` collection. */
const approveLegacyAdmission = async (admissionId) => {
  const admissionRef = doc(db, "admissions", admissionId);
  const docSnap = await getDoc(admissionRef);

  if (!docSnap.exists()) {
    throw new Error("Admission record not found.");
  }

  const data = docSnap.data();
  data.approvalStatus = "Approved";
  data.status = "Active";
  data.applicationReady = true;
  data.updatedAt = new Date().toISOString();
  // Pending admissions from logged-in portal students are written at
  // admissions/{authUid} — carry the uid onto the student doc so the
  // portal knows a real login account exists. Pure website forms carry NO
  // uid (no account was created), so leave it out: stamping a fake uid
  // would later block the admin from creating the portal login.
  if (data.uid) {
    data.uid = admissionId;
  } else {
    delete data.uid;
  }

  // Every approved student carries a unique sequential admission number.
  await assignAdmissionNumber(data);

  const dupError = await duplicateError(admissionId, data);
  if (dupError) return { success: false, error: dupError };

  // Handle seat assignment if seat was selected.
  // Seat Preference guard: a plan without seat selection keeps the
  // admission seat-free even if a seat number arrived with the request.
  // (Staff run with full read rights here, so this check is authoritative.)
  const seat = await resolveSeat(data);
  if (!seat.allowed) {
    delete data.seatAssigned;
    delete data.seatNumber;
  } else {
    const seatDoc = await findSeat(seat.number);
    // Check if seat is available or reserved for this student
    if (seatDoc && (seatDoc.data.status === "Available" ||
        (seatDoc.data.status === "Reserved" && seatDoc.data.assignedStudentId === admissionId))) {
      await updateDoc(seatDoc.ref, {
        status: "Reserved",
        assignedStudentId: admissionId,
        assignedStudentName: data.name,
        planType: data.planName,
        lastUpdated: new Date().toISOString()
      });
      data.seatNumber = seat.number;
    }
  }

  // Create in students collection
  const studentRef = doc(db, "students", admissionId);
  await setDoc(studentRef, data, { merge: true });

  // Update the corresponding user document to Active
  await syncUserStatus(admissionId, "Active");

  // Remove from admissions collection (legacy move — unchanged behaviour)
  await deleteDoc(admissionRef);

  // Inform the student by email (best-effort — approval already succeeded).
  await announceDecision(admissionId, data, "Approved");

  return { success: true };
};

// ──────────────────────────────────────────────────────────────────────────
// Reject
// ──────────────────────────────────────────────────────────────────────────

/**
 * Reject an admission (students doc OR legacy admissions doc).
 *
 * Owner request: "rejected — complete delete every single data attached to
 * that student." So this no longer just flips a flag. The order matters:
 *
 *   1. release the seat that was Reserved for this applicant,
 *   2. write the decision (the queue empties at once and the local decision
 *      log has something to point at),
 *   3. tell the applicant by email,
 *   4. PURGE — server route `POST /api/students/purge`, which is the only
 *      place that can kill the Firebase Auth credential, then every document,
 *      history row, seat hold and uniqueness claim (`phone_`, `email_`,
 *      `req_adm_`, `req_admmail_`, `txn_`) that named this person.
 *
 * If step 4 cannot reach the server, nothing is left half-deleted: the record
 * survives flagged `Rejected`, and `isAdmitted()` keeps it out of the students
 * list while the queue no longer shows it either. The failure is reported to
 * the caller so the operator knows the applicant still exists.
 *
 * @returns {Promise<{success: boolean, error?: string, purged?: boolean}>}
 */
export const rejectAdmission = async (admissionId, reason) => {
  try {
    const studentRef = doc(db, "students", admissionId);
    const studentSnap = await getDoc(studentRef);
    const targetRef = studentSnap.exists() ? studentRef : doc(db, "admissions", admissionId);

    const docSnap = await getDoc(targetRef);
    if (!docSnap.exists()) throw new Error("Admission record not found.");
    const data = docSnap.data() || {};

    // Release seat if reserved FOR THIS applicant (never steals another
    // student's seat, never touches an already-Occupied seat).
    const seatNumber = String(data.seatAssigned || data.seatNumber || "").trim();
    if (seatNumber && seatNumber !== "undefined") {
      const seatDoc = await findSeat(seatNumber, data.seatFloor || "");
      if (seatDoc &&
          seatDoc.data.status === "Reserved" &&
          seatDoc.data.assignedStudentId === admissionId) {
        await updateDoc(seatDoc.ref, {
          status: "Available",
          assignedStudentId: null,
          assignedStudentName: null,
          planType: null,
          lastUpdated: serverTimestamp()
        });
      }
    }

    await updateDoc(targetRef, {
      approvalStatus: "Rejected",
      rejectReason: reason || "",
      status: "Rejected",
      updatedAt: serverTimestamp()
    });

    await syncUserStatus(admissionId, "Rejected");
    await announceDecision(admissionId, data, "Rejected", { reason: reason || "", skipNotify: true });

    // 4. Purge everything attached to this applicant.
    let purged = false;
    if (studentSnap.exists()) {
      const { permanentlyDeleteStudent } = await import("./studentService.js");
      const res = await permanentlyDeleteStudent(admissionId, { wipeHistory: true });
      purged = !!(res && res.success);
      if (!purged) {
        console.warn("Rejected applicant was NOT purged:", res && res.error);
        return {
          success: true,
          purged: false,
          error: `Rejected, but nothing could be deleted: ${res && res.error ? res.error : "unknown error"}`,
        };
      }
    } else {
      // Legacy `admissions/{id}` — no Auth account, no student doc.
      try { await deleteDoc(targetRef); purged = true; }
      catch (e) { console.warn("Legacy admission not removed:", e?.message || e); }
    }

    return { success: true, purged };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// ──────────────────────────────────────────────────────────────────────────
// Dismiss (take it out of the queue without deciding it)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Remove a request from the Pending-approval queue WITHOUT approving or
 * rejecting it. The record is fully preserved — only the lifecycle flags
 * change — so it stays searchable in Students and can be reasoned about later.
 * A seat Reserved for THIS applicant is released; an Occupied seat is never
 * touched.
 */
export const dismissAdmission = async (admissionId) => {
  try {
    const studentRef = doc(db, "students", admissionId);
    const studentSnap = await getDoc(studentRef);
    const targetRef = studentSnap.exists() ? studentRef : doc(db, "admissions", admissionId);

    const docSnap = await getDoc(targetRef);
    if (!docSnap.exists()) throw new Error("Admission record not found.");
    const data = docSnap.data() || {};

    const seatNumber = String(data.seatAssigned || data.seatNumber || "").trim();
    if (seatNumber && seatNumber !== "undefined") {
      const seatDoc = await findSeat(seatNumber, data.seatFloor || "");
      if (seatDoc &&
          seatDoc.data.status === "Reserved" &&
          seatDoc.data.assignedStudentId === admissionId) {
        await updateDoc(seatDoc.ref, {
          status: "Available",
          assignedStudentId: null,
          assignedStudentName: null,
          planType: null,
          lastUpdated: serverTimestamp(),
        });
      }
    }

    await updateDoc(targetRef, {
      approvalStatus: "Dismissed",
      status: "Dismissed",
      dismissedAt: serverTimestamp(),
      dismissedBy: (typeof localStorage !== "undefined" && localStorage.getItem("userName")) || "Staff",
      updatedAt: serverTimestamp(),
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// ──────────────────────────────────────────────────────────────────────────
// Request changes
// ──────────────────────────────────────────────────────────────────────────

/**
 * Ask the applicant for changes (students doc OR legacy admissions doc).
 * The record stays pending — status is untouched, nothing is deleted.
 */
export const requestChangesAdmission = async (admissionId, notes) => {
  try {
    const studentRef = doc(db, "students", admissionId);
    const studentSnap = await getDoc(studentRef);
    const targetRef = studentSnap.exists() ? studentRef : doc(db, "admissions", admissionId);

    const docSnap = await getDoc(targetRef);
    if (!docSnap.exists()) throw new Error("Admission record not found.");

    await updateDoc(targetRef, {
      approvalStatus: "Changes Requested",
      adminNotes: notes || "",
      updatedAt: serverTimestamp()
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
