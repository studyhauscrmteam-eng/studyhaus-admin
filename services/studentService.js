import { collection, doc, updateDoc, onSnapshot, getDocs, query, where, serverTimestamp, getDoc, addDoc, setDoc, deleteDoc, deleteField } from "firebase/firestore";
import { db } from "../firebase/firebase.js";

/**
 * Validates updates to ensure no duplicates for Phone/Email/Student ID
 * (Except for the current student being edited)
 */
const validateStudentUpdate = async (id, updates) => {
  const studentsRef = collection(db, "students");
  
  if (updates.phone) {
    const q = query(studentsRef, where("phone", "==", updates.phone));
    const snap = await getDocs(q);
    const duplicate = snap.docs.find(d => d.id !== id);
    if (duplicate) throw new Error(`Phone number ${updates.phone} is already in use.`);
  }

  if (updates.email) {
    const q = query(studentsRef, where("email", "==", updates.email));
    const snap = await getDocs(q);
    const duplicate = snap.docs.find(d => d.id !== id);
    if (duplicate) throw new Error(`Email ${updates.email} is already in use.`);
  }

  if (updates.studentId) {
    const q = query(studentsRef, where("studentId", "==", updates.studentId));
    const snap = await getDocs(q);
    const duplicate = snap.docs.find(d => d.id !== id);
    if (duplicate) throw new Error(`Student ID ${updates.studentId} is already in use.`);
  }
};

/**
 * Listens to all active/pending/inactive students for the grid
 */
export const listenToAllStudents = (onUpdate, onError) => {
  const studentsRef = collection(db, "students");
  
  return onSnapshot(studentsRef, (snapshot) => {
    const students = [];
    snapshot.forEach(doc => {
      students.push({ id: doc.id, ...doc.data() });
    });
    onUpdate(students);
  }, onError);
};

/**
 * Soft Delete a student
 */
