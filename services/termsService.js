import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase/firebase.js";

export const CANONICAL_TERMS = [
  {
    id: "term_1",
    order: 1,
    titleEn: "1. Non-Refundable & Non-Transferable Fees",
    titleGu: "૧. બિન-રિફંડેબલ અને અ-બદલીપાત્ર ફી",
    descEn: "All membership fees once paid are strictly non-refundable, non-transferable, and non-extendable under any circumstances except at management's sole discretion.",
    descGu: "એકવાર ચૂકવેલ સભ્યપદ ફી કોઈપણ સંજોગોમાં પરત (Non-refundable), ટ્રાન્સફર (Non-transferable) કે મુદત વધારી (Non-extendable) શકાશે નહીં."
  },
  {
    id: "term_2",
    order: 2,
    titleEn: "2. Seat Allocation & Reservation",
    titleGu: "૨. સીટ ફાળવણી અને અનામત",
    descEn: "Seat bookings are subject to document verification and library management approval. Seat numbers are allocated strictly based on selected plan availability.",
    descGu: "સીટ બુકિંગ મેનેજમેન્ટની ચકાસણી અને મંજૂરીને આધીન છે. સીટ પસંદ કરેલ પ્લાનની ઉપલબ્ધતા મુજબ જ ફાળવવામાં આવશે."
  },
  {
    id: "term_3",
    order: 3,
    titleEn: "3. Strict Study Hall Silence",
    titleGu: "૩. અભ્યાસ ખંડમાં સંપૂર્ણ શાંતિ",
    descEn: "Absolute pin-drop silence must be maintained in the study hall at all times. Group discussions, talking, and whispering are strictly prohibited.",
    descGu: "સ્ટડી હોલમાં હંમેશા સંપૂર્ણ શાંતિ જાળવવી ફરજિયાત છે. અંદરોઅંદર વાતચીત, ચર્ચા કે ધીમેથી બોલવાની પણ સખત મનાઈ છે."
  },
  {
    id: "term_4",
    order: 4,
    titleEn: "4. Outside Footwear Prohibited",
    titleGu: "૪. બહારના પગરખાં પર પ્રતિબંધ",
    descEn: "Outside footwear (shoes, sandals) is strictly prohibited inside the study hall. Members must keep their designated desk clean and organized.",
    descGu: "અભ્યાસ ખંડની અંદર બહારના પગરખાં (બૂટ/ચંપલ) પહેરીને પ્રવેશવાની સખત મનાઈ છે. ડેસ્ક અને લાઈબ્રેરી પરિસર સ્વચ્છ રાખવું."
  },
  {
    id: "term_5",
    order: 5,
    titleEn: "5. Mobile Phone Discipline",
    titleGu: "૫. મોબાઇલ ફોન અને કોલ્સ નિયમ",
    descEn: "Mobile phones must be kept on 100% silent mode (not even vibration). Attending phone calls inside the study area is strictly prohibited; use designated areas only.",
    descGu: "મોબાઇલ ફોન ૧૦૦% સાયલન્ટ મોડ પર રાખવો (વાઇબ્રેશન પણ નહીં). હોલની અંદર ફોન ઉપાડવાની સખત મનાઈ છે; કોલ માટે નિયત લોબી/બાલ્કનીનો જ ઉપયોગ કરવો."
  },
  {
    id: "term_6",
    order: 6,
    titleEn: "6. Food & Beverages Restrictions",
    titleGu: "૬. ખાનપાન પર પ્રતિબંધ",
    descEn: "Eating meals, snacks, or outside food inside the reading hall is prohibited. Water bottles are allowed. Refreshments are permitted only in designated areas.",
    descGu: "અભ્યાસ ખંડમાં નાસ્તો, જમવાનું કે બહારનો ખોરાક ખાવાની સખત મનાઈ છે. માત્ર પાણીની બોટલ રાખવાની છૂટ છે. નાસ્તા માટે ટેરેસ/રીફ્રેશમેન્ટ એરિયાનો ઉપયોગ કરવો."
  },
  {
    id: "term_7",
    order: 7,
    titleEn: "7. Personal Belongings Responsibility",
    titleGu: "૭. વ્યક્તિગત સામાનની સુરક્ષા",
    descEn: "Students are solely responsible for their personal belongings (laptops, books, chargers, cash). Management accepts no responsibility for lost or unattended items.",
    descGu: "પોતાના લેપટોપ, પુસ્તકો, ચાર્જર અને અંગત સામાનની સંપૂર્ણ જવાબદારી વિદ્યાર્થીની પોતાની રહેશે. ચોરી કે નુકસાન માટે મેનેજમેન્ટ જવાબદાર રહેશે નહીં."
  },
  {
    id: "term_8",
    order: 8,
    titleEn: "8. Care for Library Property & Facilities",
    titleGu: "૮. મિલકત અને ઇલેક્ટ્રિકલ જાળવણી",
    descEn: "Handle library assets, desks, chairs, AC units, and charging sockets with care. Any damage caused will be charged to the student and may result in immediate expulsion.",
    descGu: "ફર્નિચર, લાઇટ, પંખા, એસી અને ચાર્જિંગ પોઇન્ટ્સનો કાળજીપૂર્વક ઉપયોગ કરવો. કોઈપણ નુકસાન બદલ દંડ થશે અને સભ્યપદ રદ થઈ શકે છે."
  },
  {
    id: "term_9",
    order: 9,
    titleEn: "9. Document Verification & Admission Rights",
    titleGu: "૯. દસ્તાવેજ ચકાસણી અને અધિકાર",
    descEn: "Management reserves the right to verify identity documents (Aadhaar Card) and cancel admission without refund if the code of conduct is violated.",
    descGu: "ઓળખ કાર્ડ (આધાર કાર્ડ) ની ચકાસણી કરવાનો અને ગેરવર્તણૂક જણાયે કોઈપણ રિફંડ વિના સભ્યપદ રદ કરવાનો અંતિમ અધિકાર મેનેજમેન્ટનો રહેશે."
  },
  {
    id: "term_10",
    order: 10,
    titleEn: "10. Governing Law & Jurisdiction",
    titleGu: "૧૦. કાયદાકીય ક્ષેત્રાધિકાર",
    descEn: "These terms are governed by the laws of India. Any disputes shall be subject to the exclusive jurisdiction of the competent courts in Bhavnagar, Gujarat.",
    descGu: "આ નિયમો ભારતના કાયદાઓ દ્વારા સંચાલિત છે. કોઈપણ વિવાદ ભાવનગર, ગુજરાતની સક્ષમ અદાલતોના અધિકારક્ષેત્ર હેઠળ રહેશે."
  }
];

