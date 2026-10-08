/**
 * Firestore security-rules behaviour test — emulator only.
 *
 *   firebase emulators:exec --only auth,firestore --project demo-shreeji \
 *       "node scripts/test-rules.mjs"
 *
 * `demo-shreeji` is a demo project: no credentials are needed, production data
 * is never reached, and the in-memory emulator is wiped after every run.
 *
 * These are the assertions the whole redesign rests on:
 *   - the website can still CREATE a lead (anon) but never read the collection
 *   - a student creates and edits their OWN record, but can never
 *     self-approve, self-number, or rewrite their credentials
 *   - a free seat stored with `assignedStudentId: null` CAN be reserved
 *   - a student can CREATE a uniqueness claim but never re-point one
 *   - an unclaimed legacy record is adoptable ONLY by the person whose auth
 *     identity provably matches it  (this is what prevents duplicate records)
 *   - staff approval still works end to end
 */
import { initializeApp } from "firebase/app";
import {
  getAuth, connectAuthEmulator, createUserWithEmailAndPassword,
  signInAnonymously, signInWithEmailAndPassword, signOut
} from "firebase/auth";
import {
  getFirestore, connectFirestoreEmulator, collection, doc,
  setDoc, getDoc, updateDoc, runTransaction, serverTimestamp
} from "firebase/firestore";

const PROJECT = "demo-shreeji";

const app = initializeApp({ apiKey: "demo-key", projectId: PROJECT });
const auth = getAuth(app);
const db = getFirestore(app);

