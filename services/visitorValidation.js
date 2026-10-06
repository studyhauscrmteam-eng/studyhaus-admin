/**
 * Validates a visitor submission.
 */
export const validateVisitor = (visitorData) => {
  if (!visitorData.visitorName || visitorData.visitorName.trim() === "") {
    throw new Error("Visitor Name is required.");
  }
  
  if (!visitorData.phone || visitorData.phone.trim() === "") {
    throw new Error("Phone Number is required.");
  }

  // Basic 10 digit Indian phone validation
  const phoneRegex = /^[0-9]{10}$/;
  if (!phoneRegex.test(visitorData.phone.trim())) {
    throw new Error("Please enter a valid 10-digit phone number.");
  }

  if (!visitorData.purpose || visitorData.purpose.trim() === "") {
    throw new Error("Visit Purpose is required.");
  }

  if (!visitorData.employeeName || visitorData.employeeName.trim() === "") {
    throw new Error("Employee Handling Visit is required.");
  }

  return true;
};
