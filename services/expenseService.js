import { collection, addDoc, updateDoc, deleteDoc, doc, query, onSnapshot, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase/firebase.js";
import { validateExpense } from "./expenseValidation.js";

export const listenToExpenses = (onUpdate) => {
  const q = query(collection(db, "expenses"));
  return onSnapshot(q, (snapshot) => {
    const records = [];
    snapshot.forEach(doc => records.push({ id: doc.id, ...doc.data() }));
    // Sort descending by date locally
    records.sort((a, b) => new Date(b.expenseDate) - new Date(a.expenseDate));
    onUpdate(records);
  });
};

export const listenToDashboardExpenses = (onUpdate) => {
  const q = query(collection(db, "expenses"));
  return onSnapshot(q, (snapshot) => {
    let todayExpenses = 0;
    
    // YYYY-MM-DD for today
    const d = new Date();
    const todayStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.expenseDate === todayStr) {
        todayExpenses += Number(data.amount) || 0;
      }
    });

    onUpdate({ todayExpenses });
  });
};

export const addExpense = async (expenseData, categoryName, authorName) => {
  try {
    validateExpense(expenseData);
    await addDoc(collection(db, "expenses"), {
      expenseName: expenseData.expenseName.trim(),
      categoryId: expenseData.categoryId,
      categoryName: categoryName,
      amount: Number(expenseData.amount),
      paymentMethod: expenseData.paymentMethod,
      vendor: (expenseData.vendor || "").trim(),
      description: (expenseData.description || "").trim(),
      expenseDate: expenseData.expenseDate,
      status: expenseData.status || "Paid",
      createdBy: authorName,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const updateExpense = async (id, expenseData, categoryName) => {
  try {
    validateExpense(expenseData);
    const docRef = doc(db, "expenses", id);
    await updateDoc(docRef, {
      expenseName: expenseData.expenseName.trim(),
      categoryId: expenseData.categoryId,
      categoryName: categoryName,
      amount: Number(expenseData.amount),
      paymentMethod: expenseData.paymentMethod,
      vendor: (expenseData.vendor || "").trim(),
      description: (expenseData.description || "").trim(),
      expenseDate: expenseData.expenseDate,
      status: expenseData.status || "Paid",
      updatedAt: serverTimestamp()
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const deleteExpense = async (id) => {
  try {
    const docRef = doc(db, "expenses", id);
    await deleteDoc(docRef);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
