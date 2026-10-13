import { collection, query, where, onSnapshot, addDoc, setDoc, getDocs, doc, updateDoc, getDoc, deleteDoc, writeBatch, serverTimestamp, orderBy } from "firebase/firestore";
import { db } from "../firebase/firebase.js";
import { validateSeatAssignment } from "./seatValidation.js";

// ===============================================
// SEAT INITIALIZATION & LISTENERS
// ===============================================

// ── Library room plan: exact spec positions (col 1-4, row 1-based) ──────────
// Ground Floor 4 cols × 18 rows (1-68), First Floor 4 cols × 11 rows (1-40).
// seatNumber is ALWAYS the plain number ("20", never "A20"). Floor disambiguates
// duplicates: doc id = "ground-20" / "first-20", key = "Ground Floor||20".
// Used to seed col/row so the map is data-driven but looks identical.
export const GROUND_SEAT_COUNT = 68;
export const FIRST_SEAT_COUNT = 40;
const GROUND_COLS_RAW = [
  [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18],
  [null,34,33,32,31,30,29,28,27,26,25,24,67,23,22,21,20,19],
  [null,35,36,null,37,38,39,40,41,42,null,43,68,44,45,46,47,48],
  [66,65,64,63,62,61,60,59,58,57,56,55,54,53,52,51,50,49],
];
const FIRST_COLS_RAW = [
  [1,2,3,4,5,6,7,8,9,10,null],
  [null,20,19,18,17,16,15,14,13,12,11],
  [null,21,22,23,24,25,26,27,28,29,30],
  [40,39,38,37,36,35,34,33,32,31,null],
];

/** Plain-number normaliser: "A20"/"B07"/"20A"/" A 01 " -> "20". Legacy-safe. */
export const normalizeSeatNumberPlain = (value) => {
  const raw = String(value == null ? "" : value).trim().toUpperCase().replace(/\s+/g, "");
  if (!raw) return "";
  // Strip one leading and/or trailing A/B (old prefix scheme + reported suffix form)
  const m = raw.match(/^[AB]?0*(\d+)[AB]?$/);
  if (m) return String(Number(m[1]));
  const m2 = raw.match(/^([A-Z]+)-?0*(\d+)$/);
  if (m2) return String(Number(m2[2]));
  return raw;
};

/** Floor-aware key: "Ground Floor||20". Identity = number + floor. */
export const seatKey = (floor, number) =>
  `${String(floor || "Ground Floor")}||${normalizeSeatNumberPlain(number)}`;

/** Deterministic doc id for the new scheme: "ground-20" / "first-20". */
export const docIdForSeat = (floor, number) => {
  const n = normalizeSeatNumberPlain(number);
  return (String(floor) === "First Floor" ? `first-${n}` : `ground-${n}`);
};

/** Floor from a legacy A/B name ("A20"->Ground, "B15"->First), else null. */
export const legacyFloorForName = (value) => {
  const raw = String(value == null ? "" : value).trim().toUpperCase().replace(/\s+/g, "");
  if (/^B\d/.test(raw) || /\dB$/.test(raw)) return "First Floor";
  if (/^A\d/.test(raw) || /\dA$/.test(raw)) return "Ground Floor";
  return null;
};

export const maxSeatForFloor = (floor) =>
  String(floor) === "First Floor" ? FIRST_SEAT_COUNT : GROUND_SEAT_COUNT;

export const isValidSeatForFloor = (number, floor) => {
  const n = Number(normalizeSeatNumberPlain(number));
  return Number.isInteger(n) && n >= 1 && n <= maxSeatForFloor(floor);
};

