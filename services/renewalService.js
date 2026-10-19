import { collection, doc, query, where, onSnapshot, serverTimestamp, runTransaction } from "firebase/firestore";
import { db } from "../firebase/firebase.js";
import { validateRenewal } from "./renewalValidation.js";

/**
 * Listens to renewal history for a specific student
 */
export const listenToRenewalHistory = (studentId, onUpdate, onError) => {
  if (!studentId) return () => {};
  const q = query(collection(db, "renewals"), where("studentId", "==", studentId));
  return onSnapshot(q, (snapshot) => {
    const history = [];
    snapshot.forEach(doc => history.push({ id: doc.id, ...doc.data() }));
    // Sort descending. createdAt may be a Firestore Timestamp (serverTimestamp)
    // or an ISO string — handle both, plain new Date(Timestamp) is Invalid.
    const ts = (x) => (x && typeof x === "object" && typeof x.seconds === "number"
      ? x.seconds * 1000
      : new Date(x || 0).getTime() || 0);
    history.sort((a, b) => ts(b.createdAt) - ts(a.createdAt));
    try { onUpdate(history); } catch (e) { console.warn("[renewals] onUpdate failed:", e); }
  }, (err) => {
    const msg = (err && (err.message || err.code)) || String(err);
    if (/permission|insufficient/i.test(msg)) {
      console.warn("[renewals] listening denied — check firestore.rules");
      try { onUpdate([]); } catch (_) {}
      if (typeof onError === "function") onError(msg);
      return;
    }
    if (typeof onError === "function") onError(msg);
    else console.warn("[renewals] listener error:", err);
  });
};

/**
 * Processes a renewal atomically
 */
export const processRenewal = async (data) => {
  try {
    validateRenewal(data);
    
    await runTransaction(db, async (transaction) => {
      // 1. Get references
      const studentRef = doc(db, "students", data.studentId);
      const renewalRef = doc(collection(db, "renewals")); // new doc
      
      const studentDoc = await transaction.get(studentRef);
      if (!studentDoc.exists()) throw new Error("Student not found.");

      const ssUrl = data.screenshot || data.paymentScreenshotUrl || (data.screenshots && data.screenshots[0]) || "";
      const txnId = data.transactionId || "";

      // 2. Write Renewal Record
      const renRecord = {
        studentId: data.studentId,
        studentName: studentDoc.data().name,
        oldPlan: data.oldPlanName || "",
        newPlan: data.newPlanName || "",
        startDate: data.startDate,
        endDate: data.endDate,
        durationDays: Number(data.durationDays || 30),
        durationMode: data.durationMode || "monthly",
        amount: Number(data.amount),
        paymentMethod: data.paymentMethod,
        transactionId: txnId,
        renewedBy: data.renewedBy || "Admin",
        renewalNotes: data.renewalNotes || "",
        status: "Completed",
        createdAt: serverTimestamp()
      };
      if (ssUrl) {
        renRecord.screenshot = ssUrl;
        renRecord.paymentScreenshotUrl = ssUrl;
        renRecord.screenshots = [ssUrl];
      }
      transaction.set(renewalRef, renRecord);

      // 3. Update Student Record
      transaction.update(studentRef, {
        planId: data.newPlanId,
        planName: data.newPlanName,
        startDate: data.startDate,
        endDate: data.endDate,
        paymentDueDate: data.endDate, // The new due date is the end of this renewal period
        status: "Active", // Ensure they are active
        updatedAt: serverTimestamp()
      });

      // 4. Generate Completed Payment Record
      if (Number(data.amount) >= 0) {
        const paymentRef = doc(collection(db, "payments"));
        const payRecord = {
          studentId: data.studentId,
          studentName: studentDoc.data().name,
          planName: data.newPlanName,
          amount: Number(data.amount),
          paymentMethod: data.paymentMethod,
          transactionId: txnId,
          paymentDate: new Date().toISOString().split("T")[0],
          startDate: data.startDate,
          endDate: data.endDate,
          durationDays: Number(data.durationDays || 30),
          durationMode: data.durationMode || "monthly",
          source: "renewal",
          // MUST be one of pending|approved|rejected: firestore.rules rejects
          // any other value on create (and the canonical schema forbids
          // "Completed" on payments — it is money that was collected).
          status: "approved",
          recordedBy: data.renewedBy || "Admin",
          createdAt: serverTimestamp()
        };
        if (ssUrl) {
          payRecord.screenshot = ssUrl;
          payRecord.paymentScreenshotUrl = ssUrl;
          payRecord.screenshots = [ssUrl];
        }
        transaction.set(paymentRef, payRecord);
      }
    });

    return { success: true };
  } catch (error) {
    console.error("Renewal Error:", error);
    return { success: false, error: error.message };
  }
};
