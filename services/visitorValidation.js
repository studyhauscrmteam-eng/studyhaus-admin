/**
 * Validates a visitor submission.
 *
 * Two shapes reach this validator:
 *  - manual walk-ins entered by staff (source "Walk-in") — an employee must
 *    be recorded as the person handling the visit;
 *  - website leads (source "Website") written by the public site — no staff
 *    member exists yet, so `employeeName` is NOT required for them, but an
 *    email may be present and is validated loosely.
 */
const VALID_SOURCES = ["Website", "Walk-in"];
const VALID_LEAD_STATUSES = ["New", "Converted", "Closed"];

export const validateVisitor = (visitorData) => {
  const data = visitorData || {};
  const source = String(data.source || "Walk-in").trim();

  if (!data.visitorName || data.visitorName.trim() === "") {
    throw new Error("Visitor Name is required.");
  }

  if (!data.phone || data.phone.trim() === "") {
    throw new Error("Phone Number is required.");
  }

  // Basic 10 digit Indian phone validation
  const phoneRegex = /^[0-9]{10}$/;
  if (!phoneRegex.test(data.phone.trim())) {
    throw new Error("Please enter a valid 10-digit phone number.");
  }

  if (!data.purpose || data.purpose.trim() === "") {
    throw new Error("Visit Purpose is required.");
  }

  if (VALID_SOURCES.indexOf(source) === -1) {
    throw new Error('Source must be either "Website" or "Walk-in".');
  }

  // Employee in charge: only walk-ins handled by staff need one.
  // A website lead arrives with an empty employeeName — that is normal.
  if (source !== "Website" && (!data.employeeName || data.employeeName.trim() === "")) {
    throw new Error("Employee Handling Visit is required.");
  }

  // Email is optional and deliberately loose: "a@b", "name+tag@mail.co.in"
  // and similar must all pass — only obvious garbage is rejected.
  const email = String(data.email || "").trim();
  if (email.length > 160) {
    throw new Error("Email address is too long (max 160 characters).");
  }
  if (email && !/^[^\s@]+@[^\s@]+$/.test(email)) {
    throw new Error("Please enter a valid email address.");
  }

  const message = String(data.message || "");
  if (message.length > 1000) {
    throw new Error("Message is too long (max 1000 characters).");
  }

  const leadStatus = String(data.leadStatus || "").trim();
  if (leadStatus && VALID_LEAD_STATUSES.indexOf(leadStatus) === -1) {
    throw new Error('Lead status must be "New", "Converted" or "Closed".');
  }

  return true;
};
