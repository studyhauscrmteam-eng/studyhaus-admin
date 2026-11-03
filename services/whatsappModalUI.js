import { fetchAllTemplates, seedInitialTemplates } from "./messageTemplateService.js";
import { replacePlaceholders, sendWhatsAppMessage } from "./whatsappService.js";
import { getSettings } from "./settingsService.js";

// Make sure initial canonical templates exist in background
seedInitialTemplates();

let modalInjected = false;
let currentStudentData = null;
let activeSettings = null;

export const openWhatsAppModal = async (studentData) => {
  let student = studentData || {};
  if (typeof student === "string") {
    student = { id: student };
  }

  const targetId = student.id || student.studentId;
  // If targetId is provided and we lack core details (like name or phone), load directly from Firestore
  if (targetId && (!student.name || !student.phone || !student.seatNumber)) {
    try {
      const { doc, getDoc } = await import("firebase/firestore");
      const { db } = await import("../firebase/firebase.js");
      const snap = await getDoc(doc(db, "students", targetId));
      if (snap.exists()) {
        const fetched = { id: snap.id, ...snap.data() };
        student = { ...fetched, ...student };
      }
    } catch (e) {
      console.warn("Could not fetch full student details:", e);
    }
  }

  // If transactionId is missing, dynamically fetch real payment transactionId for this student
  let txnId = student.transactionId || student.txnId || student.utr || "";
  if (!txnId && (targetId || student.name)) {
    try {
      const { collection, query, where, getDocs, limit } = await import("firebase/firestore");
      const { db } = await import("../firebase/firebase.js");
      let snap;
      if (targetId) {
        snap = await getDocs(query(collection(db, "payments"), where("studentId", "==", targetId), limit(5)));
      }
      if ((!snap || snap.empty) && student.name) {
        snap = await getDocs(query(collection(db, "payments"), where("studentName", "==", student.name), limit(5)));
      }
      if (snap && !snap.empty) {
        const docWithTxn = snap.docs.find(d => {
          const t = d.data().transactionId;
          return t && String(t).trim() !== "" && !/^(rc-imp|rc-n\/a|cash|—|-)$/i.test(String(t).trim());
        });
        if (docWithTxn) {
          txnId = docWithTxn.data().transactionId;
        } else if (snap.docs[0].data().transactionId) {
          txnId = snap.docs[0].data().transactionId;
        }
      }
    } catch (e) {
      console.warn("Could not fetch payment transactionId for student:", e);
    }
  }

  // Ensure normalized fields with real student data
  const rawSeat = student.seatNumber || student.seatAssigned || "";
  const seatFormatted = rawSeat ? (String(rawSeat).trim().toLowerCase().startsWith("seat") ? String(rawSeat).trim() : `Seat ${String(rawSeat).trim()}`) : "";

  currentStudentData = {
    ...student,
    id: student.id || student.studentId || targetId || "",
    name: student.name || student.fullName || "Student",
    fullName: student.name || student.fullName || "Student",
    phone: student.phone || student.mobile || "",
    transactionId: txnId,
    txnId: txnId,
    seatNumber: seatFormatted,
    seatFloor: student.seatFloor || student.floor || (seatFormatted ? "Ground Floor" : ""),
    planName: student.planName || student.membershipPlan || "",
    startDate: student.startDate || student.createdAt || student.admissionDate || "",
    endDate: student.endDate || student.paymentDueDate || "",
    renewalDate: student.renewalDate || student.paymentDueDate || student.endDate || "",
    pendingAmount: student.pendingAmount != null ? student.pendingAmount : (student.amount != null ? student.amount : "0"),
    daysRemaining: student.daysRemaining !== undefined ? student.daysRemaining : null
  };
  
  try {
    activeSettings = await getSettings();
  } catch (_) {
    activeSettings = null;
  }

  injectModal();

  const modal = document.getElementById("whatsapp-modal");
  
  // Fetch freshest templates
  let templates = [];
  try {
    templates = await fetchAllTemplates();
  } catch (e) {
    console.error("Error fetching templates:", e);
  }

  const tplSelect = document.getElementById("wa-template");
  const msgPreview = document.getElementById("wa-preview");
  const sendBtn = document.getElementById("wa-send-btn");

  // Populate dropdown with strictly unique templates by normalized name
  let html = `<option value="">-- Select a Template --</option>`;
  const seenNames = new Set();
  const uniqueTemplates = [];

  templates.forEach(t => {
    const norm = String(t.name || "").trim().toLowerCase();
    if (!norm || seenNames.has(norm)) return;
    seenNames.add(norm);
    uniqueTemplates.push(t);
  });

  uniqueTemplates.forEach(t => {
    html += `<option value="${t.id}">${t.name}</option>`;
  });
  html += `<option value="custom">-- Custom Message --</option>`;
  tplSelect.innerHTML = html;

  const updatePreview = () => {
    const val = tplSelect.value;
    if (!val) {
      msgPreview.value = "";
      return;
    }
    if (val === "custom") {
      msgPreview.value = "";
      msgPreview.readOnly = false;
      msgPreview.focus();
      return;
    }

    const t = uniqueTemplates.find(x => x.id === val);
    if (t) {
      msgPreview.value = replacePlaceholders(t.message, currentStudentData, activeSettings);
      msgPreview.readOnly = false;
    }
  };

  tplSelect.onchange = updatePreview;

  // Auto-select template if suggested (e.g. "Seat Finalized" or "Renewal Reminder" or "Payment Reminder")
  if (currentStudentData && currentStudentData.suggestedTemplate) {
    const query = String(currentStudentData.suggestedTemplate).toLowerCase();
    const match = uniqueTemplates.find(t => t.name.toLowerCase().includes(query));
    if (match) {
      tplSelect.value = match.id;
      updatePreview();
    } else {
      tplSelect.selectedIndex = 0;
      updatePreview();
    }
  } else if (uniqueTemplates.length > 0) {
    tplSelect.selectedIndex = 1;
    updatePreview();
  }

  sendBtn.onclick = async () => {
    const val = tplSelect.value;
    if (!val) return window.showToast ? window.showToast("Select a template.", "warning") : alert("Select a template.");
    
    let templateName = "Custom";
    if (val !== "custom") {
      const t = uniqueTemplates.find(x => x.id === val);
      templateName = t ? t.name : "Template";
    }

    const finalMessage = msgPreview.value.trim();
    if (!finalMessage) return window.showToast ? window.showToast("Message cannot be empty.", "warning") : alert("Message cannot be empty.");

    // The send service automatically logs and opens new tab
    const success = await sendWhatsAppMessage(currentStudentData, templateName, finalMessage);
    if (success) {
      closeWhatsAppModal();
    }
  };

  if (typeof modal.showModal === "function") {
    modal.showModal();
  } else {
    modal.style.display = "block";
  }
};