const [fh, fp] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080").split(":");
connectFirestoreEmulator(db, fh, Number(fp));
const [ah, ap] = (process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099").split(":");
connectAuthEmulator(auth, `http://${ah}:${ap}`, { disableWarnings: true });

let pass = 0;
const failures = [];
const ok = (label) => { pass++; console.log(`  PASS  ${label}`); };
const bad = (label, err) => {
  failures.push(label);
  console.log(`  FAIL  ${label}\n        ${(err && (err.message || err.code)) || err}`);
};

/** The write must be allowed by the rules. */
async function expectOk(label, fn) {
  try { await fn(); ok(label); }
  catch (e) { bad(label, e); }
}

/** The rules must reject it (a successful write is a test failure). */
async function expectDenied(label, fn) {
  try {
    await fn();
    bad(label, "NOT DENIED — rules allowed a write they must block");
  } catch (e) {
    const denied = e && (e.code === "permission-denied" || /insufficient permissions/i.test(e.message || ""));
    if (denied) ok(label);
    else bad(label, e);
  }
}

/** Create an Auth account and LEAVE IT SIGNED IN as that user. */
async function signInNew(email, password) {
  try {
    await createUserWithEmailAndPassword(auth, email, password);
  } catch (e) {
    if (e.code !== "auth/email-already-in-use") throw e;
    await signInWithEmailAndPassword(auth, email, password);
  }
  return auth.currentUser;
}

async function main() {
  console.log(`\n=== firestore rules · ${PROJECT} ===\n`);

  /* ------------------------------------------------------- 1. website lead */
  console.log("website lead capture");
  await signInAnonymously(auth);
  const leadRef = doc(collection(db, "visitors"));
  const lead = {
    visitorName: "Test Student",
    phone: "9876543210",
    email: "lead@example.com",
    message: "I want the annual plan",
    purpose: "Membership",
    planId: "", planName: "Annual",
    source: "Website", leadStatus: "New", status: "Active",
    visitDate: "2026-10-08", visitTime: "10:00",
    createdAt: serverTimestamp()
  };
  await expectOk("anon can CREATE a Website lead", () => setDoc(leadRef, lead));
  await expectDenied("anon can NOT read a visitor row", () => getDoc(leadRef));
  await expectDenied("anon can NOT edit a visitor row", () => updateDoc(leadRef, { leadStatus: "Converted" }));
  await signOut(auth);

  /* --------------------------------------------------------- 2. fixtures */
  console.log("\nfixtures (staff)");
  const staff = await signInNew("staff1@test.local", "password123");
  await expectOk("staff can create own users/{uid}", () =>
    setDoc(doc(db, "users", staff.uid), { uid: staff.uid, role: "Owner/Admin", status: "Active" }));
  await expectOk("staff can seed a free seat with holder=null", () =>
    setDoc(doc(db, "seats", "A99"), {
      seatNumber: "A99", floor: "Ground Floor", col: 99, row: 1,
      status: "Available", assignedStudentId: null, assignedStudentName: null,
      planType: null, lastUpdated: serverTimestamp()
    }));
  await expectOk("staff can seed an unclaimed legacy record", () =>
    setDoc(doc(db, "students", "legacy1"), {
      uid: "", name: "Legacy Person", phone: "9999999999", email: "",
      role: "Student", status: "Pending", approvalStatus: "Pending",
      studentId: "SH-0001", admissionNo: "SH-0001"
    }));
  // Legacy identity documents — adoption must be able to MOVE this one.
  await expectOk("staff can seed legacy identity documents", () =>
    setDoc(doc(db, "studentDocuments", "legacy1"), {
      studentId: "legacy1", aadhaarFront: "legacy-front", aadhaarBack: "legacy-back",
      photo: "legacy-photo"
    }));
  await expectOk("staff can put a seat into Maintenance", () =>
    setDoc(doc(db, "seats", "A98"), {
      seatNumber: "A98", floor: "Ground Floor", col: 98, row: 1,
      status: "Maintenance", assignedStudentId: null, assignedStudentName: null,
      planType: null, lastUpdated: serverTimestamp()
    }));
  await signOut(auth);

  /* ------------------------------------------------------- 3. self-service */
  console.log("\nstudent self-service");
  const me = await signInNew("applicant@test.local", "password123");

  await expectOk("applicant can CREATE students/{own-uid}", () =>
    setDoc(doc(db, "students", me.uid), {
      uid: me.uid, authEmail: "applicant@test.local", loginId: "applicant@test.local",
      name: "Applicant", phone: "9876543210", email: "",
      dob: "2004-01-01", gender: "Male", college: "Test College", course: "B.Com",
      address: "Somewhere", planId: "", planName: "",
      paymentMethod: "Pay Later", paymentDueDate: "2026-10-11",
      status: "Pending", approvalStatus: "Pending", role: "Student",
      studentId: "SH-0042", admissionNo: "SH-0042",
      createdAt: serverTimestamp()
    }));

  await expectOk("applicant can edit their own profile", () =>
    updateDoc(doc(db, "students", me.uid), { name: "Applicant Renamed", remarks: "goal" }));

  await expectOk("applicant can record their payment choice", () =>
    updateDoc(doc(db, "students", me.uid), {
      paymentMethod: "Paid", transactionId: "UTR12345", paymentDueDate: ""
    }));

  await expectDenied("applicant can NOT self-approve", () =>
    updateDoc(doc(db, "students", me.uid), { approvalStatus: "Approved" }));

  await expectDenied("applicant can NOT mark themselves Active", () =>
    updateDoc(doc(db, "students", me.uid), { status: "Active" }));

  await expectDenied("applicant can NOT assign their own studentId", () =>
    updateDoc(doc(db, "students", me.uid), { studentId: "SH-9999" }));

  await expectDenied("applicant can NOT rewrite their loginPassword", () =>
    updateDoc(doc(db, "students", me.uid), { loginPassword: "hacked" }));

  await expectDenied("applicant can NOT flag their record as merged away", () =>
    updateDoc(doc(db, "students", me.uid), { mergedInto: "students/x" }));

  await expectDenied("applicant can NOT touch ANOTHER student", () =>
    updateDoc(doc(db, "students", "someone-else"), { name: "hijacked" }));

  /* -------------------------------------------------------------- 4. seats */
  console.log("\nseat reservation (the null-holder bug)");
  await expectOk("applicant can reserve a free seat whose holder is null", () =>
    updateDoc(doc(db, "seats", "A99"), {
      status: "Reserved",
      assignedStudentId: me.uid,
      assignedStudentName: "Applicant",
      lastUpdated: serverTimestamp()
    }));

  const other = await signInNew("applicant2@test.local", "password123");
  await expectDenied("a second student can NOT take a held seat", () =>
    updateDoc(doc(db, "seats", "A99"), {
      status: "Reserved", assignedStudentId: other.uid,
      assignedStudentName: "Other", lastUpdated: serverTimestamp()
    }));
  await expectDenied("a student can NOT re-key a seat", () =>
    updateDoc(doc(db, "seats", "A99"), { seatNumber: "HACKED" }));
  await expectDenied("a student can NOT create a seat", () =>
    setDoc(doc(db, "seats", "ZZZ"), { seatNumber: "ZZZ", status: "Available" }));
  await expectDenied("a student can NOT un-Maintenance a seat", () =>
    updateDoc(doc(db, "seats", "A98"), {
      status: "Available", lastUpdated: serverTimestamp()
    }));
  await signOut(auth);

  /* -------------------------------------------------------- 5. uniqueness */
  console.log("\nuniqueness claims");
  await signInNew("applicant@test.local", "password123");
  await expectOk("applicant can CREATE an email claim", () =>
    setDoc(doc(db, "uniqueness", "email_applicant@test.local"), {
      kind: "email", uid: me.uid, ownerPath: "students/" + me.uid, createdAt: serverTimestamp()
    }));
  await expectDenied("applicant can NOT re-point an existing email claim", () =>
    updateDoc(doc(db, "uniqueness", "email_applicant@test.local"), { ownerPath: "students/hacked" }));

  await expectOk("applicant can CREATE a transactionId claim", () =>
    setDoc(doc(db, "uniqueness", "txn_utr12345"), {
      kind: "transactionId", ownerPath: "students/" + me.uid, createdAt: serverTimestamp()
    }));
  await expectDenied("applicant can NOT rewrite that transactionId claim", () =>
    updateDoc(doc(db, "uniqueness", "txn_utr12345"), { ownerPath: "students/other" }));
  await expectDenied("applicant can NOT claim a bogus kind", () =>
    setDoc(doc(db, "uniqueness", "nonsense"), { kind: "everything", uid: me.uid }));
  await signOut(auth);

  /* --------------------------------------------------------- 6. adoption */
  console.log("\nadoption (this is what stops duplicate records)");

  const stranger = await signInNew("stranger@test.local", "password123");
  await expectDenied("a stranger can NOT adopt an unclaimed record", () =>
    updateDoc(doc(db, "students", "legacy1"), {
      uid: stranger.uid, authEmail: "stranger@test.local"
    }));
  await signOut(auth);

  const heir = await signInNew("9999999999@student.shreejilibrary.com", "password123");
  await expectOk("the identity-matching person CAN adopt it", () =>
    updateDoc(doc(db, "students", "legacy1"), {
      uid: heir.uid,
      authEmail: "9999999999@student.shreejilibrary.com",
      loginId: "9999999999"
    }));
  await expectDenied("the adopted record can NOT then be self-approved", () =>
    updateDoc(doc(db, "students", "legacy1"), { approvalStatus: "Approved" }));

  // The real app moves identity documents in the SAME transaction as the claim.
  // A positive assertion here — an evaluation error would surface as a denial
  // and silently pass a `expectDenied`, so this one has to succeed.
  await expectOk("heir can MOVE identity documents onto their own id", () =>
    runTransaction(db, async (tx) => {
      const legacyDocs = doc(db, "studentDocuments", "legacy1");
      const snap = await tx.get(legacyDocs);
      if (!snap.exists()) throw new Error("legacy documents fixture missing");
      tx.set(doc(db, "studentDocuments", heir.uid), snap.data(), { merge: true });
      tx.set(legacyDocs, { studentId: "", migratedTo: "studentDocuments/" + heir.uid }, { merge: true });
    }));
  await expectDenied("a stranger can NOT read the moved documents", async () => {
    await signOut(auth);
    await signInNew("stranger@test.local", "password123");
    await getDoc(doc(db, "studentDocuments", heir.uid));
  });
  await signOut(auth);

  /* -------------------------------------------------------------- 7. staff */
  console.log("\nstaff approval");
  await signInWithEmailAndPassword(auth, "staff1@test.local", "password123");
  await expectOk("staff can approve an applicant", () =>
    updateDoc(doc(db, "students", me.uid), { approvalStatus: "Approved", status: "Active" }));
  await expectOk("staff can occupy the reserved seat", () =>
    updateDoc(doc(db, "seats", "A99"), {
      status: "Occupied", assignedStudentId: me.uid,
      assignedStudentName: "Applicant", lastUpdated: serverTimestamp()
    }));
  await expectOk("staff can retire a legacy shell (status=Old, studentId cleared)", () =>
    setDoc(doc(db, "students", "legacy3"), {
      uid: "", name: "Shell", role: "Student", status: "Old",
      mergedInto: "students/whatever", studentId: "", admissionNo: ""
    }));
  await expectOk("staff can approve an already-Approved doc untouched by guard", () =>
    updateDoc(doc(db, "students", "legacy1"), { approvalStatus: "Approved", status: "Active" }));
  await signOut(auth);

  /* --------------------------------------------------------- 8. documents */
  console.log("\nstudent documents");
  await signInNew("applicant@test.local", "password123");
  const big = "x".repeat(219000);

  // POSITIVE assertions first: these must succeed. They are the ones that
  // would otherwise pass spuriously if a rules function failed to evaluate
  // (an evaluation error also produces a denial).
  await expectOk("applicant can upload documents at the 220k cap", () =>
    setDoc(doc(db, "studentDocuments", me.uid), {
      studentId: me.uid, aadhaarFront: big, aadhaarBack: big, photo: big, paymentScreenshot: big
    }));
  await expectOk("applicant can update a non-image field on their documents", () =>
    updateDoc(doc(db, "studentDocuments", me.uid), { verificationNote: "checked" }));
  await expectOk("applicant can replace an image within the cap", () =>
    updateDoc(doc(db, "studentDocuments", me.uid), { photo: "y".repeat(200000) }));
  await expectDenied("applicant can NOT store an image over the cap", () =>
    updateDoc(doc(db, "studentDocuments", me.uid), { photo: "x".repeat(250000) }));
  await expectDenied("a stranger can NOT read someone else's documents", async () => {
    await signOut(auth);
    await signInNew("stranger@test.local", "password123");
    await getDoc(doc(db, "studentDocuments", me.uid));
  });
  await signOut(auth);

  /* ------------------------------------------------------------------ done */
  console.log(`\n=== ${pass} passed, ${failures.length} failed ===`);
  if (failures.length) {
    console.log("failing assertions:");
    failures.forEach((f) => console.log("  - " + f));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("\nHarness error (not a rules assertion):", e);
  process.exit(2);
});
