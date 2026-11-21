/**
 * Helper to identify whether a student belongs to Premium Library or Regular Library
 */
export const isStudentPremium = (s, planName = "") => {
  if (!s) return false;
  const plan = String(planName || s.planName || "").toLowerCase();
  const lib = String(s.libraryType || s.libraryTypeName || "").toLowerCase();
  const floor = String(s.seatFloor || s.floor || "").toLowerCase();
  const seat = String(s.seatNumber || s.seatAssigned || "").trim().toUpperCase();

  if (plan.includes("premium")) return true;
  if (lib.includes("premium")) return true;
  if (floor.includes("first") || floor.includes("1st")) return true;
  if (/^B\d/.test(seat) || /\dB$/.test(seat) || /^P-/.test(seat) || /^PR-/.test(seat) || /^PN-/.test(seat)) return true;
  return false;
};

/**
 * Search across Name, Phone, ID, Seat, Plan, Library Tier
 */
export const searchStudents = (students, query) => {
  if (!query) return students;
  const q = query.toLowerCase().trim();
  return students.filter(s => {
    const seatStr = (s.seatNumber || "").toLowerCase();
    const floorStr = (s.seatFloor || "").toLowerCase();
    const planStr = (s.planName || "").toLowerCase();
    const libStr = (s.libraryType || "").toLowerCase();
    const isPrem = isStudentPremium(s);
    return (s.name || "").toLowerCase().includes(q) ||
           (s.phone || "").toLowerCase().includes(q) ||
           (s.studentId || "").toLowerCase().includes(q) ||
           planStr.includes(q) ||
           libStr.includes(q) ||
           seatStr.includes(q) ||
           floorStr.includes(q) ||
           `${seatStr} ${floorStr}`.includes(q) ||
           `${floorStr} ${seatStr}`.includes(q) ||
           (q === "premium" && isPrem) ||
           (q === "regular" && !isPrem);
  });
};

/**
 * Filter by multiple criteria (Status, Plan, Renewal, Library Tier)
 */
export const filterStudents = (students, filters) => {
  return students.filter(s => {
    if (filters.status && filters.status !== "All") {
      const target = String(filters.status).trim().toLowerCase();
      if (target === "premium") {
        if (!isStudentPremium(s)) return false;
      } else if (target === "regular") {
        if (isStudentPremium(s)) return false;
      } else {
        const effective = String(s.status || s.approvalStatus || "").trim().toLowerCase();
        if (effective !== target) {
          return false;
        }
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