export const closeWhatsAppModal = () => {
  const modal = document.getElementById("whatsapp-modal");
  if (modal) {
    if (typeof modal.close === "function") modal.close();
    else modal.style.display = "none";
  }
};

const injectModal = () => {
  let modal = document.getElementById("whatsapp-modal");
  if (!modal) {
    modal = document.createElement("dialog");
    modal.id = "whatsapp-modal";
    modal.className = "card";
    modal.style.cssText = "border:none; border-radius:14px; padding:0; box-shadow:0 25px 60px rgba(0,0,0,0.5); background:var(--bg-card); color:var(--text-primary); width:min(540px, 94vw); margin:auto;";
    document.body.appendChild(modal);
  }

  // Clean inner content without duplicate Settings buttons in modal header
  modal.innerHTML = `
    <div style="padding:1.5rem; max-height:85vh; overflow-y:auto; box-sizing:border-box;">
      <div style="display:flex; align-items:center; margin-bottom:1.25rem; border-bottom:1px solid var(--border); padding-bottom:0.75rem;">
        <h2 style="margin:0; font-size:1.2rem; font-weight:700; display:flex; align-items:center; gap:8px;">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#25D366" stroke-width="2.5"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
          <span>Send WhatsApp Message</span>
        </h2>
      </div>
      <div style="margin-top:0.75rem;">
        <label style="font-size:0.85rem; font-weight:600; margin:0 0 0.4rem 0; display:block;">Select Template</label>
        <select id="wa-template" class="input-field" style="width:100%; padding:9px 12px; border-radius:8px; border:1px solid var(--border); background:var(--bg-card); color:var(--text-primary); font-size:13.5px; font-weight:500;"></select>
      </div>
      <div style="margin-top:1rem;">
        <label style="display:block; margin-bottom:0.4rem; font-size:0.85rem; font-weight:600;">Message Preview &amp; Edit</label>
        <textarea id="wa-preview" class="input-field" style="width:100%; height:230px; resize:vertical; padding:12px; border-radius:8px; border:1px solid var(--border); background:var(--bg-hover); color:var(--text-primary); font-family:inherit; font-size:13px; line-height:1.5;"></textarea>
      </div>
      <div style="margin-top:1.5rem; display:flex; gap:0.75rem; justify-content:flex-end;">
        <button type="button" class="btn btn-secondary" onclick="window.closeWhatsAppModal()" style="padding:8px 18px; border-radius:8px; font-weight:600;">Cancel</button>
        <button type="button" class="btn btn-primary" id="wa-send-btn" style="background:#25D366; border-color:#25D366; color:#fff; font-weight:700; padding:8px 22px; border-radius:8px; display:inline-flex; align-items:center; gap:6px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M22 2L11 13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          Send via WhatsApp
        </button>
      </div>
    </div>
  `;
  modalInjected = true;
};

