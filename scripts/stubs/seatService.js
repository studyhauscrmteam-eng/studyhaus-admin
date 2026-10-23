/**
 * Test double for services/seatService.js — supplies production-shaped seat
 * data with NO Firestore, so the render test exercises the real seatMapUI
 * code (layout, palette, normalisation, selection) against real data.
 *
 * 108 seats: 1-68 (Ground Floor) + 1-40 (First Floor), matching the live
 * collection exactly, including a couple of Occupied rows.
 */
const seats = [];
for (let i = 1; i <= 68; i++) {
  seats.push({
    id: `ground-${i}`,
    seatNumber: `${i}`,
    floor: "Ground Floor",
    col: i,
    row: 1,
    status: i === 5 || i === 50 ? "Occupied" : "Available",
    assignedStudentId: i === 5 || i === 50 ? "someone-else" : null,
    assignedStudentName: i === 5 || i === 50 ? "Existing Member" : null,
  });
}
for (let i = 1; i <= 40; i++) {
  seats.push({
    id: `first-${i}`,
    seatNumber: `${i}`,
    floor: "First Floor",
    col: i,
    row: 1,
    status: i === 7 ? "Occupied" : "Available",
    assignedStudentId: i === 7 ? "someone-else" : null,
    assignedStudentName: i === 7 ? "Existing Member" : null,
  });
}

export const listenToAllSeats = (onUpdate, onError) => {
  // Deliver asynchronously like a real snapshot, then stay subscribed.
  const t = setTimeout(() => {
    try {
      onUpdate(JSON.parse(JSON.stringify(seats)));
    } catch (e) {
      if (typeof onError === "function") onError(e);
    }
  }, 0);
  return () => clearTimeout(t);
};

// Everything below exists only so the admin-branch code paths still link.
export const assignSeat = async () => ({ success: true });
export const unassignSeat = async () => ({ success: true });
export const changeSeatStatus = async () => ({ success: true });
export const seedInitialSeats = async () => ({ success: true });
export const reconcileSeatOccupancy = async () => ({ success: true, released: 0, claimed: 0 });
export const cleanupNonPlanSeats = async () => ({
  success: true, deleted: 0, created: 0, renamed: 0, positioned: 0,
  clearedStudents: 0, fixedStudents: 0,
});
export const saveSeatPosition = async () => ({ success: true });
export const renameSeat = async () => ({ success: true });
export const addSeatAt = async () => ({ success: true });
export const deleteSeatById = async () => ({ success: true });
export const formatSeatCode = (seat, type = null) => {
  if (!seat) return "";
  const num = String(seat.seatNumber || "").replace(/\D/g, "");
  const pad = num ? num.padStart(3, "0") : String(seat.seatNumber || "");
  const isFirst = (seat.floor === "First Floor" || seat.library === "premium");
  if (type === "rotational-night") return isFirst ? `PN-${pad}` : `LN-${pad}`;
  if (type === "rotational-day") return isFirst ? `PR-${pad}` : `LR-${pad}`;
  return isFirst ? `P-${pad}` : `L-${pad}`;
};
export const autoFindAlternativeSeat = async () => null;
export const reassignRotationalOccupant = async () => ({ success: true });
export const setSeatRotationalEligibility = async () => ({ success: true });
export const resolveSeatConflict = async () => ({ success: true });
