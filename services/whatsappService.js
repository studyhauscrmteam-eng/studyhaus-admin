import { logWhatsAppMessage } from "./messageLogService.js";
import { getSettings } from "./settingsService.js";

/**
 * Formats a date string (YYYY-MM-DD or ISO) into DD/MM/YYYY for friendly Indian display
 */
const formatDateFriendly = (dateInput) => {
  if (!dateInput) return "";
  try {
    let d;
    if (typeof dateInput === "object" && dateInput.seconds) {
      d = new Date(dateInput.seconds * 1000);
    } else {
      d = new Date(dateInput);
    }
    if (isNaN(d.getTime())) return String(dateInput);
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  } catch (_) {
    return String(dateInput);
  }
};

/**
 * Calculates days remaining until renewal or payment due date
 */
const calculateDaysLeft = (targetDateStr) => {
  if (!targetDateStr) return 7;
  try {
    let target;
    if (typeof targetDateStr === "object" && targetDateStr.seconds) {
      target = new Date(targetDateStr.seconds * 1000);
    } else {
      target = new Date(targetDateStr);
    }
    if (isNaN(target.getTime())) return 7;
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    target.setHours(0, 0, 0, 0);
    const diff = Math.round((target - now) / (1000 * 60 * 60 * 24));
    return diff >= 0 ? diff : 0;
  } catch (_) {
    return 7;
  }
};

/**
 * Replaces placeholders in a message template based on student data and library settings.
 * Supports standard placeholders plus any arbitrary fields.
 */
