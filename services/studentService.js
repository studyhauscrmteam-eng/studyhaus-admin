import { collection, doc, updateDoc, onSnapshot, getDocs, query, where, serverTimestamp, getDoc, addDoc, setDoc, deleteDoc, deleteField } from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword, updatePassword, signOut } from "firebase/auth";
import { initializeApp, deleteApp } from "firebase/app";
import { db } from "../firebase/firebase.js";
import { firebaseConfig } from "../config/firebaseConfig.js";
import { phoneToAuthEmail } from "./phoneUtils.js";

// Vercel backend (same host as the public website). CORS is open there, so
// the portal passes the caller's own ID token for authorisation.
const API_BASE = "https://www.shreejilibrary.co.in/api";

/**
 * Kill the Firebase Auth credential for a student — plus everything only the
 * server may touch (history rows, the seat, uniqueness claims).
 *
 * The browser SDK has NO way to delete an Auth user, which is exactly why a
 * student "deleted" from the admin portal could still sign in. The server
 * route `api/index.js -> POST /api/students/purge` owns the Admin SDK, so it
 * does the credential first and refuses unless the caller is Owner/Admin.
 *
 * @returns {Promise<{ok: boolean, removed?: object, error?: string}>}
 */
export const purgeStudentOnServer = async (studentId) => {
  try {
    const user = getAuth().currentUser;
    if (!user) return { ok: false, error: "You are not signed in." };
    const token = await user.getIdToken();
    const res = await fetch(`${API_BASE}/students/purge`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ studentId }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body.error || `Server refused (HTTP ${res.status}).` };
    return { ok: true, removed: body.removed || {} };
  } catch (e) {
    return { ok: false, error: e.message || "Could not reach the server." };
  }
};

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
 * `fullWipe: true` (student-card "Delete permanently") goes further: every
 * trace of the person is removed, while MONEY STAYS COUNTED — payments,
 * renewals, attendance and complaints are kept as anonymous rows (amounts,
 * dates, plans intact; names/phones/emails scrubbed) so dashboard totals
 * and revenue math never change. Message logs, notifications, queued mail,
 * re-admission uniqueness claims and matching visitor leads are deleted.
 *
 * @param {string} studentId
 * @param {{ wipeHistory?: boolean, fullWipe?: boolean }} opts
 */