const PLAN_POSITION = (() => {
  const m = new Map();
  GROUND_COLS_RAW.forEach((colArr, ci) => {
    colArr.forEach((n, ri) => {
      if (n == null) return;
      m.set(seatKey("Ground Floor", n), { floor: "Ground Floor", col: ci + 1, row: ri + 1 });
    });
  });
  FIRST_COLS_RAW.forEach((colArr, ci) => {
    colArr.forEach((n, ri) => {
      if (n == null) return;
      m.set(seatKey("First Floor", n), { floor: "First Floor", col: ci + 1, row: ri + 1 });
    });
  });
  return m;
})();

export const planPositionFor = (floor, number) => PLAN_POSITION.get(seatKey(floor, number)) || null;

export const seedInitialSeats = async () => {
  const seatsRef = collection(db, "seats");
  const snap = await getDocs(seatsRef);

  if (snap.empty) {
    console.log("Seeding library seat plan: 1-68 Ground Floor, 1-40 First Floor...");
    // Single batched write (was 108 sequential round-trips) — the map
    // appears in about a second instead of hanging on "0 seats".
    const batch = writeBatch(db);
    const plan = [
      { count: GROUND_SEAT_COUNT, floor: 'Ground Floor' },
      { count: FIRST_SEAT_COUNT, floor: 'First Floor' }
    ];

    for (const { count, floor } of plan) {
      for (let i = 1; i <= count; i++) {
        const name = String(i);
        const pos = planPositionFor(floor, name) || {};
        // Deterministic doc ID = floor + number (ground-20 / first-20):
        // re-running seed overwrites the same docs instead of cloning
        // duplicates. seatNumber itself is the plain number.
        batch.set(doc(seatsRef, docIdForSeat(floor, name)), {
          seatNumber: name,
          floor,
          col: pos.col ?? null,
          row: pos.row ?? null,
          status: "Available",
          assignedStudentId: null,
          assignedStudentName: null,
          planType: null,
          lastUpdated: serverTimestamp()
        });
      }
    }
    await batch.commit();
  }
};

/**
 * Self-healing occupancy reconcile. Runs on every admin Seats page open.
 * Fixes the two mismatches that make counts lie against the map:
 *  1. GHOST occupied — seat says Occupied but no Active student claims it
 *     (stale after deletes/edits) → released to Available.
 *  2. UNMARKED claim — an Active student holds a seatNumber whose doc(s)
 *     still say Available (after rebuilds/direct edits) → marked Occupied
 *     with the student's name. Missing plan-valid docs are recreated.
 *  3. ORPHAN claim — an Active student holds a seat name that is not on the
 *     library plan at all → reported (returned) so the page can show WHY
 *     that student's seat can't appear on the map. Never auto-deleted here.
 * Never touches Reserved / Maintenance / Inactive seats, never edits student
 * docs. Best-effort: failures only log.
 * @returns {Promise<{released: number, claimed: number, orphans: Array}>}
 */
