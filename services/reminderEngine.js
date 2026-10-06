/**
 * Calculates days between two date strings (YYYY-MM-DD)
 */
const getDaysDiff = (targetDateStr) => {
  if (!targetDateStr) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  
  const target = new Date(targetDateStr);
  target.setHours(0, 0, 0, 0);
  
  return Math.round((target - now) / (1000 * 60 * 60 * 24));
};

/**
 * Assigns color based on days remaining
 */
const getColor = (days) => {
  if (days < 0) return "red";
  if (days === 0) return "orange";
  if (days <= 2) return "yellow";
  return "green";
};

const getBadgeClass = (color) => {
  if (color === "red") return "badge-absent";
  if (color === "orange") return "badge-pending"; // Usually orange
  if (color === "yellow") return "badge-pending"; // Close enough
  if (color === "green") return "badge-paid";
  return "badge"; // gray
};

/**
 * Core Engine: Transforms raw data into unified reminder objects
 */
export const generateReminders = (students, pendingPayments, overrides) => {
  let currentReminders = [];
  let oldReminders = [];

  const todayStr = new Date().toISOString().split("T")[0];

  students.forEach(s => {
    // 1. Old Student Follow-ups
    if (s.status === "Old") {
      const type = "Follow-up";
      const overrideId = `${s.id}_${type}`;
      const override = overrides[overrideId];

      if (override && override.status === "Completed") return; // Suppress completed

      // Default follow up is 7 days after exit date, unless rescheduled
      let dueDateStr = "";
      if (override && override.customDate) {
        dueDateStr = override.customDate;
      } else if (s.exitDate) {
        const exit = new Date(s.exitDate);
        exit.setDate(exit.getDate() + 7);
        dueDateStr = exit.toISOString().split("T")[0];
      }

      if (dueDateStr) {
        const days = getDaysDiff(dueDateStr);
        if (days <= 7) { // Show if within next 7 days or overdue
          oldReminders.push({
            studentId: s.id,
            name: s.name,
            phone: s.phone,
            planName: s.planName,
            exitReason: s.exitReason,
            exitDate: s.exitDate,
            type,
            dueDateStr,
            daysRemaining: days,
            color: getColor(days),
            badgeClass: getBadgeClass(getColor(days))
          });
        }
      }
      return; // Stop processing old students for other reminders
    }

    // --- Active/Pending Students ---

    // 2. Birthday Reminders
    if (s.dateOfBirth) {
      const type = "Birthday";
      const overrideId = `${s.id}_${type}`;
      const override = overrides[overrideId];

      if (!override || override.status !== "Completed") {
        // Calculate next birthday
        const dob = new Date(s.dateOfBirth);
        const now = new Date();
        let nextBday = new Date(now.getFullYear(), dob.getMonth(), dob.getDate());
        if (nextBday < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
          nextBday.setFullYear(now.getFullYear() + 1);
        }
        
        let dueDateStr = nextBday.toISOString().split("T")[0];
        if (override && override.customDate) dueDateStr = override.customDate;
        
        const days = getDaysDiff(dueDateStr);
        if (days <= 7) {
          currentReminders.push({
            studentId: s.id,
            name: s.name,
            phone: s.phone,
            seatNumber: s.seatNumber,
            planName: s.planName,
            type,
            dueDateStr,
            daysRemaining: days,
            color: getColor(days),
            badgeClass: getBadgeClass(getColor(days))
          });
        }
      }
    }

    // 3. Renewal Reminders
    if (s.paymentDueDate) {
      const type = "Renewal";
      const overrideId = `${s.id}_${type}`;
      const override = overrides[overrideId];

      if (!override || override.status !== "Completed") {
        let dueDateStr = s.paymentDueDate;
        if (override && override.customDate) dueDateStr = override.customDate;
        
        const days = getDaysDiff(dueDateStr);
        if (days <= 7) {
          currentReminders.push({
            studentId: s.id,
            name: s.name,
            phone: s.phone,
            seatNumber: s.seatNumber,
            planName: s.planName,
            type,
            dueDateStr,
            daysRemaining: days,
            color: getColor(days),
            badgeClass: getBadgeClass(getColor(days))
          });
        }
      }
    }
  });

  // 4. Payment Due Reminders
  pendingPayments.forEach(p => {
    // Only map payments that are connected to an active student in our list
    const student = students.find(s => s.id === p.studentId && s.status !== "Old");
    if (!student) return;

    const type = "Payment";
    const overrideId = `${student.id}_${type}`;
    const override = overrides[overrideId];

    if (!override || override.status !== "Completed") {
      let dueDateStr = p.dueDateStr || todayStr; // Assume today if missing
      if (override && override.customDate) dueDateStr = override.customDate;
      
      const days = getDaysDiff(dueDateStr);
      if (days <= 7) {
        currentReminders.push({
          studentId: student.id,
          name: student.name,
          phone: student.phone,
          seatNumber: student.seatNumber,
          planName: student.planName,
          type,
          dueDateStr,
          daysRemaining: days,
          color: getColor(days),
          badgeClass: getBadgeClass(getColor(days))
        });
      }
    }
  });

  // Sort both arrays: Red (Overdue) -> Orange -> Yellow -> Green
  const sortReminders = (a, b) => a.daysRemaining - b.daysRemaining;
  currentReminders.sort(sortReminders);
  oldReminders.sort(sortReminders);

  return { currentReminders, oldReminders };
};
