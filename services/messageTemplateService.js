import { collection, addDoc, getDocs, updateDoc, deleteDoc, doc } from "firebase/firestore";
import { db } from "../firebase/firebase.js";

const DEFAULT_TEMPLATES = [
  {
    name: "Renewal Reminder",
    message: `Hi {StudentName}, 👋
🔔 Reminder

You have {DaysRemaining} days left. Your subscription will be over in {DaysRemaining} days.⏳
Renew your subscription soon to continue using your seat.🔄

*Payment Details* 💳
UPI Mobile No. : {UpiMobile}

Have a Good Day! ✨
- {LibraryName} 📚

———————————

નમસ્તે {StudentName}, 🙏
🔔 રીમાઇન્ડર

તમારી પાસે {DaysRemaining} દિવસ બાકી છે. {DaysRemaining} દિવસમાં તમારું સબ્સ્ક્રિપ્શન સમાપ્ત થઈ જવાનું છે.⏳
પોતાની સીટ જાળવી રાખવા માટે જલ્દીથી સબ્સ્ક્રિપ્શન રિન્યુઅલ કરાવો. 🔄

*Payment Details* 💳
UPI Mobile No. : {UpiMobile}

આપનો દિવસ શુભ રહે! ✨
- {LibraryName} 📚`
  },
  {
    name: "Seat Finalized",
    message: `Hi {StudentName},
📚 Welcome To {LibraryName}
🙏 Thank You For Choosing Us.

✨ Your Subscription Details ✨

📅 Start Date: {StartDate}
📅 End Date: {EndDate}

💺 Seat No.: {SeatNumber}

😊 We are very glad to have you with us, and hope that you will find the following details helpful. Thank you!

📞 Contact: {ContactPhone}

———————————

નમસ્તે {StudentName},

📚 {LibraryName} માં આપનું સ્વાગત છે!
🙏 અમને પસંદ કરવા બદલ આભાર.

✨ તમારા સબ્સ્ક્રિપ્શન ની વિગત ✨

📅 પ્રારંભ તારીખ: {StartDate}
📅 અંતિમ તારીખ: {EndDate}

💺 સીટ નંબર: {SeatNumber}

😊 તમે અમારી સાથે હોવાનો અમને ખૂબ આનંદ છે અને આશા છે કે આ વિગતો તમને મદદરૂપ થશે. આભાર!

📞 સંપર્ક: {ContactPhone}`
  },
  {
    name: "Payment Reminder",
    message: `Hi {StudentName}, 👋
🔔 Fee Payment Reminder

Your fee of ₹{PendingAmount} for {MembershipPlan} is pending. Kindly complete your payment by {RenewalDate}. Thank you.

*Payment Details* 💳
UPI Mobile No. : {UpiMobile}

Have a Good Day! ✨
- {LibraryName} 📚

———————————

નમસ્તે {StudentName}, 🙏
🔔 ફી રીમાઇન્ડર

તમારી {MembershipPlan} માટેની ₹{PendingAmount} ફી બાકી છે. કૃપા કરીને {RenewalDate} સુધીમાં ચુકવણી પૂર્ણ કરો. આભાર.

*Payment Details* 💳
UPI Mobile No. : {UpiMobile}

આપનો દિવસ શુભ રહે! ✨
- {LibraryName} 📚`
  },
  {
    name: "Payment Confirmation",
    message: `Hi {StudentName}, 👋
Payment Received! ✅

We have successfully received your payment of ₹{PendingAmount} for {MembershipPlan}.

*Payment Details* 💳
Transaction ID : {TransactionId}
Seat No. : {SeatNumber}

Thank you for choosing {LibraryName}! ✨
📞 Contact: {ContactPhone}

———————————

નમસ્તે {StudentName}, 🙏
ચુકવણી પ્રાપ્ત થઈ ગઈ છે! ✅

અમને {MembershipPlan} માટે તમારી ₹{PendingAmount} ની ચુકવણી સફળતાપૂર્વક મળી છે.

*Payment Details* 💳
Transaction ID : {TransactionId}
સીટ નંબર : {SeatNumber}

{LibraryName} પસંદ કરવા બદલ આપનો આભાર! ✨
📞 સંપર્ક: {ContactPhone}`
  },
  {
    name: "Birthday Wish",
    message: "Happy Birthday {StudentName}! 🎂🎉 Wishing you a wonderful, happy and successful year ahead from {LibraryName}."
  },
  {
    name: "Thank You Message",
    message: "Thank you {StudentName} for being a valued member of {LibraryName}. We are glad to support your study goals! 🙏"
  },
  {
    name: "Feedback Request",
    message: "Hello {StudentName}, we value your feedback. Please let us know how your experience at {LibraryName} has been."
  }
];

