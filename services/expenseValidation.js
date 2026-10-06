/**
 * Validates expense category logic.
 */
export const validateExpenseCategory = (name) => {
  if (!name || name.trim() === "") {
    throw new Error("Category name is required.");
  }
  return true;
};

/**
 * Validates an expense submission.
 */
export const validateExpense = (expenseData) => {
  if (!expenseData.expenseName || expenseData.expenseName.trim() === "") {
    throw new Error("Expense Name is required.");
  }
  if (!expenseData.categoryId) {
    throw new Error("Expense Category is required.");
  }
  if (!expenseData.amount || Number(expenseData.amount) <= 0) {
    throw new Error("Amount must be greater than zero.");
  }
  if (!expenseData.expenseDate || expenseData.expenseDate.trim() === "") {
    throw new Error("Expense Date is required.");
  }
  if (!expenseData.paymentMethod || expenseData.paymentMethod.trim() === "") {
    throw new Error("Payment Method is required.");
  }

  const validMethods = ["UPI", "Cash", "Cheque"];
  if (!validMethods.includes(expenseData.paymentMethod)) {
    throw new Error("Invalid Payment Method selected.");
  }

  return true;
};