export const permanentlyDeleteStudent = async (studentId, opts = {}) => {
  const { wipeHistory = false, fullWipe = false } = opts;
  const warnings = [];
  const note = (m) => warnings.push(m);
  try {
    if (!studentId) throw new Error("Missing student ID.");
    const snap = await getDoc(doc(db, "students", studentId));
    if (!snap.exists()) throw new Error("Student record not found.");
    const data = snap.data() || {};

    // 0. Credential FIRST, while the record still exists to identify the
    // account. The browser cannot delete a Firebase Auth user, and deleting
    // the documents before the login was revoked is exactly the half-state
    // that let "deleted" students keep opening the portal. If the server
    // refuses, abort — we never leave docs gone but login alive.
    const purge = await purgeStudentOnServer(studentId);
    if (!purge.ok) {
      throw new Error(
        `Portal login could not be removed (${purge.error || "unknown error"}). ` +
        "Nothing was deleted — fix that first or the student could still sign in."
      );
    }

    // 1. Free the seat (if one is assigned) — legacy A/B safe + holder-safe
    try {
      const heldSnap = await getDocs(query(collection(db, "seats"), where("assignedStudentId", "==", studentId)));
      for (const d of heldSnap.docs) {
        await updateDoc(d.ref, {
          status: "Available",
          assignedStudentId: null,
          assignedStudentName: null,
          planType: null,
          lastUpdated: serverTimestamp()
        });
      }
      const seatNo = data.seatNumber || data.seatAssigned || "";
      if (seatNo) {
        const stripPlain = (v) => {
          const raw = String(v == null ? "" : v).trim().toUpperCase().replace(/\s+/g, "");
          const m = raw.match(/^[AB]?0*(\d+)[AB]?$/);
          return m ? String(Number(m[1])) : String(v);
        };
        // Floor-aware: use the student's floor to find the correct seat
        const studentFloor = data.seatFloor || "Ground Floor";
        for (const key of [String(seatNo), stripPlain(seatNo)]) {
          try {
            const seatSnap = await getDocs(query(
              collection(db, "seats"),
              where("seatNumber", "==", key),
              where("floor", "==", studentFloor)
            ));
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
          } catch (_) { /* best-effort */ }
        }
      }
    } catch (_) { /* seat release is best-effort */ }

    // 2. History collections: tag, wipe, or anonymize (fullWipe keeps money counted)
    const historyCols = ["payments", "attendance", "complaints", "renewals", "documents"];
    for (const colName of historyCols) {
      try {
        const hSnap = await getDocs(query(collection(db, colName), where("studentId", "==", studentId)));
        for (const d of hSnap.docs) {
          try {
            if (wipeHistory) {
              await deleteDoc(d.ref);
            } else if (fullWipe) {
              if (colName === "documents") {
                await deleteDoc(d.ref); // base64 images are pure PII
              } else {
                await updateDoc(d.ref, {
                  studentName: "Deleted student",
                  studentPhone: "",
                  phone: "",
                  email: "",
                  parentPhone: "",
                  studentDeleted: true,
                  anonymizedAt: serverTimestamp(),
                  updatedAt: serverTimestamp(),
                });
              }
            } else {
              await updateDoc(d.ref, { studentDeleted: true, updatedAt: serverTimestamp() });
            }
          } catch (e) {
            note(`${colName}: ${e.message || e}`);
          }
        }
      } catch (_) { /* collection may be empty or denied — skip */ }
    }

    if (fullWipe) {
      // 2b. Every other trace of this person — safe to delete outright.
      const wipeQueries = [
        ["messageLogs", where("studentId", "==", studentId)],
        ["notifications", where("studentId", "==", studentId)],
        ["notifications", where("admissionId", "==", studentId)],
        ["mail", where("meta.studentId", "==", studentId)],
        ["mail", where("meta.admissionId", "==", studentId)],
        ["globalDocuments", where("studentId", "==", studentId)],
      ];
      for (const [colName, cond] of wipeQueries) {
        try {
          const s = await getDocs(query(collection(db, colName), cond));
          for (const d of s.docs) {
            try { await deleteDoc(d.ref); }
            catch (e) { note(`${colName}: ${e.message || e}`); }
          }
        } catch (_) { /* empty or denied — skip */ }
      }
      // 2c. Re-admission claims (phone/email) so the person can rejoin later.
      // txn_* claims stay: anonymized money rows still reference those txn ids.
      const claimIds = [];
      const phoneDigits = String(data.phone || "").replace(/\D/g, "").slice(-10);
      if (phoneDigits) claimIds.push(`req_adm_${phoneDigits}`);
      const emailKey = String(data.email || "").trim().toLowerCase();
      if (emailKey) claimIds.push(`req_admmail_${emailKey}`);
      for (const cid of claimIds) {
        try { await deleteDoc(doc(db, "uniqueness", cid)); }
        catch (_) { /* may not exist — fine */ }
      }
      // 2d. Matching visitor leads (same phone/email are this person's data).
      try {
        const seenV = new Set();
        const conds = [];
        if (data.phone) conds.push(where("phone", "==", data.phone));
        if (data.email) conds.push(where("email", "==", data.email));
        for (const cond of conds) {
          try {
            const vs = await getDocs(query(collection(db, "visitors"), cond));
            for (const d of vs.docs) {
              if (seenV.has(d.id)) continue;
              seenV.add(d.id);
              try { await deleteDoc(d.ref); }
              catch (e) { note(`visitors: ${e.message || e}`); }
            }
          } catch (_) { /* skip */ }
        }
      } catch (_) { /* best-effort */ }
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

    return { success: true, name: data.name || "", warnings };
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

/**
 * Change a student's portal password WITHOUT ever displaying the old one.
 *
 * The STORED old password authenticates a sign-in on a SECONDARY Firebase app
 * instance (same trick `createPortalAccount` uses — the signed-in admin
 * session is never touched), `updatePassword` applies the new password while
 * that fresh sign-in satisfies Firebase's recent-login requirement, and only
 * then are the stored copies on the student doc rewritten to match.
 *
 * @param {string} studentId - students doc id (auto-id or uid)
 * @param {string} newPassword - at least 6 characters
 * @returns {Promise<void>}
 */
export const resetPortalPassword = async (studentId, newPassword) => {
  const pass = String(newPassword || "").trim();
  if (!pass || pass.length < 6) throw new Error("Portal password must be at least 6 characters.");

  const snap = await getDoc(doc(db, "students", studentId));
  if (!snap.exists()) throw new Error("Student record not found.");
  const data = snap.data();

  const rawCred = data.loginCredentials ? String(data.loginCredentials) : "";
  const slashIdx = rawCred.indexOf("/");
  const loginId = String(data.loginId || (slashIdx !== -1 ? rawCred.slice(0, slashIdx) : "")).trim();
  const oldPass = String(data.loginPassword || (slashIdx !== -1 ? rawCred.slice(slashIdx + 1) : "")).trim();
  if (!loginId || !oldPass) {
    throw new Error("No stored password to change — use \"Clear login\", then create a fresh login instead.");
  }

  const isPhone = /^[\d\s\-\+\(\)]{10,}$/.test(loginId);
  const authEmail = isPhone ? phoneToAuthEmail(loginId) : loginId.toLowerCase();

  const secondaryApp = initializeApp(firebaseConfig, `reset-pass-${Date.now()}`);
  try {
    const secondaryAuth = getAuth(secondaryApp);
    const cred = await signInWithEmailAndPassword(secondaryAuth, authEmail, oldPass);
    await updatePassword(cred.user, pass);
    await signOut(secondaryAuth).catch(() => {});
  } catch (error) {
    const code = error?.code || "";
    if (code === "auth/invalid-credential" || code === "auth/user-not-found" || code === "auth/wrong-password") {
      throw new Error("The stored password no longer matches the account — use \"Clear login\", then create a fresh login with the new password.");
    }
    throw new Error(error?.message || "Could not update the password.");
  } finally {
    await deleteApp(secondaryApp).catch(() => {});
  }

  await updateDoc(doc(db, "students", studentId), {
    loginPassword: pass,
    loginCredentials: `${loginId} / ${pass}`,
    updatedAt: serverTimestamp()
  });
};

export const createPortalLoginForStudent = async (studentId, loginId, loginPassword) => {
  const { createPortalAccount } = await import("./authService.js");
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
          
          // 1. Release old seat (floor-aware)
          if (oldData.seatNumber) {
            const oldFloor = oldData.seatFloor || "Ground Floor";
            const qOld = query(
              seatsRef,
              where("seatNumber", "==", oldData.seatNumber),
              where("floor", "==", oldFloor)
            );
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
          
          // 2. Reserve new seat (plain numbers: "A20" -> "20"; floor-aware so
          // duplicate 20s on different floors don't collide)
          if (updates.seatNumber) {
            const stripPlain = (v) => {
              const raw = String(v == null ? "" : v).trim().toUpperCase().replace(/\s+/g, "");
              const m = raw.match(/^[AB]?0*(\d+)[AB]?$/);
              if (m) return String(Number(m[1]));
              const m2 = raw.match(/^([A-Z]+)-?0*(\d+)$/);
              if (m2) return String(Number(m2[2]));
              return raw;
            };
            const normedSeat = stripPlain(updates.seatNumber);
            const legacyFloor = (() => {
              const raw = String(updates.seatNumber).trim().toUpperCase().replace(/\s+/g, "");
              if (/^B\d/.test(raw) || /\dB$/.test(raw)) return "First Floor";
              return null;
            })();
            const floor = updates.seatFloor || oldData.seatFloor || legacyFloor || "Ground Floor";
            const qNew = query(
              seatsRef,
              where("seatNumber", "==", normedSeat),
              where("floor", "==", floor)
            );
            const newSnap = await getDocs(qNew);
            const floorMatch = newSnap.docs.find(d => ((d.data() || {}).floor || "Ground Floor") === floor)
              || (newSnap.docs.length === 1 ? newSnap.docs[0] : null);
            if (floorMatch) {
              await updateDoc(doc(db, "seats", floorMatch.id), {
                status: "Reserved",
                assignedStudentId: studentId,
                assignedStudentName: updates.name || oldData.name || "Unknown",
                planType: updates.planName || oldData.planName || "Unknown",
                lastUpdated: serverTimestamp()
              });
            } else if (newSnap.empty) {
              // Create the seat if it doesn't exist (deterministic floor-aware id)
              const docId = (floor === "First Floor" ? `first-${normedSeat}` : `ground-${normedSeat}`);
              await setDoc(doc(seatsRef, docId), {
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
            updates.seatFloor = floor;
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
