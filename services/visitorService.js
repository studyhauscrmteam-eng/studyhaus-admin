import { collection, addDoc, updateDoc, deleteDoc, doc, query, onSnapshot, serverTimestamp, getDocs } from "firebase/firestore";
import { db } from "../firebase/firebase.js";
import { validateVisitor } from "./visitorValidation.js";

// ===============================================
// VISITOR PURPOSES (Seeding and Listening)
// ===============================================

const DEFAULT_PURPOSES = [
  "Admission Inquiry",
  "Fee Inquiry",
  "Student Meeting",
  "Complaint",
  "Delivery",
  "Maintenance",
  "Parent Visit",
  "Other"
];

export const seedInitialPurposes = async () => {
  const purposesRef = collection(db, "visitorPurposes");
  const snap = await getDocs(purposesRef);
  
  if (snap.empty) {
    console.log("Seeding default visitor purposes...");
    for (const p of DEFAULT_PURPOSES) {
      await addDoc(purposesRef, { name: p });
    }
  }
};

export const listenToVisitorPurposes = (onUpdate) => {
  const q = query(collection(db, "visitorPurposes"));
  return onSnapshot(q, (snapshot) => {
    const purposes = [];
    snapshot.forEach(doc => purposes.push({ id: doc.id, ...doc.data() }));
    // Sort alphabetically
    purposes.sort((a, b) => a.name.localeCompare(b.name));
    onUpdate(purposes);
  });
};

// ===============================================
// VISITORS CRUD & LISTENERS
// ===============================================

export const listenToVisitors = (onUpdate) => {
  const q = query(collection(db, "visitors"));
  return onSnapshot(q, (snapshot) => {
    const records = [];
    snapshot.forEach(doc => records.push({ id: doc.id, ...doc.data() }));
    // Sort descending by created time or visitDate/time
    records.sort((a, b) => {
      const timeA = new Date(`${a.visitDate}T${a.visitTime}`).getTime();
      const timeB = new Date(`${b.visitDate}T${b.visitTime}`).getTime();
      return timeB - timeA;
    });
    onUpdate(records);
  });
};

export const addVisitor = async (visitorData, authorId) => {
  try {
    validateVisitor(visitorData);
    
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

    await addDoc(collection(db, "visitors"), {
      visitorName: visitorData.visitorName.trim(),
      phone: visitorData.phone.trim(),
      purpose: visitorData.purpose,
      employeeName: visitorData.employeeName.trim(),
      employeeId: authorId,
      visitDate: dateStr,
      visitTime: timeStr,
      status: "Active", // Defaults to Active (in the building)
      remarks: (visitorData.remarks || "").trim(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const updateVisitorStatus = async (id, newStatus) => {
  try {
    const docRef = doc(db, "visitors", id);
    await updateDoc(docRef, {
      status: newStatus,
      updatedAt: serverTimestamp()
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const deleteVisitor = async (id) => {
  try {
    const docRef = doc(db, "visitors", id);
    await deleteDoc(docRef);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
