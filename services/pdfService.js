/**
 * PDF Generation Service
 * Renders reports using high-fidelity HTML-to-Canvas PDF generation with full Gujarati Unicode support.
 */

export const generateAttendancePDF = async (studentName, records, totalHours) => {
  try {
    const { exportToPDF } = await import("./exportService.js");
    const completedRecords = records.filter(r => r.status === "Completed");
    const rows = completedRecords.map(r => ({
      "Date": r.date || "-",
      "Check In": r.checkIn ? new Date(r.checkIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "-",
      "Check Out": r.checkOut ? new Date(r.checkOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "-",
      "Duration": `${r.duration || 0}h`,
      "Seat": r.seatNumber ? (String(r.seatNumber).toLowerCase().startsWith("seat") ? r.seatNumber : `Seat ${r.seatNumber}`) : "-"
    }));
    const title = `Attendance Report: ${studentName || "Student"} (Total: ${totalHours || 0}h)`;
    await exportToPDF(`${(studentName || "Student").replace(/\s+/g, '_')}_Attendance`, title, rows);
    return { success: true };
  } catch (error) {
    console.error("PDF Generation Error:", error);
    return { success: false, error: error.message };
  }
};

export const generateOldStudentsPDF = async (records) => {
  try {
    const { exportToPDF } = await import("./exportService.js");
    const rows = records.map(r => ({
      "Name": r.name || "Unknown",
      "Phone": r.phone || "-",
      "Last Plan": r.planName || r.lastPlan || "Regular Fixed Seat",
      "Exit Date": r.exitDate || "-",
      "Exit Reason": r.exitReason || "Other",
      "Fee Status": r.pendingFee && r.pendingFee > 0 ? "Pending" : "Paid",
      "Outstanding Amount": r.pendingFee && r.pendingFee > 0 ? `₹${Number(r.pendingFee).toLocaleString()}` : "₹0"
    }));
    await exportToPDF(`Old_Students_Report_${new Date().toISOString().split('T')[0]}`, "Old Students Pending Fees Report", rows);
    return { success: true };
  } catch (error) {
    console.error("PDF Generation Error:", error);
    return { success: false, error: error.message };
  }
};

export const generateInvoicePDF = async (invoiceData = {}) => {
  try {
    if (typeof window.downloadReceiptPDF === "function") {
      return await window.downloadReceiptPDF(invoiceData);
    }
    const { downloadReceiptPDF } = await import("./receiptService.js?v=" + Date.now());
    return await downloadReceiptPDF(invoiceData);
  } catch (error) {
    console.error("Invoice PDF Error:", error);
    return { success: false, error: error.message };
  }
};
