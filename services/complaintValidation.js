/**
 * Validates a student's complaint submission.
 */
export const validateComplaint = (category, description) => {
  if (!category || String(category).trim() === "") {
    throw new Error("Please select a complaint category.");
  }

  if (!description || String(description).trim() === "") {
    throw new Error("Please enter a description for your issue.");
  }

  if (String(description).trim().length < 3) {
    throw new Error("Please enter at least 3 characters for the issue description.");
  }

  return true;
};