export const reconcileSeatOccupancy = async () => {
  const empty = { released: 0, claimed: 0, orphans: [] };
  try {
    const [seatsSnap, studentsSnap] = await Promise.all([
      getDocs(collection(db, "seats")),
      getDocs(query(collection(db, "students"), where("status", "==", "Active")))
    ]);
    if (seatsSnap.empty) return empty;

    // Active claims by floor-aware key ("Ground Floor||20").
    const claims = new Map(); // key -> { id, name }
    studentsSnap.forEach(stu => {
      const data = stu.data() || {};
      const raw = data.seatNumber;
      if (!raw) return;
      const n = normalizePlanName(raw);
      const floor = data.seatFloor || legacyFloorForName(raw) || "Ground Floor";
      const key = seatKey(floor, n);
      if (!claims.has(key)) {
        claims.set(key, { id: stu.id, name: data.name || "Student", planValid: PLAN_SEAT_NAMES.has(key), floor, number: n });
      }
    });

    // Which floor-aware keys already have a doc.
    const present = new Set();
    seatsSnap.forEach(d => {
      const sd = d.data() || {};
      const n = normalizePlanName(sd.seatNumber);
      const floor = sd.floor || legacyFloorForName(sd.seatNumber) || "Ground Floor";
      const key = seatKey(floor, n);
      if (PLAN_SEAT_NAMES.has(key)) present.add(key);
    });

    const batch = writeBatch(db);
    let released = 0, claimed = 0, created = 0;
    const orphans = [];
    seatsSnap.forEach(d => {
      const data = d.data() || {};
      const n = normalizePlanName(data.seatNumber);
      const floor = data.floor || legacyFloorForName(data.seatNumber) || "Ground Floor";
      const key = seatKey(floor, n);
      if (!PLAN_SEAT_NAMES.has(key)) return; // non-plan docs: cleanup owns these
      const claim = claims.get(key);
      if (data.status === "Occupied" && !claim) {
        batch.update(d.ref, {
          status: "Available",
          assignedStudentId: null,
          assignedStudentName: null,
          planType: null,
          lastUpdated: serverTimestamp()
        });
        released++;
      } else if (data.status === "Available" && claim) {
        // A student is assigned to this seat but it shows Available — fix it.
        // Use "Reserved" (not "Occupied") because assignment means reservation;
        // "Occupied" should only be set when the student actively checks in.
        batch.update(d.ref, {
          status: "Reserved",
          assignedStudentId: claim.id,
          assignedStudentName: claim.name,
          lastUpdated: serverTimestamp()
        });
        claimed++;
      }
    });

    // Recreate missing docs for plan-valid claims (plan doc gone entirely).
    const seatsRef = collection(db, "seats");
    claims.forEach((claim, key) => {
      if (!claim.planValid) {
        orphans.push({ studentName: claim.name, seatNumber: claim.number });
        return;
      }
      if (!present.has(key)) {
        const want = planPositionFor(claim.floor, claim.number) || {};
        batch.set(doc(seatsRef, docIdForSeat(claim.floor, claim.number)), {
          seatNumber: claim.number,
          floor: claim.floor,
          col: want.col ?? null,
          row: want.row ?? null,
          status: "Reserved",
          assignedStudentId: claim.id,
          assignedStudentName: claim.name,
          planType: null,
          lastUpdated: serverTimestamp()
        });
        created++;
      }
    });

    if (released + claimed + created > 0) await batch.commit();
    if (created) claimed += created;
    return { released, claimed, orphans };
  } catch (e) {
    console.warn("[seats] reconcile skipped:", e?.message || e);
    return empty;
  }
};

// "A01"/"A20"/"20A" -> "20" (same matching the seat map uses)
const normalizePlanName = (value) => normalizeSeatNumberPlain(value);
export { normalizePlanName };

const PLAN_SEAT_NAMES = (() => {
  const names = new Set();
  for (let i = 1; i <= GROUND_SEAT_COUNT; i++) names.add(seatKey("Ground Floor", i));
  for (let i = 1; i <= FIRST_SEAT_COUNT; i++) names.add(seatKey("First Floor", i));
  return names;
})();