export const seedInitialTemplates = async () => {
  const role = localStorage.getItem("userRole");
  if (role === "Student") return;

  try {
    const templatesRef = collection(db, "messageTemplates");
    const snap = await getDocs(templatesRef);
    
        const existingNames = new Set(snap.docs.map(d => String(d.data().name || '').trim().toLowerCase()));
    for (const t of DEFAULT_TEMPLATES) {
      if (!existingNames.has(t.name.toLowerCase())) {
        await addDoc(templatesRef, t);
      }
    }
  } catch (err) {
    console.warn("Failed to seed templates:", err);
  }
};

export const fetchAllTemplates = async () => {
  try {
    const templatesRef = collection(db, "messageTemplates");
    const snap = await getDocs(templatesRef);
    const rawList = [];
    snap.forEach(doc => rawList.push({ id: doc.id, ...doc.data() }));

    // Deduplicate by normalized lowercase name to ensure no duplicates in UI
    const seenNames = new Map();
    const duplicatesToDelete = [];
    const uniqueTemplates = [];

    for (const t of rawList) {
      const name = String(t.name || "").trim();
      const norm = name.toLowerCase();
      if (!norm) continue;

      let cleanedMsg = t.message || "";
      cleanedMsg = cleanedMsg.replace(/\*Payment Details:\*\s*💳/gi, "*Payment Details* 💳");
      cleanedMsg = cleanedMsg.replace(/Payment Details:\*\s*💳/gi, "*Payment Details* 💳");
      cleanedMsg = cleanedMsg.replace(/\*Payment Details\s*:\s*\*/gi, "*Payment Details*");
      cleanedMsg = cleanedMsg.replace(/Payment Details:\s*💳/gi, "*Payment Details* 💳");
      cleanedMsg = cleanedMsg.replace(/\*Payment Details\*\s*:\s*💳/gi, "*Payment Details* 💳");
      cleanedMsg = cleanedMsg.replace(/\*Payment Details:\*/gi, "*Payment Details*");
      cleanedMsg = cleanedMsg.replace(/Payment Details:\*/gi, "*Payment Details*");
      cleanedMsg = cleanedMsg.replace(/UPI ID\s*:[^\n]*\r?\n?/gi, "");
      if (cleanedMsg !== t.message) {
        t.message = cleanedMsg;
        if (t.id && !t.id.startsWith("default_")) {
          updateDoc(doc(db, "messageTemplates", t.id), { message: cleanedMsg }).catch(() => {});
        }
      }

      if (seenNames.has(norm)) {
        duplicatesToDelete.push(t.id);
      } else {
        seenNames.set(norm, t);
        uniqueTemplates.push({ ...t, name });
      }
    }

    // Clean up duplicate Firestore documents in the background
    if (duplicatesToDelete.length > 0) {
      duplicatesToDelete.forEach(id => {
        deleteDoc(doc(db, "messageTemplates", id)).catch(() => {});
      });
    }

    // If empty or missing canonical templates, seed them into unique list
    if (uniqueTemplates.length === 0) {
      for (const t of DEFAULT_TEMPLATES) {
        try {
          const docRef = await addDoc(templatesRef, t);
          uniqueTemplates.push({ id: docRef.id, ...t });
        } catch (_) {}
      }
    } else {
      // Ensure the canonical ones like "Seat Finalized" or updated "Renewal Reminder" exist
      for (const def of DEFAULT_TEMPLATES) {
        const defNorm = def.name.trim().toLowerCase();
        if (!seenNames.has(defNorm)) {
          try {
            const docRef = await addDoc(templatesRef, def);
            uniqueTemplates.push({ id: docRef.id, ...def });
            seenNames.set(defNorm, def);
          } catch (_) {}
        }
      }
    }

    return uniqueTemplates;
  } catch (error) {
    console.error("Error fetching templates:", error);
    return DEFAULT_TEMPLATES.map((t, idx) => ({ id: `default_${idx}`, ...t }));
  }
};

export const addTemplate = async (templateData) => {
  const templatesRef = collection(db, "messageTemplates");
  const docRef = await addDoc(templatesRef, templateData);
  return { id: docRef.id, ...templateData };
};

export const updateTemplate = async (id, templateData) => {
  const docRef = doc(db, "messageTemplates", id);
  await updateDoc(docRef, templateData);
  return { id, ...templateData };
};

export const deleteTemplate = async (id) => {
  const docRef = doc(db, "messageTemplates", id);
  await deleteDoc(docRef);
};
