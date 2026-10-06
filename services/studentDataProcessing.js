/**
 * Search across Name, Phone, ID, Seat
 */
export const searchStudents = (students, query) => {
  if (!query) return students;
  const q = query.toLowerCase().trim();
  return students.filter(s => {
    return (s.name || "").toLowerCase().includes(q) ||
           (s.phone || "").toLowerCase().includes(q) ||
           (s.studentId || "").toLowerCase().includes(q) ||
           (s.seatNumber || "").toLowerCase().includes(q);
  });
};

/**
 * Filter by multiple criteria (Status, Plan, Renewal)
 */
export const filterStudents = (students, filters) => {
  return students.filter(s => {
    // Basic Active/Pending/Inactive status matching based on the filter tab
    if (filters.status && filters.status !== "All") {
      if (s.status !== filters.status && s.approvalStatus !== filters.status) {
        return false;
      }
    }
    // Specific Plan filter
    if (filters.plan && filters.plan !== "All" && s.planName !== filters.plan) {
      return false;
    }
    return true;
  });
};

/**
 * Sort students
 */
export const sortStudents = (students, sortBy, sortOrder) => {
  return [...students].sort((a, b) => {
    let valA = a[sortBy] || "";
    let valB = b[sortBy] || "";

    // Convert dates
    if (sortBy === "createdAt" || sortBy === "renewalDate" || sortBy === "paymentDueDate" || sortBy === "plannedExitDate") {
      valA = (valA && typeof valA.toDate === 'function') ? valA.toDate().getTime() : (valA ? new Date(valA).getTime() : 0);
      valB = (valB && typeof valB.toDate === 'function') ? valB.toDate().getTime() : (valB ? new Date(valB).getTime() : 0);
      if (isNaN(valA)) valA = 0;
      if (isNaN(valB)) valB = 0;
    }

    if (valA < valB) return sortOrder === "asc" ? -1 : 1;
    if (valA > valB) return sortOrder === "asc" ? 1 : -1;
    return 0;
  });
};

/**
 * Paginate students
 */
export const paginateStudents = (students, page, pageSize) => {
  const start = (page - 1) * pageSize;
  return students.slice(start, start + pageSize);
};