// One-time backend fix: rebuild EVERYTHING to match the library map.
// Deletes all seats, recreates 1-68 (Ground) + 1-40 (First) as Available.
// Student seats that fit the plan are kept (renamed to plain form, e.g. A20 -> 20);
// old seats that fit nowhere are cleared. Old attendance history is untouched.
// Run once from the browser console while logged in as staff:
//   await window.rebuildSeatPlan()
export const rebuildSeatPlan = async () => {
  if (!window.confirm("Rebuild the seat map backend?\n\nALL seats will be deleted and recreated as 1-68 (Ground Floor) + 1-40 (First Floor).\n\nStudent seats that fit the plan are kept (renamed to plain numbers). Old seats that fit nowhere are cleared.")) {
    return { success: false, error: "cancelled" };
  }

  const seatsRef = collection(db, "seats");
  const existing = await getDocs(seatsRef);
  await Promise.all(existing.docs.map(d => deleteDoc(doc(db, "seats", d.id))));

  for (const target of [{ count: GROUND_SEAT_COUNT, floor: "Ground Floor" }, { count: FIRST_SEAT_COUNT, floor: "First Floor" }]) {
    for (let i = 1; i <= target.count; i++) {
      const name = String(i);
      const pos = planPositionFor(target.floor, name) || {};
      await setDoc(doc(seatsRef, docIdForSeat(target.floor, name)), {
        seatNumber: name,
        floor: target.floor,
        col: pos.col ?? null,
        row: pos.row ?? null,
        status: "Available",
        assignedStudentId: null,
        assignedStudentName: null,
        planType: null,
        lastUpdated: serverTimestamp()
      });
    }
  }

  const studentsSnap = await getDocs(collection(db, "students"));
  const batch = writeBatch(db);
  let kept = 0, cleared = 0;
  studentsSnap.forEach(stu => {
    const sd = stu.data() || {};
    const current = sd.seatNumber;
    if (!current) return;
    const normed = normalizePlanName(current);
    const floor = sd.seatFloor || legacyFloorForName(current) || "Ground Floor";
    if (PLAN_SEAT_NAMES.has(seatKey(floor, normed)) && isValidSeatForFloor(normed, floor)) {
      const upd = {};
      if (current !== normed) upd.seatNumber = normed;
      if (!sd.seatFloor) upd.seatFloor = floor;
      if (Object.keys(upd).length) batch.update(stu.ref, upd);
      kept++;
    } else {
      batch.update(stu.ref, { seatNumber: null });
      cleared++;
    }
  });
  await batch.commit();

  return { success: true, kept, cleared };
};

if (typeof window !== "undefined") window.rebuildSeatPlan = rebuildSeatPlan;