export const replacePlaceholders = (templateString, studentData = {}, settings = null) => {
  if (!templateString) return "";

  let result = templateString;

  const fullName = studentData.fullName || studentData.name || "Student";
  const rawSeat = studentData.seatNumber || studentData.seatAssigned || "";
  let seatDisplay = "N/A";
  if (rawSeat) {
    seatDisplay = String(rawSeat).trim();
    if (!seatDisplay.toLowerCase().startsWith("seat")) {
      seatDisplay = `Seat ${seatDisplay}`;
    }
  }

  const seatFloor = studentData.seatFloor || studentData.floor || (rawSeat ? "Ground Floor" : "");
  const plan = studentData.planName || studentData.membershipPlan || "Plan";
  const pending = studentData.pendingAmount != null ? String(studentData.pendingAmount) : (studentData.amount != null ? String(studentData.amount) : "0");
  
  const rawEnd = studentData.endDate || studentData.renewalDate || studentData.paymentDueDate || "";
  const endDisplay = formatDateFriendly(rawEnd) || "Date";

  const rawRenewal = studentData.renewalDate || studentData.paymentDueDate || studentData.endDate || "";
  const renewalDisplay = formatDateFriendly(rawRenewal) || "Date";

  const startDisplay = formatDateFriendly(studentData.startDate || studentData.createdAt || studentData.admissionDate) || "Date";

  const daysRemaining = (studentData.daysRemaining !== undefined && studentData.daysRemaining !== null)
    ? String(studentData.daysRemaining)
    : String(calculateDaysLeft(rawEnd || rawRenewal));

  const upiId = (settings && settings.upiId) || studentData.upiId || "";
  const upiMobile = (settings && (settings.upiMobile || settings.upiPhone)) || (settings && settings.phone) || studentData.upiMobile || "";
  const contactPhone = (settings && settings.phone) || studentData.contactPhone || "6353321530";
  const libName = (settings && settings.spaceName) || studentData.libraryName || "Shreeji Premium Reading Library";

  const pmLower = String(studentData.paymentMethod || studentData.paymentMode || studentData.mode || "").trim().toLowerCase();
  const stLower = String(studentData.status || "").trim().toLowerCase();
  const isCash = studentData.isCash === true || pmLower === "cash";
  const isPayLater = studentData.isPayLater === true || pmLower.includes("pay later") || pmLower.includes("paylater") || stLower.includes("pay later") || stLower.includes("paylater");

  const rawTxn = String(studentData.transactionId || studentData.txnId || studentData.utr || "").trim();
  const isJunkTxn = !rawTxn || /^(pay later|paylater|rc-.*|cash|n\/a|na|none|null|undefined|—|-)$/i.test(rawTxn);
  const realTxn = (isCash || isPayLater || isJunkTxn) ? "" : rawTxn;

  // Ensure clean heading *Payment Details* 💳 without colons or misplaced stars
  result = result.replace(/\*Payment Details:\*\s*💳/gi, "*Payment Details* 💳");
  result = result.replace(/Payment Details:\*\s*💳/gi, "*Payment Details* 💳");
  result = result.replace(/\*Payment Details\s*:\s*\*/gi, "*Payment Details*");
  result = result.replace(/Payment Details:\s*💳/gi, "*Payment Details* 💳");
  result = result.replace(/\*Payment Details\*\s*:\s*💳/gi, "*Payment Details* 💳");
  result = result.replace(/\*Payment Details:\*/gi, "*Payment Details*");
  result = result.replace(/Payment Details:\*/gi, "*Payment Details*");

  // Strip any legacy hardcoded UPI ID / VPA lines completely (e.g. UPI ID : 7405705669@okbizaxi)
  result = result.replace(/UPI ID\s*:[^\n]*\r?\n?/gi, "");

  // Handle Cash vs Pay Later vs Online/UPI
  if (isCash) {
    result = result.replace(/Transaction ID\s*:[^\n]*\r?\n?/gi, "Payment Mode : Cash\n");
    result = result.replace(/ટ્રાન્ઝેક્શન આઈડી\s*:[^\n]*\r?\n?/gi, "ચુકવણી પદ્ધતિ : રોકડ (Cash)\n");
    result = result.replace(/{TransactionId}/gi, "Cash");
    result = result.replace(/{TxnId}/gi, "Cash");
    result = result.replace(/{Utr}/gi, "Cash");
  } else if (isPayLater || !realTxn) {
    // For Pay Later or records without UTR, completely omit the Transaction ID line from the reminder
    result = result.replace(/Transaction ID\s*:[^\n]*\r?\n?/gi, "");
    result = result.replace(/ટ્રાન્ઝેક્શન આઈડી\s*:[^\n]*\r?\n?/gi, "");
    result = result.replace(/{TransactionId}/gi, "");
    result = result.replace(/{TxnId}/gi, "");
    result = result.replace(/{Utr}/gi, "");
  } else {
    result = result.replace(/{TransactionId}/gi, realTxn);
    result = result.replace(/{TxnId}/gi, realTxn);
    result = result.replace(/{Transaction_Id}/gi, realTxn);
    result = result.replace(/{Utr}/gi, realTxn);
  }
  result = result.replace(/{UpiId}/gi, realTxn ? realTxn : (upiId || "—"));
  result = result.replace(/{StudentName}/gi, fullName);
  result = result.replace(/{FullName}/gi, fullName);
  result = result.replace(/{SeatNumber}/gi, seatDisplay);
  result = result.replace(/{SeatFloor}/gi, seatFloor);
  result = result.replace(/{MembershipPlan}/gi, plan);
  result = result.replace(/{PlanName}/gi, plan);
  result = result.replace(/{PendingAmount}/gi, pending);
  result = result.replace(/{Amount}/gi, pending);
  const invNo = studentData.invoiceNo || studentData.receiptNo || (studentData.paymentId ? ('SRL/' + String(studentData.paymentId).slice(-4)) : (studentData.id ? ('SRL/' + String(studentData.id).slice(-4)) : 'SRL/2026-27'));
  result = result.replace(/{InvoiceNo}/gi, invNo);
  result = result.replace(/{ReceiptNo}/gi, invNo);
  result = result.replace(/{RenewalDate}/gi, renewalDisplay);
  result = result.replace(/{EndDate}/gi, endDisplay);
  result = result.replace(/{StartDate}/gi, startDisplay);
  result = result.replace(/{DaysRemaining}/gi, daysRemaining);
  result = result.replace(/{DaysLeft}/gi, daysRemaining);
  result = result.replace(/{UpiId}/gi, upiId);
  result = result.replace(/{UpiMobile}/gi, upiMobile);
  result = result.replace(/{UpiPhone}/gi, upiMobile);
  result = result.replace(/{ContactPhone}/gi, contactPhone);
  result = result.replace(/{Phone}/gi, studentData.phone || "");
  result = result.replace(/{Email}/gi, studentData.email || "");
  result = result.replace(/{College}/gi, studentData.college || "");
  result = result.replace(/{Course}/gi, studentData.course || "");
  result = result.replace(/{ParentPhone}/gi, studentData.parentPhone || "");
  result = result.replace(/{Address}/gi, studentData.address || "");
  result = result.replace(/{LibraryName}/gi, libName);

  // Dynamic regex fallback for any arbitrary field present in studentData
  result = result.replace(/{([a-zA-Z0-9_]+)}/g, (match, field) => {
    if (studentData[field] !== undefined && studentData[field] !== null) {
      return String(studentData[field]);
    }
    // Case-insensitive key lookup
    const lowerKey = field.toLowerCase();
    const foundKey = Object.keys(studentData).find(k => k.toLowerCase() === lowerKey);
    if (foundKey && studentData[foundKey] !== undefined && studentData[foundKey] !== null) {
      return String(studentData[foundKey]);
    }
    return match;
  });

  return result;
};

