import { collection, query, where, onSnapshot, getDocs, doc, getDoc, updateDoc, runTransaction, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase/firebase.js";

/**
 * Staff side of seat-change requests (student files from the portal).
 * approveSeatChangeRequest runs one transaction: student flips to the new
 * seat, the old seat is freed, the new seat becomes Reserved (so the student
 * can clock in right away), the request is marked Approved — never one
 * without the others.
 */

/**
 * Idempotent global wiring so Approve/Reject buttons work from ANY page
 * (Notifications list and Seats queue both call these). Safe to call twice.
 */
export const wireSeatRequestActions = () => {
  if (window.__seatReqActionsWired) return;
  window.__seatReqActionsWired = true;

  window.approveSeatChange = async (id) => {
    const ok = await window.showCustomConfirm("Approve Seat Change", "Move this student to the requested seat?", "Approve", false);
    if (!ok) return;
    const res = await approveSeatChangeRequest(id, (typeof localStorage !== "undefined" && localStorage.getItem("userName")) || "Staff");
    if (typeof window.showToast === "function") {
      window.showToast(res.success ? "Seat changed." : "Failed: " + res.error, res.success ? "success" : "error");
    }
  };

  window.rejectSeatChange = async (id) => {
    const reason = await window.showCustomPrompt("Reject Seat Change", "Reason (shown to the student):", "Reject", false, "");
    if (reason === null || reason === undefined) return;
    const res = await rejectSeatChangeRequest(id, (typeof localStorage !== "undefined" && localStorage.getItem("userName")) || "Staff", reason || "");
    if (typeof window.showToast === "function") {
      window.showToast(res.success ? "Request rejected." : "Failed: " + res.error, res.success ? "success" : "error");
    }
  };
};

export const listenToPendingSeatRequests = (onUpdate, onError) => {
  const q = query(collection(db, "seatRequests"), where("status", "==", "Pending"));
  return onSnapshot(q, (snap) => {
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
    list.sort((a, b) => {
      const ta = (a.createdAt && (a.createdAt.seconds || 0)) || 0;
      const tb = (b.createdAt && (b.createdAt.seconds || 0)) || 0;
      return tb - ta;
    });
    try { onUpdate(list); } catch (e) { console.warn("[seatRequests] onUpdate failed:", e); }
  }, (err) => {
    if (typeof onError === "function") onError(err && (err.message || err.code));
    else console.warn("[seatRequests] listener error:", err);
  });
};

const stripPlain = (v) => {
  const raw = String(v == null ? "" : v).trim().toUpperCase().replace(/\s+/g, "");
  const m = raw.match(/^[AB]?0*(\d+)[AB]?$/);
  return m ? String(Number(m[1])) : raw;
};

/** Floor-aware seat lookup (plain numbers + legacy A/B docs). */
const findSeatDoc = async (number, floor) => {
  const plain = stripPlain(number);
  for (const key of [plain, `A${plain}`, `B${plain}`]) {
    try {
      const s = await getDocs(query(collection(db, "seats"), where("seatNumber", "==", key)));
      for (const d of s.docs) {
        const sd = d.data() || {};
        if (stripPlain(sd.seatNumber) === plain && (sd.floor || "Ground Floor") === floor) {
          return { ref: d.ref, data: sd };
        }
      }
    } catch (_) { /* try next key */ }
  }
  return null;
};

export const approveSeatChangeRequest = async (requestId, staffName) => {
  try {
    const reqRef = doc(db, "seatRequests", requestId);
    const reqSnap = await getDoc(reqRef);
    if (!reqSnap.exists()) throw new Error("Request not found.");
    const req = reqSnap.data() || {};
    if (req.status !== "Pending") throw new Error("Request is no longer pending.");

    const studentRef = doc(db, "students", req.studentId);
    const studentSnap = await getDoc(studentRef);
    if (!studentSnap.exists()) throw new Error("Student record not found.");
    const student = studentSnap.data() || {};
    if (student.status !== "Active") throw new Error("Student is not active.");

    const toSeat = stripPlain(req.toSeat);
    const toFloor = req.toFloor || "Ground Floor";
    const target = await findSeatDoc(toSeat, toFloor);
    if (!target) throw new Error(`Seat ${toSeat} no longer exists on ${toFloor}.`);
    const td = target.data;
    if (td.status === "Occupied" || td.status === "Maintenance" || td.status === "Inactive") {
      throw new Error(`Seat ${toSeat} is ${String(td.status).toLowerCase()} now. Ask the student to pick another.`);
    }
    if (td.status === "Reserved" && td.assignedStudentId && td.assignedStudentId !== req.studentId) {
      throw new Error(`Seat ${toSeat} is reserved for someone else.`);
    }

    // Old seat: prefer the doc actually holding this student, else the named one.
    let oldRef = null;
    try {
      const held = await getDocs(query(collection(db, "seats"), where("assignedStudentId", "==", req.studentId)));
      const fromPlain = stripPlain(req.fromSeat);
      const fromFloor = req.fromFloor || student.seatFloor || "Ground Floor";
      oldRef = held.docs.find((d) => {
        const sd = d.data() || {};
        return stripPlain(sd.seatNumber) === fromPlain && (sd.floor || "Ground Floor") === fromFloor;
      })?.ref || held.docs[0]?.ref || null;
    } catch (_) { /* old-seat release stays best-effort */ }

    await runTransaction(db, async (tx) => {
      const freshReq = await tx.get(reqRef);
      if (!freshReq.exists() || (freshReq.data() || {}).status !== "Pending") {
        throw new Error("Request was already decided.");
      }
      tx.update(studentRef, {
        seatNumber: td.seatNumber || toSeat,
        seatFloor: toFloor,
        updatedAt: serverTimestamp(),
      });
      if (oldRef && oldRef.path !== target.ref.path) {
        tx.update(oldRef, {
          status: "Available",
          assignedStudentId: null,
          assignedStudentName: null,
          planType: null,
          lastUpdated: serverTimestamp(),
        });
      }
      tx.update(target.ref, {
        status: "Reserved",
        assignedStudentId: req.studentId,
        assignedStudentName: student.name || req.studentName || "",
        planType: student.planName || req.planName || "",
        lastUpdated: serverTimestamp(),
      });
      tx.update(reqRef, {
        status: "Approved",
        decidedBy: staffName || "",
        decidedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const rejectSeatChangeRequest = async (requestId, staffName, reason) => {
  try {
    const reqRef = doc(db, "seatRequests", requestId);
    const reqSnap = await getDoc(reqRef);
    if (!reqSnap.exists()) throw new Error("Request not found.");
    if ((reqSnap.data() || {}).status !== "Pending") throw new Error("Request is no longer pending.");
    await updateDoc(reqRef, {
      status: "Rejected",
      decidedBy: staffName || "",
      decisionReason: String(reason || "").trim().slice(0, 300),
      decidedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    // Release the Pending hold the student placed on the target seat.
    try {
      const req = reqSnap.data() || {};
      const target = await findSeatDoc(req.toSeat, req.toFloor || "Ground Floor");
      if (target && target.data.status === "Pending" && target.data.assignedStudentId === req.studentId) {
        await updateDoc(target.ref, {
          status: "Available",
          assignedStudentId: null,
          assignedStudentName: null,
          lastUpdated: serverTimestamp(),
        });
      }
    } catch (_) { /* best effort — staff can also free the seat by hand */ }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