// Global Exposure for inline onclick hooks
window.openWhatsAppModal = openWhatsAppModal;
window.closeWhatsAppModal = closeWhatsAppModal;
window.sendWhatsAppMessage = sendWhatsAppMessage;


let currentPaymentData = null;

export const closePaymentWhatsAppModal = () => {
  const modal = document.getElementById("payment-whatsapp-modal");
  if (modal) {
    if (typeof modal.close === "function") modal.close();
    else modal.style.display = "none";
  }
};

window.downloadPaymentInvoiceDirect = async (paymentId) => {
  if (!paymentId) {
    if (window.showToast) window.showToast("No payment record ID found.", "warning");
    return;
  }
  try {
    if (typeof window.downloadAdminPaymentInvoice === "function") {
      await window.downloadAdminPaymentInvoice(paymentId);
    } else {
      const { openReceiptModal } = await import("./receiptService.js?v=60");
      await openReceiptModal({ id: paymentId });
    }
  } catch (e) {
    if (window.showToast) window.showToast("Could not download invoice: " + e.message, "error");
  }
};

const injectPaymentModal = () => {
  let modal = document.getElementById("payment-whatsapp-modal");
  if (!modal) {
    modal = document.createElement("dialog");
    modal.id = "payment-whatsapp-modal";
    modal.className = "card";
    modal.style.cssText = "border:none; border-radius:14px; padding:0; box-shadow:0 25px 60px rgba(0,0,0,0.5); background:var(--bg-card); color:var(--text-primary); width:min(560px, 94vw); margin:auto;";
    document.body.appendChild(modal);
  }

  const d = currentPaymentData || {};
  const isPayLater = d.isPayLater === true;
  const amtDisplay = d.amount ? `₹${Number(d.amount).toLocaleString()}` : "₹0";

  modal.innerHTML = `
    <div style="padding:1.5rem; max-height:85vh; overflow-y:auto; box-sizing:border-box;">
      <div style="margin-bottom:1.15rem; border-bottom:1px solid var(--border); padding-bottom:0.75rem;">
        <h2 style="margin:0; font-size:1.15rem; font-weight:700; display:flex; align-items:center; gap:8px;">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#25D366" stroke-width="2.5"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
          <span>${isPayLater ? "Send Fee Reminder Message" : "Send Payment Successful & Invoice Details"}</span>
        </h2>
        <div style="font-size:12.5px; color:var(--text-secondary); margin-top:5px; line-height:1.4;">
          Student: <strong style="color:var(--text-primary);">${d.name || "Student"}</strong> (${d.phone || "—"}) · ${isPayLater ? "Pending Fee" : "Amount Paid"}: <strong style="color:${isPayLater ? '#ea580c' : '#10b981'};">${amtDisplay}</strong> · ${d.planName || "Membership"}${d.seatNumber ? ` · ${d.seatNumber}` : ""}
        </div>
      </div>

      <div style="margin-top:0.75rem;">
        <label style="font-size:0.85rem; font-weight:600; display:block; margin-bottom:0.4rem;">Message Content</label>
        <textarea id="pay-wa-preview" class="input-field" style="width:100%; height:270px; resize:vertical; padding:12px; border-radius:8px; border:1px solid var(--border); background:var(--bg-hover); color:var(--text-primary); font-family:inherit; font-size:13px; line-height:1.5; box-sizing:border-box;"></textarea>
      </div>

      <div style="margin-top:1.25rem; display:flex; gap:0.75rem; justify-content:flex-end; align-items:center;">
        <button type="button" class="btn btn-secondary" onclick="window.closePaymentWhatsAppModal()" style="padding:8px 18px; border-radius:8px; font-weight:600; font-size:13px;">Cancel</button>
        <button type="button" class="btn btn-primary" id="pay-wa-send-btn" style="background:#25D366; border-color:#25D366; color:#fff; font-weight:700; padding:8px 22px; border-radius:8px; font-size:13px; display:inline-flex; align-items:center; gap:6px; cursor:pointer; box-shadow:0 1px 3px rgba(37,211,102,0.3);">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M22 2L11 13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          <span>Send via WhatsApp</span>
        </button>
      </div>
    </div>
  `;
};

