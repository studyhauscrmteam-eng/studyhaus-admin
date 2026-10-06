import { collection, addDoc, updateDoc, deleteDoc, doc, query, onSnapshot, serverTimestamp, orderBy } from "firebase/firestore";
import { db } from "../firebase/firebase.js";
import { validateExpenseCategory } from "./expenseValidation.js";

export const listenToExpenseCategories = (onUpdate) => {
  const q = query(collection(db, "expenseCategories"), orderBy("createdAt", "asc"));
  return onSnapshot(q, (snapshot) => {
    const cats = [];
    snapshot.forEach(doc => cats.push({ id: doc.id, ...doc.data() }));
    onUpdate(cats);
  });
};

export const addExpenseCategory = async (name) => {
  try {
    validateExpenseCategory(name);
    await addDoc(collection(db, "expenseCategories"), {
      name: name.trim(),
      enabled: true,
      createdAt: serverTimestamp()
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const updateExpenseCategory = async (id, newName) => {
  try {
    validateExpenseCategory(newName);
    const catRef = doc(db, "expenseCategories", id);
    await updateDoc(catRef, { name: newName.trim() });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const toggleExpenseCategory = async (id, currentStatus) => {
  try {
    const catRef = doc(db, "expenseCategories", id);
    await updateDoc(catRef, { enabled: !currentStatus });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const deleteExpenseCategory = async (id) => {
  try {
    const catRef = doc(db, "expenseCategories", id);
    await deleteDoc(catRef);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