// Automatic backend reconcile: the map is a real playground, so the backend
// must hold EXACTLY the library plan. On every admin map open:
//  1. migrates legacy A/B names to plain numbers ("A20" -> "20", floor kept)
//  2. deletes seats that are NOT part of the plan (R-names / out-of-range)
//  3. creates any missing plan seats (1-68 Ground + 1-40 First) as Available
//  4. backfills col/row/floor on plan seats that lack correct positions
// Student seat refs are fixed the same way (kept+renamed when fitting, cleared
// when not). Safe to run on every admin map open — no-ops once clean.
export const cleanupNonPlanSeats = async () => {
  try {
    const seatsRef = collection(db, "seats");
    const snap = await getDocs(seatsRef);
    if (snap.empty) return { success: true, deleted: 0, renamed: 0, created: 0, positioned: 0, clearedStudents: 0, fixedStudents: 0 };

    const floorOf = (data) =>
      data.floor || legacyFloorForName(data.seatNumber) || "Ground Floor";

    const toDeleteRefs = [];
    const deletedIds = new Set();
    const renames = []; // { ref, to (plain number), floor }

    // 0. DEDUPE identical floor-aware keys ("two 20s on Ground") FIRST.
    // Keep the richest record (Occupied > Reserved > Available, then assignee,
    // then position), adopt an assignee onto the keeper when it lacks one.
    const statusRank = (s) => s === "Occupied" ? 3 : s === "Reserved" ? 2 : s === "Available" ? 1 : 0;
    const byKey = new Map();
    snap.forEach(d => {
      const data = d.data() || {};
      const name = data.seatNumber;
      if (!name) return;
      const n = normalizePlanName(name);
      const floor = floorOf(data);
      const key = seatKey(floor, n);
      if (!PLAN_SEAT_NAMES.has(key)) return;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(d);
    });
    const dedupeMerges = [];
    let deduped = 0;
    byKey.forEach((docs) => {
      if (docs.length < 2) return;
      const sorted = [...docs].sort((a, b) => {
        const da = a.data() || {}, db = b.data() || {};
        return (statusRank(db.status) - statusRank(da.status))
          || ((db.assignedStudentId ? 1 : 0) - (da.assignedStudentId ? 1 : 0))
          || (((db.col != null) ? 1 : 0) - ((da.col != null) ? 1 : 0));
      });
      const keeper = sorted[0];
      const kd = keeper.data() || {};
      if (!kd.assignedStudentId) {
        const donor = sorted.find(d => (d.data() || {}).assignedStudentId);
        if (donor) dedupeMerges.push({ keeperRef: keeper.ref, donor: donor.data() });
      }
      sorted.slice(1).forEach(d => { toDeleteRefs.push(d.ref); deletedIds.add(d.id); deduped++; });
    });

    snap.forEach(d => {
      if (deletedIds.has(d.id)) return; // already condemned as a dupe
      const data = d.data() || {};
      const name = data.seatNumber;
      if (!name) { toDeleteRefs.push(d.ref); return; }
      const n = normalizePlanName(name);
      const floor = floorOf(data);
      const key = seatKey(floor, n);
      if (!PLAN_SEAT_NAMES.has(key) || !isValidSeatForFloor(n, floor)) { toDeleteRefs.push(d.ref); return; }
      // Migrate legacy "A20" -> "20" (and fix missing/wrong floor) in place.
      if (String(name) !== String(n) || !data.floor) {
        renames.push({ ref: d.ref, to: String(n), floor });
      }
    });

    await Promise.all(toDeleteRefs.map(r => deleteDoc(r)));
    await Promise.all(dedupeMerges.map(m => {
      const upd = {
        assignedStudentId: m.donor.assignedStudentId || null,
        assignedStudentName: m.donor.assignedStudentName || null,
        planType: m.donor.planType || null,
        lastUpdated: serverTimestamp()
      };
      if (m.donor.status === "Occupied") upd.status = "Occupied";
      return updateDoc(m.keeperRef, upd);
    }));
    await Promise.all(renames.map(r => updateDoc(r.ref, { seatNumber: r.to, floor: r.floor, lastUpdated: serverTimestamp() })));

    // Re-read survivors, then create missing plan seats + fix positions.
    const afterSnap = await getDocs(seatsRef);
    const present = new Set();
    const posFixes = [];
    afterSnap.forEach(d => {
      const data = d.data() || {};
      const n = normalizePlanName(data.seatNumber);
      const floor = data.floor || "Ground Floor";
      const key = seatKey(floor, n);
      if (PLAN_SEAT_NAMES.has(key)) {
        present.add(key);
        const want = planPositionFor(floor, n);
        if (want && (data.col !== want.col || data.row !== want.row || data.floor !== want.floor)) {
          posFixes.push({ ref: d.ref, want });
        }
      }
    });

    let created = 0;
    const missing = [...PLAN_SEAT_NAMES].filter(k => !present.has(k));
    await Promise.all(missing.map(async (key) => {
      const [floor, num] = key.split("||");
      const want = planPositionFor(floor, num) || {};
      // Deterministic ID ground-20 / first-20: concurrent runs converge.
      await setDoc(doc(seatsRef, docIdForSeat(floor, num)), {
        seatNumber: String(num),
        floor,
        col: want.col ?? null,
        row: want.row ?? null,
        status: "Available",
        assignedStudentId: null,
        assignedStudentName: null,
        planType: null,
        lastUpdated: serverTimestamp()
      });
      created++;
    }));
    await Promise.all(posFixes.map(p => updateDoc(p.ref, {
      col: p.want.col, row: p.want.row, floor: p.want.floor, lastUpdated: serverTimestamp()
    })));

    const studentsSnap = await getDocs(collection(db, "students"));
    const batch = writeBatch(db);
    let clearedStudents = 0, fixedStudents = 0;
    studentsSnap.forEach(stu => {
      const sd = stu.data() || {};
      const current = sd.seatNumber;
      if (!current) return;
      const n = normalizePlanName(current);
      const floor = sd.seatFloor || legacyFloorForName(current) || "Ground Floor";
      const key = seatKey(floor, n);
      if (!PLAN_SEAT_NAMES.has(key)) { batch.update(stu.ref, { seatNumber: null }); clearedStudents++; }
      else if (String(current) !== String(n) || !sd.seatFloor) {
        batch.update(stu.ref, { seatNumber: String(n), seatFloor: floor });
        fixedStudents++;
      }
    });
    await batch.commit();

    return { success: true, deleted: toDeleteRefs.length, deduped, renamed: renames.length, created, positioned: posFixes.length, clearedStudents, fixedStudents };
  } catch (e) {
    console.warn("cleanupNonPlanSeats skipped:", e);
    return { success: false, error: e.message };
  }
};

