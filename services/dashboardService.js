import { listenToEarnings, listenToPendingPayments } from "./paymentService.js";
import { listenToDashboardExpenses } from "./expenseService.js";
import { listenToVisitors } from "./visitorService.js";
import { calculateVisitorAnalytics } from "./visitorAnalytics.js";
import { collection, query, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/firebase.js";

/**
 * Format currency in INR
 */
const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(amount);
};

/**
 * Update UI Helper
 */
const updateElement = (id, value) => {
  const el = document.getElementById(id);
  if (el) {
    el.innerHTML = value;
  }
};

/**
 * Initialize all dashboard real-time listeners
 */
export const initDashboardListeners = () => {
  // Only init if we're on a page with dashboard metrics
  // Check for ANY dashboard metric to prevent running on login/register
  if (!document.querySelector("[id^='metric-']")) return;

  const role = localStorage.getItem("userRole");
  if (role === "Student") return; // Students do not have permission to read global metrics

  // Fast-paint cached values immediately so dashboard is instant
  try {
    const raw = localStorage.getItem("shreeji_cached_metrics");
    if (raw) {
      const cached = JSON.parse(raw);
      for (const [id, val] of Object.entries(cached)) {
        updateElement(id, val);
      }
    }
  } catch (_) {}

  const cacheAndSet = (id, val) => {
    updateElement(id, val);
    try {
      const raw = localStorage.getItem("shreeji_cached_metrics");
      const cached = raw ? JSON.parse(raw) : {};
      cached[id] = val;
      localStorage.setItem("shreeji_cached_metrics", JSON.stringify(cached));
    } catch (_) {}
  };

  console.log("Initializing live dashboard listeners...");

  // 1. Listen to Earnings (Today & Monthly)
  listenToEarnings((data) => {
    cacheAndSet("metric-earnings-today", formatCurrency(data.todayEarnings));
    cacheAndSet("metric-earnings-monthly", formatCurrency(data.monthlyEarnings));
  }, (err) => console.error("Earnings listener error:", err));

  // 2. Listen to Expenses (Today)
  listenToDashboardExpenses((data) => {
    cacheAndSet("metric-expenses-today", formatCurrency(data.todayExpenses));
  }, (err) => console.error("Expenses listener error:", err));

  // 3. Listen to Visitors (Today)
  listenToVisitors((data) => {
    const stats = calculateVisitorAnalytics(data);
    cacheAndSet("metric-visitors-today", stats.todayCount);
  }, (err) => console.error("Visitors listener error:", err));

  // 4. Listen to Students (Active & Old)
  const studentsQuery = query(collection(db, "students"));
  onSnapshot(studentsQuery, (snapshot) => {
    let activeStudents = 0;
    let oldStudents = 0;
    let occupiedSeats = 0;
    
    snapshot.forEach(doc => {
      const data = doc.data();
      // Unapproved (Pending) applications are NOT students — they live only
      // in the Pending approval queue. Counting them here inflated the
      // active-student and seat metrics for every new applicant.
      if (data.status === "Active" && String(data.approvalStatus || "Approved") === "Approved") activeStudents++;
      if (data.status === "Old") oldStudents++;
      if (data.seatNumber && data.status === "Active" && String(data.approvalStatus || "Approved") === "Approved") occupiedSeats++;
    });

    cacheAndSet("metric-active-students", `${activeStudents} <span style="font-size: 0.9rem; font-weight: normal; color: var(--text-muted); display: block; margin-top: 0.2rem;">${oldStudents} Old Students</span>`);
  }, (err) => console.error("Students listener error:", err));

  // 5. Listen to Seats for REAL occupancy (separate from students)
  const seatsQuery = query(collection(db, "seats"));
  onSnapshot(seatsQuery, (snapshot) => {
    let available = 0, occupied = 0, reserved = 0, maintenance = 0;
    
    snapshot.forEach(doc => {
      const s = doc.data();
      if (s.status === "Available") available++;
      else if (s.status === "Occupied") occupied++;
      else if (s.status === "Reserved") reserved++;
      else if (s.status === "Maintenance") maintenance++;
    });
    
    const total = available + occupied + reserved + maintenance;
    const occupancyPercent = total > 0 ? Math.round((occupied / total) * 100) : 0;
    
    cacheAndSet("metric-occupancy-percent", `${occupancyPercent}%`);
    cacheAndSet("metric-occupancy-fraction", `${occupied} / ${total} seats taken`);
  }, (err) => console.error("Seats listener error:", err));

  // 6. Listen to Pending Payments Panel
  listenToPendingPayments((data) => {
    cacheAndSet("pending-total-today", formatCurrency(data.totalPendingToday));
  }, (err) => console.error("Pending payments listener error:", err));

  // Note: Upcoming Renewals feed is now handled by dashboardReminderUI.js
};