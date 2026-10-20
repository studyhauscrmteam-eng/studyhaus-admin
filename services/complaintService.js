import { collection, query, where, onSnapshot, addDoc, serverTimestamp, doc, updateDoc, getDoc, getDocs } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { db } from "../firebase/firebase.js";
import { validateComplaint } from "./complaintValidation.js";

// ===============================================
// STUDENT COMPLAINT ACTIONS
// ===============================================

export const submitComplaint = async (student, category, description) => {
  try {
    validateComplaint(category, description);

    let authUser = null;
    try {
      authUser = getAuth().currentUser;
    } catch (_) {}

    const studentObj = (typeof student === "object" && student !== null) ? student : {};
    const studentId = studentObj.id || studentObj.studentId || studentObj.uid || (typeof student === "string" ? student : "") || (authUser ? authUser.uid : "unknown");
    const studentName = studentObj.name || studentObj.studentName || (authUser ? (authUser.displayName || authUser.email) : "") || "Student";
    const studentPhone = studentObj.phone || studentObj.studentPhone || "";
    const planName = studentObj.planName || studentObj.plan || "Unknown";

    // Seat the student is sitting in RIGHT NOW (the one they chose at
    // check-in today). Uses the indexed studentId+status query.
    let seatNumber = studentObj.seatNumber || studentObj.seatAssigned || "";
    let seatFloor = studentObj.seatFloor || studentObj.floor || "";
    if (!seatNumber && studentId && studentId !== "unknown") {
      try {
        const activeQ = query(collection(db, "attendance"),
          where("studentId", "==", studentId), where("status", "==", "Active"));
        const activeSnap = await getDocs(activeQ);
        if (!activeSnap.empty) {
          const actData = activeSnap.docs[0].data() || {};
          seatNumber = actData.seatNumber || "";
          seatFloor = actData.seatFloor || seatFloor;
        }
      } catch (_) { /* seat is optional context on a complaint */ }
    }
    if (!seatFloor && seatNumber) seatFloor = "Ground Floor";

    const payload = {
      studentId: String(studentId || "").trim(),
      uid: authUser ? authUser.uid : String(studentId || "").trim(),
      studentName: String(studentName || "Student").trim(),
      studentPhone: String(studentPhone || "").trim(),
      seatNumber: String(seatNumber || "").trim(),
      seatFloor: String(seatFloor || "").trim(),
      planName: String(planName || "Unknown").trim(),
      category: String(category || "Others").trim(),
      description: String(description || "").trim(),
      status: "Pending", // Pending, In Progress, Resolved, Closed
      date: new Date().toISOString(),
      createdAt: serverTimestamp()
    };

    // Guarantee no undefined fields are passed into Firestore
    Object.keys(payload).forEach(k => {
      if (payload[k] === undefined) payload[k] = "";
    });

    const complaintRef = await addDoc(collection(db, "complaints"), payload);

    try {
      const seatDisp = seatNumber ? ` (Seat ${seatNumber}${seatFloor ? ` - ${seatFloor}` : ""})` : "";
      await addDoc(collection(db, "notifications"), {
        type: "complaint",
        title: `Complaint: ${payload.category}`,
        body: `${payload.studentName}${seatDisp}: ${payload.description}`,
        complaintId: complaintRef.id,
        studentId: payload.studentId,
        studentName: payload.studentName,
        studentPhone: payload.studentPhone,
        seatNumber: payload.seatNumber,
        seatFloor: payload.seatFloor,
        category: payload.category,
        read: false,
        forRoles: ["Owner/Admin", "Manager"],
        createdAt: serverTimestamp()
      });
    } catch (_) {}
    
    return { success: true };
  } catch (error) {
    console.error("[complaints] submitComplaint failed:", error);
    return { success: false, error: error.message || "Failed to submit complaint" };
  }
};

export const listenToMyComplaints = (studentId, onUpdate, onError) => {
  if (!studentId) return () => {};
  const q = query(
    collection(db, "complaints"),
    where("studentId", "==", studentId)
  );
  return onSnapshot(q, (snapshot) => {
    const records = [];
    snapshot.forEach(doc => records.push({ id: doc.id, ...doc.data() }));
    records.sort((a, b) => new Date(b.date) - new Date(a.date));
    try { onUpdate(records); } catch (e) { console.warn("[complaints] onUpdate failed:", e); }
  }, (err) => {
    const msg = (err && (err.message || err.code)) || String(err);
    if (/permission|insufficient/i.test(msg)) {
      console.warn("[complaints] listening denied — check firestore.rules");
      try { onUpdate([]); } catch (_) {}
      if (typeof onError === "function") onError(msg);
      return;
    }
    if (typeof onError === "function") onError(msg);
    else console.warn("[complaints] listener error:", err);
  });
};

// ===============================================
// ADMIN COMPLAINT ACTIONS
// ===============================================

export const listenToAllComplaints = (onUpdate) => {
  const q = query(collection(db, "complaints"));
  return onSnapshot(q, (snapshot) => {
    const records = [];
    snapshot.forEach(doc => records.push({ id: doc.id, ...doc.data() }));
    records.sort((a, b) => new Date(b.date) - new Date(a.date));
    onUpdate(records);
  });
};

export const resolveComplaint = async (complaintId, resolverName, resolutionNote) => {
  try {
    const docRef = doc(db, "complaints", complaintId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) throw new Error("Complaint not found.");

    await updateDoc(docRef, {
      status: "Resolved",
      resolutionNote: resolutionNote,
      resolvedBy: resolverName,
      resolvedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    try {
      const notifQ = query(collection(db, "notifications"), where("complaintId", "==", complaintId));
      const notifSnap = await getDocs(notifQ);
      notifSnap.forEach(d => updateDoc(d.ref, { read: true }).catch(() => {}));
    } catch (_) {}
    
    return { success: true, data: snap.data() };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const updateComplaintStatus = async (complaintId, newStatus) => {
  try {
    const docRef = doc(db, "complaints", complaintId);
    await updateDoc(docRef, {
      status: newStatus,
      updatedAt: serverTimestamp()
    });

    if (newStatus === "Resolved" || newStatus === "Closed") {
      try {
        const notifQ = query(collection(db, "notifications"), where("complaintId", "==", complaintId));
        const notifSnap = await getDocs(notifQ);
        notifSnap.forEach(d => updateDoc(d.ref, { read: true }).catch(() => {}));
      } catch (_) {}
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
