import { collection, query, getDocs, orderBy, where } from "firebase/firestore";
import { db } from "../firebase/firebase.js";

/**
 * Report Data Engine
 * Fetches collections and transforms them into rows and chart data.
 */

// Global cache for heavy reports to avoid re-fetching on small filter tweaks
let cachedData = {};

export const generateReportData = async (reportType, dateRange) => {
  const data = {
    summary: {},
    chartConfig: null,
    rows: []
  };

  const now = new Date();
  let startDate = new Date(0); // All time by default
  
  if (dateRange === "thisMonth") {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (dateRange === "last30") {
    startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);
  }

  const startIso = startDate.toISOString();

  try {
    switch (reportType) {
      case "students": {
        const snap = await getDocs(query(collection(db, "students")));
        let active = 0, inactive = 0, pending = 0, old = 0;
        const planCounts = {};

        snap.forEach(doc => {
          const s = doc.data();
          data.rows.push({
            "Student ID": s.studentId || "-",
            "Name": s.name,
            "Phone": s.phone,
            "Plan": s.planName || "None",
            "Status": s.status,
            "Due Date": s.paymentDueDate || "-"
          });

          if (s.status === "Active") active++;
          else if (s.status === "Inactive") inactive++;
          else if (s.status === "Pending") pending++;
          else if (s.status === "Old") old++;

          if (s.status === "Active" && s.planName) {
            planCounts[s.planName] = (planCounts[s.planName] || 0) + 1;
          }
        });

        data.summary = {
          "Total Students": active + inactive + pending + old,
          "Active": active,
          "Old Students": old
        };

        data.chartConfig = {
          type: 'doughnut',
          data: {
            labels: Object.keys(planCounts),
            datasets: [{
              data: Object.values(planCounts),
              backgroundColor: ['#4f46e5', '#8b5cf6', '#10b981', '#f59e0b', '#0ea5e9']
            }]
          }
        };
        break;
      }

      case "payments": {
        const snap = await getDocs(query(collection(db, "payments"), orderBy("paymentDate", "desc")));
        let totalRevenue = 0;
        const monthlyRevenue = {};

        snap.forEach(doc => {
          const p = doc.data();
          const pDate = new Date(p.paymentDate);
          
          if (pDate >= startDate) {
            data.rows.push({
              "Date": p.paymentDate,
              "Student": p.studentName,
              "Amount": p.amount,
              "Method": p.paymentMethod || p.method || "Cash",
              "Status": p.status
            });

            if (p.status === "approved" || p.status === "Completed") {
              totalRevenue += Number(p.amount);
              const month = pDate.toLocaleString('default', { month: 'short' });
              monthlyRevenue[month] = (monthlyRevenue[month] || 0) + Number(p.amount);
            }
          }
        });

        data.summary = {
          "Total Revenue (Filtered)": `₹${totalRevenue}`
        };

        data.chartConfig = {
          type: 'bar',
          data: {
            labels: Object.keys(monthlyRevenue).reverse(),
            datasets: [{
              label: 'Revenue',
              data: Object.values(monthlyRevenue).reverse(),
              backgroundColor: '#10b981'
            }]
          }
        };
        break;
      }

      case "expenses": {
        const snap = await getDocs(query(collection(db, "expenses"), orderBy("date", "desc")));
        let totalExpense = 0;
        const categoryTotals = {};

        snap.forEach(doc => {
          const e = doc.data();
          if (new Date(e.date) >= startDate) {
            data.rows.push({
              "Date": e.date,
              "Category": e.category,
              "Description": e.description,
              "Amount": e.amount,
              "Added By": e.addedBy
            });
            totalExpense += Number(e.amount);
            categoryTotals[e.category] = (categoryTotals[e.category] || 0) + Number(e.amount);
          }
        });

        data.summary = { "Total Expense (Filtered)": `₹${totalExpense}` };

        data.chartConfig = {
          type: 'doughnut',
          data: {
            labels: Object.keys(categoryTotals),
            datasets: [{
              data: Object.values(categoryTotals),
              backgroundColor: ['#ef4444', '#f97316', '#f59e0b', '#eab308']
            }]
          }
        };
        break;
      }

      case "attendance": {
        const snap = await getDocs(query(collection(db, "attendance"), orderBy("date", "desc")));
        let totalHours = 0;
        let totalCheckins = 0;

        snap.forEach(doc => {
          const a = doc.data();
          if (new Date(a.date) >= startDate) {
            data.rows.push({
              "Date": a.date,
              "Student": a.studentName,
              "Check In": new Date(a.checkIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              "Duration (hrs)": a.duration || 0,
              "Status": a.status
            });
            totalCheckins++;
            totalHours += (a.duration || 0);
          }
        });

        data.summary = { "Total Check-ins": totalCheckins, "Total Hours": Math.round(totalHours) };
        data.chartConfig = null; // Maybe line chart later if needed
        break;
      }

      case "complaints": {
        const snap = await getDocs(query(collection(db, "complaints"), orderBy("date", "desc")));
        let resolved = 0, total = 0;
        const categoryCounts = {};

        snap.forEach(doc => {
          const c = doc.data();
          if (new Date(c.date) >= startDate) {
            data.rows.push({
              "Date": new Date(c.date).toLocaleDateString(),
              "Student": c.studentName,
              "Category": c.category,
              "Status": c.status
            });
            total++;
            if (c.status === "Resolved" || c.status === "Closed") resolved++;
            categoryCounts[c.category] = (categoryCounts[c.category] || 0) + 1;
          }
        });

        data.summary = { "Total Complaints": total, "Resolved": resolved };
        data.chartConfig = {
          type: 'bar',
          data: {
            labels: Object.keys(categoryCounts),
            datasets: [{ label: 'Complaints', data: Object.values(categoryCounts), backgroundColor: '#f97316' }]
          }
        };
        break;
      }

      case "dashboard": {
        // Master P&L Dashboard
        const pSnap = await getDocs(collection(db, "payments"));
        const eSnap = await getDocs(collection(db, "expenses"));
        
        let revenue = 0, expense = 0;
        pSnap.forEach(doc => {
          const p = doc.data();
          if ((p.status === "approved" || p.status === "Completed") && new Date(p.paymentDate) >= startDate) revenue += Number(p.amount);
        });
        eSnap.forEach(doc => {
          const e = doc.data();
          if (new Date(e.date) >= startDate) expense += Number(e.amount);
        });

        data.summary = {
          "Total Revenue": `₹${revenue}`,
          "Total Expense": `₹${expense}`,
          "Net Profit": `₹${revenue - expense}`
        };

        data.chartConfig = {
          type: 'bar',
          data: {
            labels: ['Revenue', 'Expense', 'Profit'],
            datasets: [{
              label: 'P&L',
              data: [revenue, expense, revenue - expense],
              backgroundColor: ['#10b981', '#ef4444', '#3b82f6']
            }]
          }
        };
        // No rows for dashboard summary
        data.rows = [{ Metric: "Revenue", Value: revenue }, { Metric: "Expense", Value: expense }, { Metric: "Profit", Value: revenue - expense }];
        break;
      }

      // Default fallback for Visitors, Memberships, Renewals, Seats
      default: {
        const snap = await getDocs(collection(db, reportType));
        snap.forEach(doc => {
          data.rows.push({ id: doc.id, ...doc.data() });
        });
        data.summary = { "Total Records": data.rows.length };
      }
    }
    return data;
  } catch (error) {
    console.error("Report Engine Error:", error);
    throw error;
  }
};