const SETTINGS_COLLECTION = "settings";
const TERMS_DOC_ID = "terms_and_conditions";

export const fetchTermsAndConditions = async () => {
  try {
    const docRef = doc(db, SETTINGS_COLLECTION, TERMS_DOC_ID);
    const snap = await getDoc(docRef);
    if (snap.exists() && Array.isArray(snap.data()?.terms) && snap.data().terms.length > 0) {
      return [...snap.data().terms].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
    }

    // Auto-seed canonical default terms if missing
    try {
      await setDoc(docRef, {
        terms: CANONICAL_TERMS,
        updatedAt: new Date().toISOString()
      }, { merge: true });
    } catch (_) {}

    return CANONICAL_TERMS;
  } catch (error) {
    console.warn("Could not fetch terms from Firestore, falling back to canonical defaults:", error);
    return CANONICAL_TERMS;
  }
};

export const saveAllTerms = async (termsArray) => {
  const docRef = doc(db, SETTINGS_COLLECTION, TERMS_DOC_ID);
  const normalized = termsArray.map((t, idx) => ({
    id: t.id || `term_${Date.now()}_${idx}`,
    order: idx + 1,
    titleEn: (t.titleEn || "").trim(),
    titleGu: (t.titleGu || "").trim(),
    descEn: (t.descEn || "").trim(),
    descGu: (t.descGu || "").trim()
  }));

  await setDoc(docRef, {
    terms: normalized,
    updatedAt: new Date().toISOString()
  }, { merge: true });

  return normalized;
};

export const addTerm = async (newTerm) => {
  const current = await fetchTermsAndConditions();
  const id = `term_${Date.now()}`;
  const termObj = {
    id,
    order: current.length + 1,
    titleEn: (newTerm.titleEn || "").trim(),
    titleGu: (newTerm.titleGu || "").trim(),
    descEn: (newTerm.descEn || "").trim(),
    descGu: (newTerm.descGu || "").trim()
  };
  const updated = [...current, termObj];
  await saveAllTerms(updated);
  return termObj;
};

export const updateTerm = async (termId, fields) => {
  const current = await fetchTermsAndConditions();
  const index = current.findIndex(t => t.id === termId);
  if (index === -1) throw new Error("Term not found");

  current[index] = {
    ...current[index],
    titleEn: fields.titleEn !== undefined ? fields.titleEn.trim() : current[index].titleEn,
    titleGu: fields.titleGu !== undefined ? fields.titleGu.trim() : current[index].titleGu,
    descEn: fields.descEn !== undefined ? fields.descEn.trim() : current[index].descEn,
    descGu: fields.descGu !== undefined ? fields.descGu.trim() : current[index].descGu
  };

  await saveAllTerms(current);
  return current[index];
};

export const deleteTerm = async (termId) => {
  const current = await fetchTermsAndConditions();
  const filtered = current.filter(t => t.id !== termId);
  await saveAllTerms(filtered);
  return true;
};

export const reorderTerm = async (termId, direction) => {
  const current = await fetchTermsAndConditions();
  const index = current.findIndex(t => t.id === termId);
  if (index === -1) return current;

  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= current.length) return current;

  const temp = current[index];
  current[index] = current[targetIndex];
  current[targetIndex] = temp;

  return await saveAllTerms(current);
};

