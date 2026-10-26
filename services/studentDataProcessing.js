/**
 * Search across Name, Phone, ID, Seat
 */
export const searchStudents = (students, query) => {
  if (!query) return students;
  const q = query.toLowerCase().trim();
  return students.filter(s => {
    const seatStr = (s.seatNumber || "").toLowerCase();
    const floorStr = (s.seatFloor || "").toLowerCase();
    return (s.name || "").toLowerCase().includes(q) ||
           (s.phone || "").toLowerCase().includes(q) ||
           (s.studentId || "").toLowerCase().includes(q) ||
           seatStr.includes(q) ||
           floorStr.includes(q) ||
           `${seatStr} ${floorStr}`.includes(q) ||
           `${floorStr} ${seatStr}`.includes(q);
  });
};

/**
 * Filter by multiple criteria (Status, Plan, Renewal)
 */
export const filterStudents = (students, filters) => {
  return students.filter(s => {
    // Basic Active/Pending/Inactive status matching based on the filter tab.
    // ONE effective status decides the tab (lifecycle `status` first, admission
    // decision as fallback) — the old `status OR approvalStatus` match let a
    // single row appear under two tabs whenever the two fields disagreed.
    if (filters.status && filters.status !== "All") {
      const effective = String(s.status || s.approvalStatus || "").trim().toLowerCase();
      if (effective !== String(filters.status).trim().toLowerCase()) {
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
  const toMs = (val) => {
    if (!val) return 0;
    if (typeof val.toMillis === "function") return val.toMillis();
    if (typeof val.toDate === "function") return val.toDate().getTime();
    if (val._seconds != null) return val._seconds * 1000;
    if (typeof val === "number") return val;
    const t = new Date(val).getTime();
    return isNaN(t) ? 0 : t;
  };

  const isDateSort = sortBy === "createdAt" || sortBy === "updatedAt" || sortBy === "joined" ||
                     sortBy === "joinedDate" || sortBy === "joiningDate" ||
                     sortBy === "renewalDate" || sortBy === "paymentDueDate" || sortBy === "plannedExitDate" ||
                     sortBy === "startDate" || sortBy === "endDate";

  return [...students].sort((a, b) => {
    let valA = (sortBy === "joinedDate" ? (a.joinedDate || a.joiningDate || a.admissionDate || a.createdAt || a.startDate) : a[sortBy]) || "";
    let valB = (sortBy === "joinedDate" ? (b.joinedDate || b.joiningDate || b.admissionDate || b.createdAt || b.startDate) : b[sortBy]) || "";

    if (isDateSort) {
      valA = toMs(valA);
      valB = toMs(valB);
    } else if (typeof valA === "string" && typeof valB === "string") {
      const cmp = valA.localeCompare(valB, undefined, { numeric: true, sensitivity: "base" });
      return sortOrder === "asc" ? cmp : -cmp;
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
