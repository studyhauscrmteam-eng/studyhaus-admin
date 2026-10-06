/**
 * Simulates fetching summary data for the student portal.
 * In later phases, this will connect to 'attendance', 'payments', and 'complaints' collections.
 */

export const fetchStudentSummaries = async (studentId) => {
  // Placeholder for Attendance Summary
  const attendance = {
    todayHours: "0h",
    weeklyHours: "0h",
    monthlyHours: "0h",
    lastCheckIn: "N/A",
    lastCheckOut: "N/A"
  };

  // Placeholder for Payment Summary
  const payment = {
    lastPayment: "N/A",
    totalPaid: "₹0",
    pendingAmount: "₹0",
    nextDueDate: "N/A"
  };

  // Placeholder for Complaints Summary
  const complaints = {
    total: 0,
    pending: 0,
    resolved: 0
  };

  // Placeholder for Notifications
  const notifications = [
    { title: "Welcome!", message: "Your admission is approved.", date: new Date().toLocaleDateString() }
  ];

  return { attendance, payment, complaints, notifications };
};