// ── Playground operations: seats are real backend docs with col/row ─────────
export const saveSeatPosition = async (seatId, col, row) => {
  try {
    await updateDoc(doc(db, "seats", seatId), { col, row, lastUpdated: serverTimestamp() });
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
};

export const renameSeat = async (seatId, newNumber) => {
  try {
    const normed = normalizeSeatNumberPlain(newNumber);
    if (!/^\d+$/.test(normed)) throw new Error("Seat number must be a plain number like 20.");
    const seatRef = doc(db, "seats", seatId);
    const snap = await getDoc(seatRef);
    if (!snap.exists()) throw new Error("Seat not found.");
    const floor = (snap.data() || {}).floor || "Ground Floor";
    if (!isValidSeatForFloor(normed, floor)) throw new Error(`Seat ${normed} is out of range for ${floor} (1-${maxSeatForFloor(floor)}).`);
    const seatsSnap = await getDocs(collection(db, "seats"));
    let clash = false;
    seatsSnap.forEach(d => {
      if (d.id === seatId) return;
      const dd = d.data() || {};
      const dfloor = dd.floor || "Ground Floor";
      if (dfloor === floor && normalizeSeatNumberPlain(dd.seatNumber) === normed) clash = true;
    });
    if (clash) throw new Error(`Seat ${normed} already exists on ${floor}.`);
    await updateDoc(seatRef, { seatNumber: normed, lastUpdated: serverTimestamp() });
    const data = snap.data();
    if (data.assignedStudentId) {
      try { await updateDoc(doc(db, "students", data.assignedStudentId), { seatNumber: normed, seatFloor: floor }); } catch (_) {}
    }
    return { success: true, seatNumber: normed };
  } catch (e) { return { success: false, error: e.message }; }
};

export const addSeatAt = async (floor, col, row) => {
  try {
    const seatsSnap = await getDocs(collection(db, "seats"));
    let occupied = false, maxNum = 0;
    seatsSnap.forEach(d => {
      const s = d.data() || {};
      if ((s.floor || "Ground Floor") === floor && Number(s.col) === Number(col) && Number(s.row) === Number(row)) occupied = true;
      if ((s.floor || "Ground Floor") !== floor) return;
      const num = Number(normalizeSeatNumberPlain(s.seatNumber));
      if (Number.isFinite(num) && num > maxNum) maxNum = num;
    });
    if (occupied) throw new Error("That cell is already occupied.");
    const seatNumber = String(maxNum + 1);
    await setDoc(doc(collection(db, "seats"), docIdForSeat(floor, seatNumber)), {
      seatNumber, floor, col, row,
      status: "Available",
      assignedStudentId: null,
      assignedStudentName: null,
      planType: null,
      lastUpdated: serverTimestamp()
    });
    return { success: true, seatNumber };
  } catch (e) { return { success: false, error: e.message }; }
};

export const deleteSeatById = async (seatId) => {
  try {
    const seatRef = doc(db, "seats", seatId);
    const snap = await getDoc(seatRef);
    if (!snap.exists()) throw new Error("Seat not found.");
    const data = snap.data();
    if (data.assignedStudentId) {
      try { await updateDoc(doc(db, "students", data.assignedStudentId), { seatNumber: null }); } catch (_) {}
    }
    await deleteDoc(seatRef);
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
};

// NOTE: seat creation from the map UI is handled by addSeatAt (edit-layout
// mode, cell-anchored). The free-floating addSingleSeat helper is removed.

export const listenToAllSeats = (onUpdate, onError) => {
  const q = query(collection(db, "seats"), orderBy("seatNumber"));
  return onSnapshot(q, (snapshot) => {
    const seats = [];
    snapshot.forEach(doc => seats.push({ id: doc.id, ...doc.data() }));
    onUpdate(seats);
  }, (err) => {
    // Without this, a denied/failed read is indistinguishable from "no seats":
    // the grid just shows "No seats on this floor yet." Log it loudly and let
    // the caller surface it instead of failing silently.
    console.error("[seats] live seat listener failed:", err);
    if (typeof onError === "function") onError(err);
  });
};

// ===============================================
// ADMIN ACTIONS
// ===============================================

export const assignSeat = async (seatId, student) => {
  try {
    const seatRef = doc(db, "seats", seatId);
    const snap = await getDoc(seatRef);
    if (!snap.exists()) throw new Error("Seat not found.");

    validateSeatAssignment(snap.data());

    // Update Seat (students may self-reserve an Available seat under new rules)
    try {
      await updateDoc(seatRef, {
        status: "Reserved", // It's assigned/reserved for this student
        assignedStudentId: student.id,
        assignedStudentName: student.name,
        planType: student.planName || "Unknown",
        lastUpdated: serverTimestamp()
      });
    } catch (e) {
      const msg = String((e && (e.code || e.message)) || e);
      if (/permission|insufficient/i.test(msg)) {
        throw new Error("Seat reservation denied. Please deploy the latest firestore.rules, or ask staff to assign the seat.");
      }
      throw e;
    }

    // Also update Student profile so they know their seat.
    // New self-admission users don't have a students/{uid} doc yet — skip quietly.
    try {
      const studentRef = doc(db, "students", student.id);
      await updateDoc(studentRef, {
        seatNumber: normalizeSeatNumberPlain(snap.data().seatNumber),
        seatFloor: (snap.data() || {}).floor || "Ground Floor",
        updatedAt: serverTimestamp()
      });
    } catch (_) { /* admission flow creates the doc moments later */ }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const unassignSeat = async (seatId) => {
  try {
    const seatRef = doc(db, "seats", seatId);
    const snap = await getDoc(seatRef);
    if (!snap.exists()) throw new Error("Seat not found.");

    const data = snap.data();
    if (data.assignedStudentId) {
      // Clear from student profile (best effort — doc may not exist yet)
      try {
        const studentRef = doc(db, "students", data.assignedStudentId);
        await updateDoc(studentRef, { seatNumber: null });
      } catch (_) {}
    }

    // Reset Seat
    await updateDoc(seatRef, {
      status: "Available",
      assignedStudentId: null,
      assignedStudentName: null,
      planType: null,
      lastUpdated: serverTimestamp()
    });

    return { success: true };
  } catch (error) {
    const msg = String((error && (error.code || error.message)) || error);
    if (/permission|insufficient/i.test(msg)) {
      return { success: false, error: "Seat release denied. Please deploy the latest firestore.rules." };
    }
    return { success: false, error: error.message };
  }
};

export const changeSeatStatus = async (seatId, newStatus) => {
  try {
    const seatRef = doc(db, "seats", seatId);
    await updateDoc(seatRef, {
      status: newStatus,
      lastUpdated: serverTimestamp()
    });
    return { success: true };
  } catch (error) {
    const msg = String((error && (error.code || error.message)) || error);
    if (/permission|insufficient/i.test(msg)) {
      return { success: false, error: "Seat update denied. Please deploy the latest firestore.rules." };
    }
    return { success: false, error: error.message };
  }
};