/**
 * Generates Click-to-Chat URL and logs the message.
 * Respects the WhatsApp messaging enabled/disabled setting.
 */
export const sendWhatsAppMessage = async (studentData, templateName, rawMessage) => {
  let settings = null;
  try {
    settings = await getSettings();
    if (settings && settings.whatsappEnabled === false) {
      if (typeof window.showToast === 'function') {
        window.showToast("WhatsApp messaging is disabled in Settings.", "warning");
      } else {
        alert("WhatsApp messaging is disabled in Settings.");
      }
      return false;
    }
  } catch (_) {}

  if (!studentData || !studentData.phone) {
    if (typeof window.showToast === 'function') {
      window.showToast("Error: Student phone number is missing.", "error");
    } else {
      alert("Error: Student phone number is missing.");
    }
    return false;
  }

  // If rawMessage was already replaced (e.g. from modal textarea), do not re-run regex
  const finalMessage = (typeof rawMessage === "string" && rawMessage.includes("{"))
    ? replacePlaceholders(rawMessage, studentData, settings)
    : String(rawMessage || "");

  // Format phone number (Assume India +91 if length is 10)
  let phoneStr = String(studentData.phone).replace(/[^0-9]/g, "");
  if (phoneStr.length === 10) {
    phoneStr = "91" + phoneStr;
  }

  // Safe clipboard copy immediately preserves exact Gujarati text & emojis
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(finalMessage);
    }
  } catch (_) {}

  const encodedMessage = encodeURIComponent(finalMessage);

  // Directly open WhatsApp Web on desktop or WhatsApp app on mobile to completely bypass wa.me 302 redirect encoding issues
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const url = isMobile
    ? `https://api.whatsapp.com/send?phone=${phoneStr}&text=${encodedMessage}`
    : `https://web.whatsapp.com/send?phone=${phoneStr}&text=${encodedMessage}`;

  // Log to Firestore
  const author = localStorage.getItem("userName") || "Admin";
  await logWhatsAppMessage({
    studentId: studentData.id || "",
    studentName: studentData.fullName || studentData.name || "Student",
    phone: phoneStr,
    templateName: templateName || "Message",
    message: finalMessage,
    sentBy: author
  });

  if (typeof window.showToast === "function") {
    window.showToast("Opening WhatsApp... Message also copied to clipboard!", "success");
  }

  // Open WhatsApp in new tab
  window.open(url, '_blank');
  return true;
};
