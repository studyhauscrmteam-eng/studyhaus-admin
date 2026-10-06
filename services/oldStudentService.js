import { collection, doc, query, where, onSnapshot, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase/firebase.js";

/**
 * Listens specifically for students marked as "Old".
 */
export const listenToOldStudents = (onUpdate, onError) => {
  const q = query(collection(db, "students"), where("status", "==", "Old"));
  return onSnapshot(q, (snapshot) => {
    const students = [];
    snapshot.forEach(doc => students.push({ id: doc.id, ...doc.data() }));
    // Sort descending by exitDate if available
    students.sort((a, b) => {
      const dateA = a.exitDate ? new Date(a.exitDate).getTime() : 0;
      const dateB = b.exitDate ? new Date(b.exitDate).getTime() : 0;
      return dateB - dateA;
    });
    onUpdate(students);
  }, onError);
};

/**
 * Converts an active student into an old student via Soft Delete.
 * Frees up their seat and records the exit reason and job details.
 */
export const convertToOldStudent = async (studentId, exitReason, jobDetails = "") => {
  try {
    const docRef = doc(db, "students", studentId);
    
    const now = new Date();
    const exitDateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

    await updateDoc(docRef, {
      status: "Old",
      seatNumber: "", // Release seat
      exitDate: exitDateStr,
      exitReason: exitReason,
      jobDetails: jobDetails,
      updatedAt: serverTimestamp()
    });

    try {
      const userDocRef = doc(db, "users", studentId);
      await updateDoc(userDocRef, { status: "Old", updatedAt: serverTimestamp() });
    } catch(e) {}

    return { success: true };
  } catch (error) {
    console.error("Failed to convert student:", error);
    return { success: false, error: error.message };
  }
};

/**
 * Restores an old student back to Active status.
 * Leaves seat empty so admin can reassign it.
 */
export const restoreOldStudent = async (studentId) => {
  try {
    const docRef = doc(db, "students", studentId);
    
    await updateDoc(docRef, {
      status: "Active",
      seatNumber: "", // Leave blank to avoid conflicts
      exitDate: "", // Clear exit data
      exitReason: "",
      updatedAt: serverTimestamp()
    });

    try {
      const userDocRef = doc(db, "users", studentId);
      await updateDoc(userDocRef, { status: "Active", updatedAt: serverTimestamp() });
    } catch(e) {}

    return { success: true };
  } catch (error) {
    console.error("Failed to restore student:", error);
    return { success: false, error: error.message };
  }
};

/**
 * Updates the pending fee for an old student.
 */
export const updateOldStudentFee = async (studentId, amount) => {
  try {
    const docRef = doc(db, "students", studentId);
    await updateDoc(docRef, {
      pendingFee: parseFloat(amount) || 0,
      updatedAt: serverTimestamp()
    });
    return { success: true };
  } catch (error) {
    console.error("Failed to update pending fee:", error);
    return { success: false, error: error.message };
  }
};

/**
 * Updates the current position for an old student.
 */
export const updateOldStudentPosition = async (studentId, position) => {
  try {
    const docRef = doc(db, "students", studentId);
    await updateDoc(docRef, {
      currentPosition: position || "",
      updatedAt: serverTimestamp()
    });
    return { success: true };
  } catch (error) {
    console.error("Failed to update current position:", error);
    return { success: false, error: error.message };
  }
};