export const openPaymentWhatsAppModal = async (paymentData) => {
  let pay = paymentData || {};
  if (typeof pay === "string") pay = { id: pay };

  const targetId = pay.id || pay.studentId;
  const pmLower = String(pay.paymentMethod || pay.paymentMode || pay.mode || "").toLowerCase().trim();
  const stLower = String(pay.status || "").toLowerCase().trim();
  const isPayLater = pay.isPayLater === true || pmLower.includes("pay later") || pmLower.includes("paylater") || stLower.includes("pay later") || stLower.includes("paylater");
  const isCash = pay.isCash === true || pmLower === "cash";

  const rawTxn = String(pay.transactionId || pay.txnId || pay.utr || "").trim();
  const isJunkTxn = !rawTxn || /^(pay later|paylater|rc-.*|cash|n\/a|na|none|null|undefined|—|-)$/i.test(rawTxn);
  const cleanTxn = (isCash || isPayLater || isJunkTxn) ? "" : rawTxn;

  const rawSeat = pay.seatNumber || pay.seatAssigned || "";
  const seatFormatted = rawSeat ? (String(rawSeat).trim().toLowerCase().startsWith("seat") ? String(rawSeat).trim() : `Seat ${String(rawSeat).trim()}`) : "";

  currentPaymentData = {
    ...pay,
    id: pay.id || targetId || "",
    paymentId: pay.paymentId || pay.id || targetId || "",
    studentId: pay.studentId || "",
    name: pay.name || pay.studentName || pay.fullName || "Student",
    fullName: pay.name || pay.studentName || pay.fullName || "Student",
    phone: pay.phone || pay.studentPhone || pay.mobile || "",
    transactionId: cleanTxn,
    txnId: cleanTxn,
    invoiceNo: pay.invoiceNo || pay.receiptNo || "SRL/2026-27",
    receiptNo: pay.receiptNo || pay.invoiceNo || "SRL/2026-27",
    seatNumber: seatFormatted,
    seatFloor: pay.seatFloor || pay.floor || (seatFormatted ? "Ground Floor" : ""),
    planName: pay.planName || pay.membershipPlan || "Membership Plan",
    membershipPlan: pay.planName || pay.membershipPlan || "Membership Plan",
    pendingAmount: pay.amount != null ? String(pay.amount) : (pay.pendingAmount != null ? String(pay.pendingAmount) : "0"),
    amount: pay.amount != null ? String(pay.amount) : (pay.pendingAmount != null ? String(pay.pendingAmount) : "0"),
    status: isPayLater ? "pay later" : (stLower || "approved"),
    paymentMethod: isCash ? "Cash" : (isPayLater ? "Pay Later" : "UPI"),
    isPayLater: isPayLater,
    isCash: isCash,
    startDate: pay.startDate || pay.date || "",
    endDate: pay.endDate || "",
    renewalDate: pay.renewalDate || pay.paymentDueDate || pay.endDate || pay.date || "",
    daysRemaining: pay.daysRemaining !== undefined ? pay.daysRemaining : null
  };

  try {
    activeSettings = await getSettings();
  } catch (_) {
    activeSettings = null;
  }

  injectPaymentModal();

  const modal = document.getElementById("payment-whatsapp-modal");
  const msgPreview = document.getElementById("pay-wa-preview");
  const sendBtn = document.getElementById("pay-wa-send-btn");

  // Define exact canonical templates for Paid vs Pay Later
  let rawTemplate = "";

  if (isPayLater) {
    // Exact Pay Later Reminder message with bold text and emojis
    rawTemplate = `Hi {StudentName}, 👋
🔔 *Fee Payment Reminder*

Your fee of *₹{PendingAmount}* for *{MembershipPlan}* is pending. Kindly complete your payment by *{RenewalDate}* to continue using your seat. 🔄

*Payment Details* 💳
UPI Mobile No. : {UpiMobile}

Have a Good Day! ✨
- *{LibraryName}* 📚

———————————

નમસ્તે {StudentName}, 🙏
🔔 *ફી રીમાઇન્ડર*

તમારી *{MembershipPlan}* માટેની *₹{PendingAmount}* ફી બાકી છે. પોતાની સીટ જાળવી રાખવા માટે કૃપા કરીને *{RenewalDate}* સુધીમાં ચુકવણી પૂર્ણ કરો. 🔄

*Payment Details* 💳
UPI Mobile No. : {UpiMobile}

આપનો દિવસ શુભ રહે! ✨
- *{LibraryName}* 📚`;
  } else {
    // Exact Paid / Payment Successful message with Welcome, Dates, Seat, Amount, Invoice, Contact
    rawTemplate = `Hi {StudentName},
📚 *Welcome To {LibraryName}*
🙏 *Thank You For Choosing Us.*

✨ *Your Subscription Details* ✨

📅 *Start Date:* {StartDate}
📅 *End Date:* {EndDate}

💺 *Seat No.:* {SeatNumber}
💳 *Amount Paid:* ₹{Amount}
🧾 *Invoice No.:* {InvoiceNo}

😊 We are very glad to have you with us, and hope that you will find the following details helpful. Thank you!

📞 *Contact:* {ContactPhone}

———————————

નમસ્તે {StudentName},

📚 *{LibraryName} માં આપનું સ્વાગત છે!*
🙏 *અમને પસંદ કરવા બદલ આભાર.*

✨ *તમારા સબ્સ્ક્રિપ્શન ની વિગત* ✨

📅 *પ્રારંભ તારીખ:* {StartDate}
📅 *અંતિમ તારીખ:* {EndDate}

💺 *સીટ નંબર:* {SeatNumber}
💳 *ચૂકવેલ રકમ:* ₹{Amount}
🧾 *ઇનવોઇસ નંબર:* {InvoiceNo}

😊 તમે અમારી સાથે હોવાનો અમને ખૂબ આનંદ છે અને આશા છે કે આ વિગતો તમને મદદરૂપ થશે. આભાર!

📞 *સંપર્ક:* {ContactPhone}`;
  }

  msgPreview.value = replacePlaceholders(rawTemplate, currentPaymentData, activeSettings);

  sendBtn.onclick = async () => {
    const finalMessage = msgPreview.value.trim();
    if (!finalMessage) return window.showToast ? window.showToast("Message cannot be empty.", "warning") : alert("Message cannot be empty.");

    const tplName = isPayLater ? "Fee Payment Reminder" : "Payment Successful & Invoice";
    const success = await sendWhatsAppMessage(currentPaymentData, tplName, finalMessage);
    if (success) {
      closePaymentWhatsAppModal();
    }
  };

  if (typeof modal.showModal === "function") {
    modal.showModal();
  } else {
    modal.style.display = "block";
  }
};

window.openPaymentWhatsAppModal = openPaymentWhatsAppModal;
window.closePaymentWhatsAppModal = closePaymentWhatsAppModal;
