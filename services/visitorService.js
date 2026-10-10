import { collection, addDoc, updateDoc, deleteDoc, doc, query, onSnapshot, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase/firebase.js";
import { validateVisitor } from "./visitorValidation.js";

// NOTE: the old "visitor purposes" feature is gone on request. There is no
// `visitorPurposes` collection, no purpose field and no purpose filter any
// more — every purpose used to be a hardcoded single value anyway.

// ===============================================
// VISITORS CRUD & LISTENERS
// ===============================================

/**
 * Newest-first sort key. Website leads and legacy rows may miss visitDate /
 * visitTime, so fall back to createdAt and finally to 0 (they sink to the
 * bottom instead of producing NaN comparisons).
 */
const sortTime = (v) => {
  if (!v) return 0;
  if (v.visitDate) {
    const t = new Date(`${v.visitDate}T${v.visitTime || "00:00"}`).getTime();
    if (!isNaN(t)) return t;
  }
  if (v.createdAt) {
    const t = typeof v.createdAt.toMillis === "function"
      ? v.createdAt.toMillis()
      : new Date(v.createdAt).getTime();
    if (!isNaN(t)) return t;
  }
  return 0;
};

export const listenToVisitors = (onUpdate) => {
  const q = query(collection(db, "visitors"));
  return onSnapshot(q, (snapshot) => {
    const records = [];
    snapshot.forEach(doc => records.push({ id: doc.id, ...doc.data() }));
    // Sort descending by created time or visitDate/time
    records.sort((a, b) => sortTime(b) - sortTime(a));
    onUpdate(records);
  });
};

/**
 * Create a visitor / website lead.
 * Manual "Add Visitor" entries default to source "Walk-in"; website leads
 * carry source "Website" + leadStatus "New" (and optionally email, message,
 * planId / planName written by the public site).
 */
export const addVisitor = async (visitorData, authorId) => {
  try {
    validateVisitor(visitorData);

    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

    const source = (visitorData.source || "Walk-in").trim();

    const payload = {
      visitorName: visitorData.visitorName.trim(),
      phone: visitorData.phone.trim(),
      email: String(visitorData.email || "").trim(),
      message: String(visitorData.message || "").trim(),
      employeeName: String(visitorData.employeeName || "").trim(),
      employeeId: authorId || "",
      visitDate: dateStr,
      visitTime: timeStr,
      source: source,
      planId: String(visitorData.planId || "").trim(),
      planName: String(visitorData.planName || "").trim(),
      status: "Active", // Defaults to Active (in the building)
      linkedStudentId: String(visitorData.linkedStudentId || "").trim(),
      remarks: (visitorData.remarks || "").trim(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    // Website leads always carry an explicit pipeline status; walk-ins don't
    // (the rules default it to "New" for reads, and the lead-status filter
    // treats a missing value as "not a lead").
    const leadStatus = String(visitorData.leadStatus || "").trim();
    if (leadStatus) payload.leadStatus = leadStatus;

    await addDoc(collection(db, "visitors"), payload);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const updateVisitorStatus = async (id, newStatus) => {
  try {
    const docRef = doc(db, "visitors", id);
    await updateDoc(docRef, {
      status: newStatus,
      updatedAt: serverTimestamp()
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

/**
 * Move a website lead through its pipeline: New -> Converted / Closed.
 * Only touches `leadStatus` — the walk-in lifecycle (`status`) and every
 * other field stay exactly as they are.
 */
export const setVisitorLeadStatus = async (id, leadStatus) => {
  try {
    if (["New", "Converted", "Closed"].indexOf(leadStatus) === -1) {
      throw new Error('Lead status must be "New", "Converted" or "Closed".');
    }
    const docRef = doc(db, "visitors", id);
    await updateDoc(docRef, {
      leadStatus: leadStatus,
      updatedAt: serverTimestamp()
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const deleteVisitor = async (id) => {
  try {
    const docRef = doc(db, "visitors", id);
    await deleteDoc(docRef);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
