import { collection, doc, query, onSnapshot, setDoc, serverTimestamp, getDocs, deleteDoc } from "firebase/firestore";
import { db } from "../firebase/firebase.js";

/**
 * Listens to manual overrides and completed states
 */
export const listenToReminderOverrides = (onUpdate, onError) => {
  const q = query(collection(db, "reminders"));
  return onSnapshot(q, (snapshot) => {
    const overrides = {};
    snapshot.forEach(doc => {
      // document ID will be a composite key e.g. "studentId_type"
      overrides[doc.id] = doc.data();
    });
    onUpdate(overrides);
  }, onError);
};

/**
 * Mark a reminder as completed
 * @param {string} studentId 
 * @param {string} type e.g., "Birthday", "Renewal", "Payment", "Follow-up"
 */
export const markReminderCompleted = async (studentId, type) => {
  try {
    const overrideId = `${studentId}_${type}`;
    const docRef = doc(db, "reminders", overrideId);
    
    await setDoc(docRef, {
      studentId,
      type,
      status: "Completed",
      updatedAt: serverTimestamp()
    }, { merge: true });

    return { success: true };
  } catch (error) {
    console.error("Failed to mark reminder completed:", error);
    return { success: false, error: error.message };
  }
};

/**
 * Reschedule a reminder
 */
export const rescheduleReminder = async (studentId, type, newDateStr) => {
  try {
    const overrideId = `${studentId}_${type}`;
    const docRef = doc(db, "reminders", overrideId);
    
    await setDoc(docRef, {
      studentId,
      type,
      status: "Rescheduled",
      customDate: newDateStr,
      updatedAt: serverTimestamp()
    }, { merge: true });

    return { success: true };
  } catch (error) {
    console.error("Failed to reschedule reminder:", error);
    return { success: false, error: error.message };
  }
};
