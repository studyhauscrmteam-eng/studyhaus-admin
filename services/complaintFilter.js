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
      const seat = (r.seatNumber || "").toLowerCase();
      const id = (r.id || "").toLowerCase();
      const studentId = (r.studentId || "").toLowerCase();
      return name.includes(q) || seat.includes(q) || id.includes(q) || studentId.includes(q);
    });
  }

  return result;
};