export const softDeleteStudent = async (studentId) => {
  try {
    const docRef = doc(db, "students", studentId);
    await updateDoc(docRef, {
      status: "Old",
      updatedAt: serverTimestamp()
    });
    try {
      const userDocRef = doc(db, "users", studentId);
      await updateDoc(userDocRef, { status: "Old", updatedAt: serverTimestamp() });
    } catch(e) {}
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

/**
 * PERMANENTLY delete a student and all of their linked records.
 * This is irreversible: removes students/{id}, users/{id} (if present),
 * studentDocuments/{id}, any admissions/{id} entry, and frees the seat.
 * Related history (payments, attendance, renewals, complaints) is re-tagged
 * with `studentDeleted: true` and kept for accounts, unless `wipeHistory`
 * is true — pass wipeHistory only when the record was created by mistake.
 *
 * @param {string} studentId
 * @param {{ wipeHistory?: boolean }} opts
 */
export const permanentlyDeleteStudent = async (studentId, opts = {}) => {
  const { wipeHistory = false } = opts;
  try {
    if (!studentId) throw new Error("Missing student ID.");
    const snap = await getDoc(doc(db, "students", studentId));
    if (!snap.exists()) throw new Error("Student record not found.");
    const data = snap.data() || {};

    // 1. Free the seat (if one is assigned)
    const seatNo = data.seatNumber || data.seatAssigned || "";
    if (seatNo) {
      try {
        const seatSnap = await getDocs(query(collection(db, "seats"), where("seatNumber", "==", seatNo)));
        for (const d of seatSnap.docs) {
          const sd = d.data() || {};
          if (!sd.assignedStudentId || sd.assignedStudentId === studentId) {
            await updateDoc(d.ref, {
              status: "Available",
              assignedStudentId: null,
              assignedStudentName: null,
              planType: null,
              lastUpdated: serverTimestamp()
            });
          }
        }
      } catch (_) { /* seat release is best-effort */ }
    }

    // 2. History collections: tag or wipe
    const historyCols = ["payments", "attendance", "complaints", "renewals", "documents"];
    for (const colName of historyCols) {
      try {
        const hSnap = await getDocs(query(collection(db, colName), where("studentId", "==", studentId)));
        for (const d of hSnap.docs) {
          if (wipeHistory) await deleteDoc(d.ref);
          else await updateDoc(d.ref, { studentDeleted: true, updatedAt: serverTimestamp() });
        }
      } catch (_) { /* collection may be empty or denied — skip */ }
    }

    // 3. Delete linked docs (each best-effort so one failure never half-leaves)
    const linkedRefs = [
      doc(db, "students", studentId),
      doc(db, "users", studentId),
      doc(db, "studentDocuments", studentId),
      doc(db, "admissions", studentId),
    ];
    for (const ref of linkedRefs) {
      try { await deleteDoc(ref); } catch (_) { /* may not exist — fine */ }
    }

    return { success: true, name: data.name || "" };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

/**
 * Create the Student Portal login for an EXISTING student (admin sets the
 * Login ID + Password from the Student Info popup).
 *
 * The portal and auth guard look up students/{uid}, so once the Firebase
 * Auth account exists we migrate the student document from its old auto-id
 * to the uid and repoint every reference (payments, attendance, seat, ...).
 *
 * @returns {Promise<{uid, authEmail, loginCredentials}>}
 */
/**
 * Remove a student's portal login completely: delete every login-related
 * field (credentials, uid/authEmail link, retired flag). Profile, payments,
 * seat and documents stay untouched. What the card shows afterwards is
 * exactly what the doc holds: nothing.
 * Sign-in is refused for credential-less student docs by resolveUserRole.
 */
export const clearPortalCredentials = async (studentId) => {
  await updateDoc(doc(db, "students", studentId), {
    loginId: deleteField(),
    loginPassword: deleteField(),
    loginCredentials: deleteField(),
    uid: deleteField(),
    authEmail: deleteField(),
    loginRevoked: deleteField()
  });
};

export const createPortalLoginForStudent = async (studentId, loginId, loginPassword) => {
  const { createPortalAccount } = await import("./authService.js?v=login5");
  const account = await createPortalAccount(loginId, loginPassword); // throws with a clear message

  const oldRef = doc(db, "students", studentId);
  const snap = await getDoc(oldRef);
  if (!snap.exists()) throw new Error("Student record not found.");
  const data = snap.data();
  if (data.uid && data.uid !== account.uid) {
    throw new Error("This student is already linked to a different portal account.");
  }
  if (studentId !== account.uid) {
    const existingAtUid = await getDoc(doc(db, "students", account.uid));
    if (existingAtUid.exists()) {
      throw new Error("These login credentials already belong to a different student. Use that student's own Login ID, or pick a different Login ID.");
    }
  }

  const loginCredentials = `${loginId} / ${loginPassword}`;
  const payload = {
    ...data,
    uid: account.uid,
    authEmail: account.authEmail,
    loginId,
    loginPassword,
    loginCredentials,
    updatedAt: serverTimestamp()
  };

  // Already keyed by this uid — update in place (never write then delete the
  // same document reference).
  if (studentId === account.uid) {
    await updateDoc(oldRef, payload);
    return { uid: account.uid, authEmail: account.authEmail, loginCredentials };
  }

  // 1. Create the uid-keyed document (portal reads students/{uid})
  const newRef = doc(db, "students", account.uid);
  await setDoc(newRef, payload);

  // 2. Repoint references old id -> uid
  const refCollections = ["payments", "attendance", "complaints", "renewals", "documents"];
  for (const colName of refCollections) {
    try {
      const snap2 = await getDocs(query(collection(db, colName), where("studentId", "==", studentId)));
      for (const d of snap2.docs) await updateDoc(d.ref, { studentId: account.uid });
    } catch (_) { /* collection may be empty or denied — skip */ }
  }
  try {
    const seatSnap = await getDocs(query(collection(db, "seats"), where("assignedStudentId", "==", studentId)));
    for (const d of seatSnap.docs) await updateDoc(d.ref, { assignedStudentId: account.uid });
  } catch (_) { /* no seat linked */ }

  // studentDocuments is keyed BY the student id — move the doc
  try {
    const docsOldRef = doc(db, "studentDocuments", studentId);
    const docsSnap = await getDoc(docsOldRef);
    if (docsSnap.exists()) {
      await setDoc(doc(db, "studentDocuments", account.uid), docsSnap.data());
      await deleteDoc(docsOldRef);
    }
  } catch (_) { /* no documents stored */ }

  // 3. Remove the old auto-id student document
  await deleteDoc(oldRef);

  return { uid: account.uid, authEmail: account.authEmail, loginCredentials };
};

/**
 * Update a student's profile
 */
export const updateStudentProfile = async (studentId, updates) => {
  try {
    await validateStudentUpdate(studentId, updates);
    updates.updatedAt = serverTimestamp();
    const docRef = doc(db, "students", studentId);
    
    // Check if seatNumber is being updated
    if (updates.seatNumber !== undefined) {
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const oldData = snap.data();
        if (oldData.seatNumber !== updates.seatNumber) {
          const seatsRef = collection(db, "seats");
          
          // 1. Release old seat
          if (oldData.seatNumber) {
            const qOld = query(seatsRef, where("seatNumber", "==", oldData.seatNumber));
            const oldSnap = await getDocs(qOld);
            if (!oldSnap.empty) {
              await updateDoc(doc(db, "seats", oldSnap.docs[0].id), {
                status: "Available",
                assignedStudentId: null,
                assignedStudentName: null,
                planType: null,
                lastUpdated: serverTimestamp()
              });
            }
          }
          
          // 2. Reserve new seat (name normalized so "A01" finds "A1" instead
          // of cloning a duplicate; deterministic ID as final backstop)
          if (updates.seatNumber) {
            const normedSeat = String(updates.seatNumber).trim().toUpperCase().replace(/\s+/g, "").replace(/^([A-Z]+)-?0*(\d+)$/, (_, p, n) => `${p}${Number(n)}`);
            const qNew = query(seatsRef, where("seatNumber", "==", normedSeat));
            const newSnap = await getDocs(qNew);
            if (!newSnap.empty) {
              await updateDoc(doc(db, "seats", newSnap.docs[0].id), {
                status: "Reserved",
                assignedStudentId: studentId,
                assignedStudentName: updates.name || oldData.name || "Unknown",
                planType: updates.planName || oldData.planName || "Unknown",
                lastUpdated: serverTimestamp()
              });
            } else {
              // Create the seat if it doesn't exist
              let floor = "Ground Floor";
              if (normedSeat.startsWith("B")) floor = "First Floor";

              await setDoc(doc(seatsRef, normedSeat), {
                seatNumber: normedSeat,
                floor: floor,
                status: "Reserved",
                assignedStudentId: studentId,
                assignedStudentName: updates.name || oldData.name || "Unknown",
                planType: updates.planName || oldData.planName || "Unknown",
                lastUpdated: serverTimestamp()
              });
            }
            updates.seatNumber = normedSeat;
          }
        }
      }
    }

    await updateDoc(docRef, updates);
    
    if (updates.status !== undefined) {
      try {
        const userDocRef = doc(db, "users", studentId);
        await updateDoc(userDocRef, { status: updates.status, updatedAt: serverTimestamp() });
      } catch (e) {}
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
