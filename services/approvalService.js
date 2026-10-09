import { doc, getDoc, deleteDoc, setDoc, updateDoc, collection, query, where, getDocs, runTransaction, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase/firebase.js";

// ──────────────────────────────────────────────────────────────────────────
// Shared helpers
// ──────────────────────────────────────────────────────────────────────────

/**
 * Locate a seat by its number. Doc ids are now deterministic
 * (`seats/A17` === seatNumber), but legacy auto-keyed seats still exist, so
 * fall back to a seatNumber query when the direct read misses.
 * @returns {{ref: any, data: Object}|null}
 */
const findSeat = async (seatNumber) => {
  try {
    const directRef = doc(db, "seats", seatNumber);
    const snap = await getDoc(directRef);
    if (snap.exists()) return { ref: directRef, data: snap.data() };
  } catch (_) { /* fall through to the query */ }
  try {
    const q = query(collection(db, "seats"), where("seatNumber", "==", seatNumber));
    const snap = await getDocs(q);
    if (!snap.empty) return { ref: snap.docs[0].ref, data: snap.docs[0].data() };
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
  if (!seatNumber || seatNumber === "undefined") return { number: "", allowed: false };

  if (data.planId) {
    try {
      const { planAllowsSeatSelection } = await import("./planValidation.js");
      const allowed = await planAllowsSeatSelection(data.planId);
      if (!allowed) return { number: "", allowed: false };
    } catch (_) { /* fail open only when the plan can't be read */ }
  }
  return { number: seatNumber, allowed: true };
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
    updatedAt: serverTimestamp(),
  };
  if (allocatedNumber) {
    payload.studentId = data.studentId || "";
    payload.admissionNo = data.admissionNo || data.studentId || "";
  }
  if (seat.allowed) payload.seatNumber = seat.number;

  // One transaction: the student flips to Active and the seat becomes
  // Occupied together — never one without the other.
  await runTransaction(db, async (tx) => {
    const fresh = await tx.get(studentRef);
    if (!fresh.exists()) throw new Error("Admission record not found.");

    // Read the seat BEFORE any write so a seat grabbed by someone else in
    // the meantime fails cleanly instead of being stolen.
    if (seat.allowed && seat.number) {
      const seatRef = doc(db, "seats", seat.number);
      const seatSnap = await tx.get(seatRef);
      if (seatSnap.exists()) {
        const sd = seatSnap.data() || {};
        const holder = sd.assignedStudentId || "";
        const taken = sd.status === "Occupied" || sd.status === "Reserved";
        if (taken && holder && holder !== id) {
          throw new Error(`Seat ${seat.number} is already taken (${sd.assignedStudentName || holder}). Re-submit with a different seat.`);
        }
      }
    }

    tx.update(studentRef, payload);

    if (seat.allowed && seat.number) {
      // Deterministic doc id: seats/A17 (doc id === seatNumber).
      // merge:true preserves floor/col/row on the existing seat doc.
      const seatRef = doc(db, "seats", seat.number);
      tx.set(seatRef, {
        seatNumber: seat.number,
        status: "Occupied",
        assignedStudentId: id,
        assignedStudentName: data.name || "",
        planType: data.planName || "",
        lastUpdated: serverTimestamp(),
      }, { merge: true });
    }
  });

  await syncUserStatus(id, "Active");
  await announceDecision(id, data, "Approved");
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
        status: "Occupied",
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
 * Releases a seat reserved for this applicant, records the reason and
 * flips the lifecycle fields — never deletes anything.
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
      const seatDoc = await findSeat(seatNumber);
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
    await announceDecision(admissionId, data, "Rejected", { reason: reason || "" });

    return { success: true };
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
      const seatDoc = await findSeat(seatNumber);
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
