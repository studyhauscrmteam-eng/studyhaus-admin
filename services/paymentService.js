import { collection, query, where, onSnapshot, addDoc, serverTimestamp, doc, updateDoc, getDoc, runTransaction } from "firebase/firestore";
import { db } from "../firebase/firebase.js";
import { validateTransactionId } from "./paymentValidation.js";

// Legacy import marker (bulk-imported history rows carry it). It is not a
// real UPI reference, so it must never trip the uniqueness guard.
const TXN_SENTINELS = ["rc-imp"];

// ===============================================
// STUDENT PAYMENT ACTIONS
// ===============================================

export const submitPaymentRequest = async (student, transactionId, renewalMonths, amount, monthLabel = null) => {
  try {
    if (!transactionId || transactionId.trim() === "") {
      throw new Error("Transaction ID is required.");
    }

    const paymentData = {
      studentId: student.id,
      studentName: student.name,
      planName: student.planName,
      amount: Number(amount),
      renewalPeriod: Number(renewalMonths), // Months to add
      transactionId: transactionId.trim(),
      status: "pending", // "pending", "approved", "rejected"
      dueDateStr: student.paymentDueDate || "", // Reference for dashboard
      date: new Date().toISOString(),
      createdAt: serverTimestamp()
    };

    // Store which specific month is being paid (for sequential overdue payments)
    if (monthLabel) paymentData.monthLabel = monthLabel; // e.g. "June 2026"

    const txnId = String(paymentData.transactionId);
    const isImportMarker = TXN_SENTINELS.indexOf(txnId.toLowerCase()) !== -1;
    const claimSafe = !/[/]/.test(txnId) && txnId !== "." && txnId !== "..";

    if (isImportMarker || !claimSafe) {
      // Sentinel / unsafe id: no claim, but still create the document the
      // same way as before (nothing to guard).
      if (!isImportMarker) await validateTransactionId(txnId);
      await addDoc(collection(db, "payments"), paymentData);
      return { success: true };
    }

    // The same UPI reference must never be submitted twice. Everything —
    // the duplicate check AND the document itself — happens inside ONE
    // transaction so two racing submissions can't both slip through.
    await runTransaction(db, async (tx) => {
      // 1. Re-check every payment already stored (throws a friendly error).
      try {
        await validateTransactionId(txnId);
      } catch (e) {
        // A student profile may be denied reading other students' payments;
        // that is not a duplicate — the atomic claim below still guards us.
        if (!/permission|denied|insufficient/i.test(e?.message || "")) throw e;
      }

      // 2. Atomic claim: uniqueness/txn_<txnId> (spec §2). Reading it via
      //    tx.get makes the check + claim indivisible.
      const claimRef = doc(db, "uniqueness", `txn_${txnId}`);
      const claimSnap = await tx.get(claimRef);
      if (claimSnap.exists()) {
        throw new Error(`Transaction ID ${txnId} has already been used. Please check your UPI reference.`);
      }

      // 3. Create the payment document in the same transaction.
      const paymentRef = doc(collection(db, "payments"));
      tx.set(claimRef, {
        kind: "transactionId",
        paymentId: paymentRef.id,
        createdAt: serverTimestamp()
      });
      tx.set(paymentRef, paymentData);
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};



export const listenToMyPayments = (studentId, onUpdate, onError) => {
  if (!studentId) return () => {};
  const q = query(
    collection(db, "payments"),
    where("studentId", "==", studentId)
  );
  return onSnapshot(q, (snapshot) => {
    const records = [];
    snapshot.forEach(doc => records.push({ id: doc.id, ...doc.data() }));
    records.sort((a, b) => new Date(b.date || b.paymentDate || 0) - new Date(a.date || a.paymentDate || 0));
    try { onUpdate(records); } catch (e) { console.warn("[payments] onUpdate failed:", e); }
  }, (err) => {
    const msg = (err && (err.message || err.code)) || String(err);
    if (/permission|insufficient/i.test(msg)) {
      console.warn("[payments] listening denied — check firestore.rules");
      try { onUpdate([]); } catch (_) {}
      if (typeof onError === "function") onError(msg);
      return;
    }
    if (typeof onError === "function") onError(msg);
    else console.warn("[payments] listener error:", err);
  });
};

// ===============================================
// ADMIN PAYMENT ACTIONS
// ===============================================

export const parseStandardDate = (input) => {
  if (!input) return null;
  if (input instanceof Date && !isNaN(input.getTime())) return input;
  if (typeof input === "object" && typeof input.seconds === "number") {
    return new Date(input.seconds * 1000);
  }
  let s = String(input).trim();
  if (!s) return null;

  // Strip 'at ' from timestamps like 'October 26, 2026 at 8:11 am'
  s = s.replace(/\s+at\s+/i, " ");

  // DD/MM/YYYY or DD-MM-YYYY
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (m) {
    const d = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10) - 1;
    const y = parseInt(m[3], 10);
    return new Date(y, mo, d);
  }

  // YYYY-MM-DD or YYYY/MM/DD
  m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (m) {
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10) - 1;
    const d = parseInt(m[3], 10);
    return new Date(y, mo, d);
  }

  const parsed = new Date(s);
  return isNaN(parsed.getTime()) ? null : parsed;
};

export const listenToAllPayments = (onUpdate) => {
  let payments = [];
  let renewals = [];
  let rawStudents = [];
  const studentLookup = new Map();

  const emit = () => {
    const unifiedMap = new Map();

    const cleanPhone = (p) => String(p || "").replace(/\D/g, "").slice(-10);

    const getStudentObj = (sId, sUid, sName, rawPhone) => {
      if (sId && studentLookup.has(sId)) return studentLookup.get(sId);
      if (sUid && studentLookup.has(sUid)) return studentLookup.get(sUid);
      const cp = cleanPhone(rawPhone);
      if (cp && studentLookup.has(cp)) return studentLookup.get(cp);
      if (rawPhone && studentLookup.has(rawPhone)) return studentLookup.get(rawPhone);
      if (sName && studentLookup.has(String(sName).toLowerCase().trim())) return studentLookup.get(String(sName).toLowerCase().trim());
      return null;
    };

    const isOldStudent = (sObj, rec) => {
      if (sObj) {
        if (sObj.isLiveActive) return false;
        const st = String(sObj.status || "").toLowerCase().trim();
        if (st === "old" || st === "old student" || st === "inactive" || st === "expired" || sObj.portalAccessDisabled === true || sObj.studentDeleted === true) return true;
        return false;
      }
      if (rec) {
        const rst = String(rec.studentStatus || rec.status || "").toLowerCase().trim();
        if (rst === "old" || rst === "old student" || rst === "archived") return true;
      }
      return true;
    };

    // 1. Ingest all records from 'payments' collection
    payments.forEach(p => {
      const sObj = getStudentObj(p.studentId, p.uid, p.studentName, p.studentPhone || p.phone);

      const sName = p.studentName || sObj?.name || "Student";
      const sPhone = p.studentPhone || p.phone || sObj?.phone || "";
      const sId = p.studentId || sObj?.studentId || sObj?.id || "";
      const seatNo = p.seatNumber || sObj?.seatNumber || "";
      const seatFl = p.seatFloor || sObj?.seatFloor || "";
      const parsedD = parseStandardDate(p.date || p.paymentDate || p.createdAt);
      const dateStr = parsedD ? parsedD.toISOString() : (p.date || p.paymentDate || "");
      const txn = String(p.transactionId || "").trim().toUpperCase();
      const amt = Number(p.amount) || 0;
      const stDate = p.startDate || "";
      const enDate = p.endDate || "";

      // Deduplicate on real transaction ID if available; otherwise use document ID to prevent collisions
      const cleanTxn = (txn && !/^(cash|pay\s*later|paylater|rc-n\/a|n\/a|none|undefined|null|—|-)$/i.test(txn) && !/rc-imp/i.test(txn)) ? txn : "";
      const key = cleanTxn
        ? `txn_${cleanTxn}`
        : `pay_${p.id || (sId + '_' + stDate + '_' + enDate + '_' + amt)}`;

      const pmP = String(p.paymentMethod || p.paymentMode || p.mode || "").trim();
      const isPlP = pmP.toLowerCase().includes("pay later") || String(p.status || "").toLowerCase().includes("pay later") || String(p.status || "").toLowerCase() === "pay_later" || txn === "PAY LATER";

      const isOldP = isOldStudent(sObj, p);
      unifiedMap.set(key, {
        ...p,
        id: p.id || key,
        studentLifecycle: isOldP ? "old" : "active",
        studentId: sId,
        studentName: sName,
        studentPhone: sPhone,
        seatNumber: seatNo,
        seatFloor: seatFl,
        date: dateStr,
        paymentMethod: isPlP ? "Pay Later" : (p.paymentMethod || "UPI"),
        transactionId: isPlP ? "PAY LATER" : (p.transactionId || "—"),
        status: isPlP ? "pay_later" : (p.status || "approved"),
        source: p.source || (p.renewalMonths || p.durationDays ? "renewal" : "payment")
      });
    });

    // 2. Ingest all records from 'renewals' collection
    renewals.forEach(r => {
      const sObj = getStudentObj(r.studentId, r.uid, r.studentName, r.studentPhone || r.phone);

      const sName = r.studentName || sObj?.name || "Student";
      const sPhone = r.studentPhone || sObj?.phone || "";
      const sId = r.studentId || sObj?.studentId || sObj?.id || "";
      const seatNo = r.seatNumber || sObj?.seatNumber || "";
      const seatFl = r.seatFloor || sObj?.seatFloor || "";
      const parsedD = parseStandardDate(r.createdAt || r.date || r.paymentDate || r.startDate);
      const dateStr = parsedD ? parsedD.toISOString() : (r.date || r.paymentDate || r.startDate || "");
      const txn = String(r.transactionId || "").trim().toUpperCase();
      const amt = Number(r.amount) || 0;
      const stDate = r.startDate || "";
      const enDate = r.endDate || "";

      // Deduplicate on real transaction ID if available; otherwise use document ID to prevent collisions
      const cleanTxn = (txn && !/^(cash|pay\s*later|paylater|rc-n\/a|n\/a|none|undefined|null|—|-)$/i.test(txn) && !/rc-imp/i.test(txn)) ? txn : "";
      const key = cleanTxn
        ? `txn_${cleanTxn}`
        : `ren_${r.id || (sId + '_' + stDate + '_' + enDate + '_' + amt)}`;

      const pmR = String(r.paymentMethod || r.paymentMode || r.mode || "").trim();
      const isPlR = pmR.toLowerCase().includes("pay later") || String(r.status || "").toLowerCase().includes("pay later") || String(r.status || "").toLowerCase() === "pay_later" || txn === "PAY LATER";

      const hasRealPayment = Array.from(unifiedMap.values()).some(u => {
        const matchStudent = (sId && u.studentId && sId === u.studentId) ||
          (sName && u.studentName && sName.toLowerCase().trim() === u.studentName.toLowerCase().trim());
        return matchStudent && !u.isPayLater && String(u.transactionId || "").toUpperCase() !== "PAY LATER" && String(u.paymentMethod || "").toLowerCase() !== "pay later";
      });
      if (isPlR && hasRealPayment) return; // Skip old pay later renewal when real payment exists

      const isOldR = isOldStudent(sObj, r);
      const existing = unifiedMap.get(key);
      if (!existing) {
        unifiedMap.set(key, {
          id: r.id || key,
          studentId: sId,
          studentName: sName,
          studentPhone: sPhone,
          seatNumber: seatNo,
          seatFloor: seatFl,
          planName: r.newPlan || r.planName || "Membership Plan",
          amount: amt,
          paymentMethod: isPlR ? "Pay Later" : (r.paymentMethod || "Cash"),
          transactionId: isPlR ? "PAY LATER" : (r.transactionId || "—"),
          startDate: stDate,
          endDate: enDate,
          durationDays: Number(r.durationDays || 30),
          durationMode: r.durationMode || "monthly",
          source: "renewal",
          status: isPlR ? "pay_later" : ((r.status && String(r.status).toLowerCase() === "pending") ? "pending" : "approved"),
          date: dateStr,
          paymentDate: r.paymentDate || stDate,
          screenshot: r.screenshot || r.paymentScreenshotUrl || (Array.isArray(r.screenshots) ? r.screenshots[0] : ""),
          paymentScreenshotUrl: r.screenshot || r.paymentScreenshotUrl || (Array.isArray(r.screenshots) ? r.screenshots[0] : ""),
          screenshots: Array.isArray(r.screenshots) ? r.screenshots : (r.screenshot ? [r.screenshot] : []),
          studentLifecycle: isOldR ? "old" : "active",
          createdAt: r.createdAt || null
        });
      } else {
        if (!existing.screenshot && (r.screenshot || r.paymentScreenshotUrl)) {
          existing.screenshot = r.screenshot || r.paymentScreenshotUrl;
          existing.paymentScreenshotUrl = existing.screenshot;
        }
        if ((!existing.studentName || existing.studentName === "Student" || existing.studentName === "Unknown") && sName && sName !== "Student") {
          existing.studentName = sName;
        }
      }
    });

    // 3. Ingest EVERY LIVE ACTIVE student from rawStudents so their admission/payment log is GUARANTEED to be present
    rawStudents.forEach(s => {
      const sId = s.id || s.studentId || "";
      const sName = s.name || "";
      if (!sName || sName === "Student") return;

      const isLive = s.isLiveActive;
      if (!isLive) return; // Keep live active students only

      // Check if this student already has any record in unifiedMap
      const alreadyHas = Array.from(unifiedMap.values()).some(u => {
        const sameStudent = (u.studentId && sId && (u.studentId === sId || u.studentId === s.docId)) ||
                            (u.studentName && sName && u.studentName.toLowerCase().trim() === sName.toLowerCase().trim());
        return sameStudent;
      });

      if (!alreadyHas) {
        const sAmt = Number(s.amount || s.planPrice || s.fee || 1000);
        const parsedJoinDate = parseStandardDate(s.startDate) || parseStandardDate(s.createdAt) || parseStandardDate(s.submittedAt) || new Date();
        const sDateStr = parsedJoinDate.toISOString();

        const pm = String(s.paymentMethod || "").trim();
        const pStatus = String(s.paymentStatus || "").toLowerCase();
        const isPl = pm.toLowerCase().includes("pay later") || pm.toLowerCase() === "paylater" || pStatus === "unpaid" || pStatus === "pay later" || pStatus === "pay_later";

        const key = `student_admission_${s.id}`;
        unifiedMap.set(key, {
          id: "admission_" + s.id,
          studentId: s.id,
          studentNo: s.studentId || s.admissionNo || "",
          studentName: s.name || "Student",
          studentPhone: s.phone || "",
          planName: s.planName || "Regular Fixed Seat",
          amount: sAmt,
          paymentMethod: isPl ? "Pay Later" : (pm || "UPI"),
          transactionId: s.transactionId || (isPl ? "PAY LATER" : "—"),
          startDate: s.startDate || sDateStr.split("T")[0],
          endDate: s.endDate || s.paymentDueDate || "",
          seatNumber: s.seatNumber || s.seatAssigned || "",
          seatFloor: s.seatFloor || "",
          source: isPl ? "pay_later" : "admission",
          isPayLater: isPl,
          studentLifecycle: "active",
          status: isPl ? "pay_later" : ((s.approvalStatus === "Pending" || s.status === "Pending") ? "pending" : "approved"),
          date: sDateStr,
          paymentDate: s.startDate || sDateStr.split("T")[0],
          screenshot: s.screenshot || s.paymentScreenshotUrl || "",
          paymentScreenshotUrl: s.screenshot || s.paymentScreenshotUrl || "",
          screenshots: (s.screenshot || s.paymentScreenshotUrl) ? [s.screenshot || s.paymentScreenshotUrl] : [],
          createdAt: s.createdAt || s.submittedAt || null
        });
      }
    });

    const records = Array.from(unifiedMap.values());
    const getTs = (x) => {
      const parsed = parseStandardDate(x.date || x.paymentDate || x.startDate || x.createdAt);
      return parsed ? parsed.getTime() : 0;
    };
    records.sort((a, b) => getTs(b) - getTs(a));
    onUpdate(records);
  };

  const unsubPayments = onSnapshot(query(collection(db, "payments")), (snap) => {
    payments = [];
    snap.forEach(doc => payments.push({ id: doc.id, ...doc.data() }));
    emit();
  }, (err) => console.warn("[payments] listen error:", err));

  const unsubRenewals = onSnapshot(query(collection(db, "renewals")), (snap) => {
    renewals = [];
    snap.forEach(doc => renewals.push({ id: doc.id, ...doc.data() }));
    emit();
  }, (err) => console.warn("[renewals] listen error:", err));

  const unsubStudents = onSnapshot(query(collection(db, "students")), (snap) => {
    rawStudents = [];
    studentLookup.clear();
    snap.forEach(doc => {
      const d = doc.data() || {};
      const st = String(d.status || "").trim();
      const ap = String(d.approvalStatus || "").trim();
      const isOld = st.toLowerCase() === "old" || st.toLowerCase() === "old student" || st.toLowerCase() === "inactive" || st.toLowerCase() === "expired" || d.portalAccessDisabled === true || d.studentDeleted === true;
      const isLiveActive = !isOld && (st.toLowerCase() === "active" || ap.toLowerCase() === "approved");

      const studentObj = {
        id: doc.id,
        docId: doc.id,
        uid: d.uid || "",
        studentId: d.studentId || d.admissionNo || "",
        admissionNo: d.admissionNo || d.studentId || "",
        name: d.name || "Student",
        phone: d.phone || "",
        status: d.status || "Active",
        approvalStatus: d.approvalStatus || "Approved",
        isLiveActive,
        planName: d.planName || "",
        planPrice: d.planPrice || d.fee || d.amount || 0,
        amount: d.amount || d.planPrice || d.fee || 0,
        startDate: d.startDate || "",
        endDate: d.endDate || d.paymentDueDate || "",
        paymentDueDate: d.paymentDueDate || d.endDate || "",
        paymentMethod: d.paymentMethod || "UPI",
        transactionId: d.transactionId || "",
        seatNumber: String(d.seatNumber || d.seatAssigned || "").replace(/^Seat\s*/i, "").trim(),
        seatFloor: d.seatFloor || d.floor || "",
        screenshot: d.paymentScreenshotUrl || d.paymentScreenshot || "",
        paymentScreenshotUrl: d.paymentScreenshotUrl || d.paymentScreenshot || "",
        createdAt: d.createdAt || null,
        submittedAt: d.submittedAt || null
      };

      rawStudents.push(studentObj);

      studentLookup.set(doc.id, studentObj);
      if (d.uid && d.uid !== doc.id) studentLookup.set(d.uid, studentObj);
      if (d.studentId) studentLookup.set(d.studentId, studentObj);
      if (d.admissionNo && d.admissionNo !== d.studentId) studentLookup.set(d.admissionNo, studentObj);
      if (d.phone) {
        studentLookup.set(d.phone, studentObj);
        const cp = String(d.phone).replace(/\D/g, "").slice(-10);
        if (cp && cp !== d.phone) studentLookup.set(cp, studentObj);
      }
      if (d.name) studentLookup.set(d.name.toLowerCase().trim(), studentObj);
    });
    emit();
  }, (err) => console.warn("[students] listen error:", err));

  return () => {
    try { unsubPayments(); } catch (_) {}
    try { unsubRenewals(); } catch (_) {}
    try { unsubStudents(); } catch (_) {}
  };
};

export const receiveDirectPayment = async (data) => {
  try {
    const { getNextReceiptNumber } = await import("./receiptService.js");
    const receiptNo = await getNextReceiptNumber();
    await addDoc(collection(db, "payments"), {
      receiptNo,
      invoiceNo: receiptNo,
      studentName: data.studentName,
      planName: data.planName,
      amount: Number(data.amount),
      paymentMethod: data.paymentMethod,
      transactionId: data.transactionId || "RC-N/A",
      status: data.status || "approved",
      date: data.date || new Date().toISOString(),
      createdAt: serverTimestamp(),
      approvedBy: data.approvedBy || "Admin",
      approvalDate: serverTimestamp()
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const approvePayment = async (paymentId, approverName) => {
  try {
    const paymentRef = doc(db, "payments", paymentId);
    const snap = await getDoc(paymentRef);
    if (!snap.exists()) throw new Error("Payment not found");
    
    const paymentData = snap.data();
    if (paymentData.status !== "pending") throw new Error("Payment is not pending.");

    // Retrieve the student with fallbacks
    let studentRef = doc(db, "students", paymentData.studentId);
    let studentSnap = await getDoc(studentRef);
    if (!studentSnap.exists()) {
      // Fallback 1: query by uid
      const qUid = query(collection(db, "students"), where("uid", "==", paymentData.studentId));
      const snapUid = await getDocs(qUid);
      if (!snapUid.empty) {
        studentRef = snapUid.docs[0].ref;
        studentSnap = snapUid.docs[0];
      } else {
        // Fallback 2: query by studentId or admissionNo
        const qId = query(collection(db, "students"), where("studentId", "==", paymentData.studentId));
        const snapId = await getDocs(qId);
        if (!snapId.empty) {
          studentRef = snapId.docs[0].ref;
          studentSnap = snapId.docs[0];
        }
      }
    }
    if (!studentSnap.exists()) throw new Error("Student record not found for ID: " + paymentData.studentId);
    const studentData = studentSnap.data();

    // Calculate new due date
    let currentDue = new Date(studentData.paymentDueDate || new Date());
    if (isNaN(currentDue.getTime())) currentDue = new Date();
    
    let newDueDateStr = paymentData.endDate;
    if (!newDueDateStr) {
      // Fallback calculation if endDate wasn't stored on the payment
      const renewalMonths = Number(paymentData.renewalPeriod || paymentData.renewalMonths) || 1;
      currentDue.setDate(1); // Reset to 1st to avoid month-end overflow
      currentDue.setMonth(currentDue.getMonth() + renewalMonths);
      const lastDay = new Date(currentDue.getFullYear(), currentDue.getMonth() + 1, 0).getDate();
      currentDue.setDate(Math.min(lastDay, currentDue.getDate()));
      newDueDateStr = currentDue.toISOString().split("T")[0];
    }

    const isPayLater = paymentData.source === "pay_later" || paymentData.isPayLater === true;
    const isAdmission = paymentData.source === "admission" || paymentData.source === "onboarding";
    const isRenewal = !isPayLater && !isAdmission && (paymentData.source === "renewal" || paymentData.renewalMonths || paymentData.renewalDays);

    // 1. Update Student Record to Active with new due date and debt cleared
    const studentUpdates = {
      paymentDueDate: newDueDateStr,
      status: "Active",
      approvalStatus: "Approved",
      debt: 0,
      updatedAt: serverTimestamp()
    };
    if (isPayLater) {
      studentUpdates.paymentStatus = "Paid";
      studentUpdates.pendingPayLaterPayment = false;
    }
    if (paymentData.startDate) studentUpdates.startDate = paymentData.startDate;
    if (paymentData.endDate) studentUpdates.endDate = paymentData.endDate;
    if (paymentData.planId) studentUpdates.planId = paymentData.planId;
    if (paymentData.planName) studentUpdates.planName = paymentData.planName;

    await updateDoc(studentRef, studentUpdates);

    // 2. Update payment document to approved with permanent receipt number
    let receiptNo = paymentData.receiptNo || "";
    try {
      const { getOrAssignReceiptNumber } = await import("./receiptService.js");
      receiptNo = await getOrAssignReceiptNumber(paymentId, paymentData);
    } catch (_) {}
    const payUpdates = {
      status: "approved",
      approvedBy: approverName,
      approvalDate: serverTimestamp()
    };
    if (receiptNo) {
      payUpdates.receiptNo = receiptNo;
      payUpdates.invoiceNo = receiptNo;
    }
    await updateDoc(paymentRef, payUpdates);

    if (isPayLater) {
      payUpdates.isPayLater = false;
    }

    // 3. Record in renewals collection ONLY for real renewals (never Pay Later or Admission)
    if (isRenewal) {
    try {
      const renDoc = {
        studentId: studentSnap.id,
        studentName: paymentData.studentName || studentData.name,
        oldPlan: studentData.planName || "",
        newPlan: paymentData.planName || studentData.planName || "",
        startDate: paymentData.startDate || studentData.startDate || "",
        endDate: paymentData.endDate || newDueDateStr,
        durationDays: Number(paymentData.durationDays || 30),
        durationMode: paymentData.durationMode || "monthly",
        amount: Number(paymentData.amount),
        paymentMethod: paymentData.paymentMethod || "UPI",
        transactionId: paymentData.transactionId || "",
        renewedBy: approverName,
        renewalNotes: "Approved online payment renewal",
        status: "Completed",
        createdAt: serverTimestamp()
      };
      const ssUrl = paymentData.screenshot || paymentData.paymentScreenshotUrl || (paymentData.screenshots && paymentData.screenshots[0]) || "";
      if (ssUrl) {
        renDoc.screenshot = ssUrl;
        renDoc.paymentScreenshotUrl = ssUrl;
        renDoc.screenshots = [ssUrl];
      }
      await addDoc(collection(db, "renewals"), renDoc);
    } catch (_) {}
    }

    // 4. Notify the student in notifications collection
    try {
      await addDoc(collection(db, "notifications"), {
        recipientId: studentData.uid || studentSnap.id,
        studentId: studentSnap.id,
        type: isRenewal ? "renewal_approved" : "payment_approved",
        title: isPayLater ? "Admission Fee Approved!" : (isAdmission ? "Admission Payment Approved!" : "Renewal Approved!"),
        message: isPayLater ? `Your admission fee payment for ${paymentData.planName || studentData.planName} has been verified and approved. Official Receipt #${receiptNo || ""} is available.` : `Your membership renewal for ${paymentData.planName || studentData.planName} has been approved. Your subscription is valid until ${newDueDateStr}. Full platform access is restored.`,
        date: new Date().toISOString(),
        read: false,
        createdAt: serverTimestamp()
      });
    } catch (_) {}
    
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const rejectPayment = async (paymentId, approverName, remark) => {
  try {
    const paymentRef = doc(db, "payments", paymentId);
    const snap = await getDoc(paymentRef);
    const paymentData = snap.exists() ? snap.data() : {};

    await updateDoc(paymentRef, {
      status: "rejected",
      approvedBy: approverName,
      approvalDate: serverTimestamp(),
      remark: remark || "Payment rejected by admin",
      rejectionReason: remark || "Payment rejected by admin"
    });

    if (paymentData.studentId) {
      try {
        await addDoc(collection(db, "notifications"), {
          recipientId: paymentData.studentId,
          studentId: paymentData.studentId,
          type: "renewal_rejected",
          title: "Renewal Payment Rejected",
          message: `Your renewal payment of ₹${paymentData.amount || ''} could not be verified: ${remark || 'Please check payment details and upload valid proof.'}`,
          date: new Date().toISOString(),
          read: false,
          createdAt: serverTimestamp()
        });
      } catch (_) {}
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// ===============================================
// DASHBOARD LISTENERS (From Part 3)
// ===============================================

/**
 * Listen to all approved payments for today and this month to calculate earnings
 */
export const listenToEarnings = (onUpdate, onError) => {
  const q = query(
    collection(db, "payments"),
    where("status", "==", "approved")
  );

  return onSnapshot(q, (snapshot) => {
    let todayEarnings = 0;
    let monthlyEarnings = 0;
    
    const now = new Date();
    const todayStr = now.toISOString().split("T")[0]; // YYYY-MM-DD
    const currentMonthStr = todayStr.substring(0, 7); // YYYY-MM

    snapshot.forEach(doc => {
      const data = doc.data();
      const amount = Number(data.amount) || 0;
      
      let paymentDateStr = "";
      if (data.approvalDate && data.approvalDate.toDate) {
        paymentDateStr = data.approvalDate.toDate().toISOString().split("T")[0];
      } else if (data.date) {
        paymentDateStr = data.date.toString().split("T")[0];
      }

      if (paymentDateStr === todayStr) {
        todayEarnings += amount;
      }
      
      if (paymentDateStr.startsWith(currentMonthStr)) {
        monthlyEarnings += amount;
      }
    });

    onUpdate({ todayEarnings, monthlyEarnings });
  }, onError);
};

/**
 * Listen to pending payments to populate the dashboard panel
 */
export const listenToPendingPayments = (onUpdate, onError) => {
  const q = query(
    collection(db, "payments"),
    where("status", "==", "pending")
  );

  return onSnapshot(q, (snapshot) => {
    const pendingList = [];
    let totalPendingToday = 0;

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    snapshot.forEach(doc => {
      const data = doc.data();
      let dueDate = data.dueDateStr ? new Date(data.dueDateStr) : new Date();
      dueDate.setHours(0, 0, 0, 0);
      
      const timeDiff = dueDate.getTime() - now.getTime();
      const daysRemaining = Math.ceil(timeDiff / (1000 * 3600 * 24));
      
      const amount = Number(data.amount) || 0;
      totalPendingToday += amount;

      pendingList.push({
        id: doc.id,
        studentName: data.studentName || "Unknown",
        seatNumber: data.seatNumber || "N/A", // Payment data might not have seat unless we added it
        amount: amount,
        dueDateStr: data.dueDateStr || "N/A",
        daysRemaining: daysRemaining,
        isOverdue: daysRemaining < 0
      });
    });

    pendingList.sort((a, b) => {
      if (a.isOverdue && !b.isOverdue) return -1;
      if (!a.isOverdue && b.isOverdue) return 1;
      return a.daysRemaining - b.daysRemaining;
    });

    onUpdate({ pendingList, totalPendingToday });
  }, onError);
};


/**
 * Directly collects and settles a Pay Later fee from Admin console.
 * Updates student profile to Paid (cash or UPI), assigns receipt number, and marks payment approved.
 */
export const collectPayLaterPayment = async (recordId, amount, paymentMethod = "Cash", transactionId = "", approverName = "Admin") => {
  try {
    let studentId = recordId;
    if (String(recordId).startsWith("admission_")) {
      studentId = recordId.replace("admission_", "");
    } else if (String(recordId).startsWith("adm_")) {
      studentId = recordId.replace("adm_", "");
    }

    let studentRef = doc(db, "students", studentId);
    let studentSnap = await getDoc(studentRef);

    if (!studentSnap.exists()) {
      const payRef = doc(db, "payments", recordId);
      const paySnap = await getDoc(payRef);
      if (paySnap.exists()) {
        studentId = paySnap.data().studentId;
        studentRef = doc(db, "students", studentId);
        studentSnap = await getDoc(studentRef);
      }
    }

    if (!studentSnap.exists()) {
      const qUid = query(collection(db, "students"), where("uid", "==", studentId));
      const snapUid = await getDocs(qUid);
      if (!snapUid.empty) {
        studentRef = snapUid.docs[0].ref;
        studentSnap = snapUid.docs[0];
      }
    }

    if (!studentSnap.exists()) throw new Error("Student record not found for: " + recordId);
    const sData = studentSnap.data();

    const isCash = paymentMethod === "Cash" || paymentMethod === "Paid (Cash)";
    const cleanTxn = isCash
      ? (transactionId && String(transactionId).trim() ? String(transactionId).trim() : "CASH")
      : (transactionId && String(transactionId).trim() ? String(transactionId).trim() : "UPI-DESK");

    const finalAmount = Number(amount) || Number(sData.amount || sData.planPrice || sData.fee || 1000);

    const { getNextReceiptNumber } = await import("./receiptService.js");
    const receiptNo = await getNextReceiptNumber();

    const targetPaymentId = (recordId && !recordId.startsWith("admission_") && !recordId.startsWith("adm_"))
      ? recordId
      : ("adm_" + studentSnap.id);

    // 1. Update/set single canonical payment in payments collection
    const paymentDoc = {
      studentId: studentSnap.id,
      studentUid: sData.uid || studentSnap.id,
      studentNo: sData.studentId || sData.admissionNo || "",
      studentName: sData.name || "Student",
      studentPhone: sData.phone || "",
      seatNumber: sData.seatNumber || sData.seatAssigned || "",
      seatFloor: sData.seatFloor || "",
      planId: sData.planId || "",
      planName: sData.planName || "Regular Fixed Seat",
      amount: finalAmount,
      paymentMethod: isCash ? "Cash" : "UPI",
      transactionId: cleanTxn,
      receiptNo,
      invoiceNo: receiptNo,
      source: "pay_later",
      status: "approved",
      isPayLater: false,
      startDate: sData.startDate || "",
      endDate: sData.endDate || sData.paymentDueDate || "",
      dueDateStr: sData.endDate || sData.paymentDueDate || "",
      date: new Date().toISOString(),
      createdAt: serverTimestamp(),
      approvedBy: approverName || "Admin",
      approvalDate: serverTimestamp()
    };
    await setDoc(doc(db, "payments", targetPaymentId), paymentDoc, { merge: true });

    // 2. Update Student document: mark paid, remove pay later flag, clear debt
    await updateDoc(studentRef, {
      paymentMethod: isCash ? "Cash" : "UPI",
      transactionId: cleanTxn,
      isPayLater: false,
      pendingPayLaterPayment: false,
      status: "Active",
      approvalStatus: "Approved",
      paymentDueDate: sData.endDate || sData.paymentDueDate || "",
      debt: 0,
      lastPayLaterPaymentId: targetPaymentId,
      updatedAt: serverTimestamp()
    });

    // 3. Notify student (Pay later fee settled, NOT a renewal)
    try {
      await addDoc(collection(db, "notifications"), {
        recipientId: sData.uid || studentSnap.id,
        studentId: studentSnap.id,
        type: "payment_approved",
        title: "Admission Fee Paid",
        message: "Your admission fee of Rs. " + finalAmount + " has been collected via " + (isCash ? "Cash" : "UPI") + ". Official Receipt #" + receiptNo + " is available.",
        date: new Date().toISOString(),
        read: false,
        createdAt: serverTimestamp()
      });
    } catch (_) {}

    return { success: true, receiptNo, paymentId: targetPaymentId };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
