/**
 * Pure functional utility to filter complaints.
 */
export const filterComplaints = (records, filters) => {
  let result = records;

  if (filters.status && filters.status !== "All") {
    result = result.filter(r => r.status === filters.status);
  }

  if (filters.category && filters.category !== "All") {
    result = result.filter(r => r.category === filters.category);
  }

  if (filters.search && filters.search.trim() !== "") {
    const q = filters.search.toLowerCase();
    result = result.filter(r => {
      const name = (r.studentName || "").toLowerCase();
      const phone = (r.studentPhone || "").toLowerCase();
      const seat = (r.seatNumber || "").toLowerCase();
      const floor = (r.seatFloor || "").toLowerCase();
      const desc = (r.description || "").toLowerCase();
      const id = (r.id || "").toLowerCase();
      const studentId = (r.studentId || "").toLowerCase();
      return name.includes(q) || phone.includes(q) || seat.includes(q) || floor.includes(q) || desc.includes(q) || id.includes(q) || studentId.includes(q);
    });
  }

  return result;
};
