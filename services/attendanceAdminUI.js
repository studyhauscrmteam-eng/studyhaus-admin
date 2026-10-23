import { listenToAllAttendance, checkIn, checkOut, forceCheckOutStudent } from "./attendanceService.js";
import { collection, query, where, getDocs, updateDoc, doc } from "firebase/firestore";
import { db } from "../firebase/firebase.js";
import { listenToAllStudents } from "./studentService.js";
import { calculateStudyHours } from "./studyHourCalculator.js";

const escAttr = (s) => String(s == null ? "" : s).replace(/'/g, "\\'");

let allRecords = [];
let allStudents = [];
let unsubscribe = null;
let unsubscribeStudents = null;
let currentFilters = { status: "All", search: "" };

export const initAttendanceAdminUI = () => {
  const container = document.getElementById("page-attendance");
  if (!container) return; 

  const role = localStorage.getItem("userRole");
  if (role === "Student") return; 

  container.innerHTML = `
    <div class="page-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 2rem;">
      <div>
        <h1>Attendance</h1>
        <p class="page-subtitle">Live check-ins, QR scans, and attendance trends.</p>
      </div>
      <div style="display: flex; gap: 0.75rem;">
        <button class="btn btn-secondary" onclick="window.handleAttendanceExport('csv')" id="btn-export-att-csv">Export CSV</button>
        <button class="btn btn-secondary" onclick="window.handleAttendanceExport('excel')" id="btn-export-att-excel">Export Excel</button>
        <button class="btn btn-primary" onclick="window.handleAttendanceExport('pdf')" id="btn-export-att-pdf">Export PDF</button>
        <button class="btn btn-primary" id="btn-scan-qr" style="background:var(--primary); color:#fff; border:none; border-radius:999px; padding:8px 16px; font-weight:500; font-size:13px; display:inline-flex; align-items:center; gap:6px; box-shadow:0 2px 4px rgba(15,23,42,0.1);"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h4v4H4z"/><path d="M4 16h4v4H4z"/><path d="M16 4h4v4h-4z"/><path d="M14 14h2v2h-2z"/><path d="M18 18h2v2h-2z"/><path d="M14 18h2v2h-2z"/><path d="M18 14h2v2h-2z"/></svg> Scan QR</button>
      </div>
    </div>
    
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:1rem; margin-bottom:1.5rem;">
      <div class="card" id="card-present-metric" style="padding:1.5rem; background:var(--bg-card); border:1px solid var(--border); border-radius:12px; display:flex; justify-content:space-between; align-items:flex-start; box-shadow:0 4px 6px -1px rgba(0,0,0,0.02); cursor:pointer;" title="Click to filter currently present students">
        <div><div style="font-size:11px; font-weight:700; letter-spacing:0.5px; color:var(--text-secondary); margin-bottom:8px; text-transform:uppercase;">Present Currently</div><div style="font-size:24px; font-weight:700; color:var(--text-primary);" id="att-metric-present">0</div></div>
        <div style="width:32px; height:32px; background:#f0fdf4; color:#166534; border:1px solid #bbf7d0; border-radius:8px; display:flex; align-items:center; justify-content:center;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></div>
      </div>
      <div class="card" style="padding:1.5rem; background:var(--bg-card); border:1px solid var(--border); border-radius:12px; display:flex; justify-content:space-between; align-items:flex-start; box-shadow:0 4px 6px -1px rgba(0,0,0,0.02);">
        <div><div style="font-size:11px; font-weight:700; letter-spacing:0.5px; color:var(--text-secondary); margin-bottom:8px; text-transform:uppercase;">Completed Today</div><div style="font-size:24px; font-weight:700; color:var(--text-primary);" id="att-metric-absent">0</div></div>
        <div style="width:32px; height:32px; background:var(--bg-hover); color:var(--text-secondary); border:1px solid #cbd5e1; border-radius:8px; display:flex; align-items:center; justify-content:center;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/><path d="M9 12h6"/></svg></div>
      </div>
      <div class="card" style="padding:1.5rem; background:var(--bg-card); border:1px solid var(--border); border-radius:12px; box-shadow:0 4px 6px -1px rgba(0,0,0,0.02);">
        <div style="font-size:11px; font-weight:700; letter-spacing:0.5px; color:var(--text-secondary); margin-bottom:8px; text-transform:uppercase;">Total Check-Ins Today</div><div style="font-size:24px; font-weight:700; color:var(--text-primary);" id="att-metric-late">0</div>
      </div>
      <div class="card" style="padding:1.5rem; background:var(--bg-card); border:1px solid var(--border); border-radius:12px; box-shadow:0 4px 6px -1px rgba(0,0,0,0.02);">
        <div style="font-size:11px; font-weight:700; letter-spacing:0.5px; color:var(--text-secondary); margin-bottom:8px; text-transform:uppercase;">Avg Hours (All Time)</div><div style="font-size:24px; font-weight:700; color:var(--text-primary);" id="att-metric-avg">0h</div>
      </div>
    </div>

    <!-- Chart Card -->
    <div class="card" style="padding:1.5rem; background:var(--bg-card); border:1px solid var(--border); border-radius:12px; margin-bottom:1.5rem; box-shadow:0 4px 6px -1px rgba(0,0,0,0.02);">
      <h3 style="font-size:15px; font-weight:600; color:var(--text-primary); margin-bottom:4px;">Attendance trend</h3>
      <p style="font-size:13px; color:var(--text-muted); margin-bottom:2rem;">Last 14 days</p>
      
      <div style="position:relative; height:200px;">
        <!-- Y-Axis Lines -->
        <div style="position:absolute; top:0; left:20px; right:0; height:100%; display:flex; flex-direction:column; justify-content:space-between; border-left:1px solid var(--border);">
          <div style="border-top:1px dashed var(--border); position:relative;"><span style="position:absolute; left:-20px; top:-8px; font-size:11px; color:var(--text-muted);">40</span></div>
          <div style="border-top:1px dashed var(--border); position:relative;"><span style="position:absolute; left:-20px; top:-8px; font-size:11px; color:var(--text-muted);">30</span></div>
          <div style="border-top:1px dashed var(--border); position:relative;"><span style="position:absolute; left:-20px; top:-8px; font-size:11px; color:var(--text-muted);">20</span></div>
          <div style="border-top:1px dashed var(--border); position:relative;"><span style="position:absolute; left:-20px; top:-8px; font-size:11px; color:var(--text-muted);">10</span></div>
          <div style="border-top:1px solid var(--border); position:relative;"><span style="position:absolute; left:-15px; top:-8px; font-size:11px; color:var(--text-muted);">0</span></div>
        </div>
        
        <!-- Bars Container -->
        <div id="chart-bars" style="position:absolute; top:0; left:30px; right:0; height:100%; display:flex; align-items:flex-end; justify-content:space-around; padding-bottom:1px; z-index:10;">
          <!-- JS will inject bars -->
        </div>
      </div>
    </div>

    <!-- Table Card -->
    <div class="card" style="padding:1.5rem; background:var(--bg-card); border:1px solid var(--border); border-radius:12px; box-shadow:0 4px 6px -1px rgba(0,0,0,0.02);">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:1.5rem;">
        <div>
          <h3 style="font-size:15px; font-weight:600; color:var(--text-primary); margin:0;">Today's check-ins</h3>
          <p style="font-size:12px; color:var(--text-muted); margin:2px 0 0;">View daily attendance records and live student check-ins.</p>
        </div>
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <input type="text" id="att-search-input" placeholder="Search student or seat..." class="input-field" style="padding:6px 12px; font-size:12px; width:180px; border-radius:8px; border:1px solid var(--border); background:var(--bg-card); color:var(--text-primary);" />
          <div style="display:flex; gap:4px; background:var(--bg-hover); padding:3px; border-radius:8px; border:1px solid var(--border);">
            <button class="att-filter-tab active" data-filter="All" style="padding:4px 10px; font-size:12px; border:none; border-radius:6px; cursor:pointer; background:var(--bg-card); color:var(--text-primary); font-weight:600;">All</button>
            <button class="att-filter-tab" data-filter="Present" style="padding:4px 10px; font-size:12px; border:none; border-radius:6px; cursor:pointer; background:transparent; color:var(--text-secondary);">Currently Present</button>
            <button class="att-filter-tab" data-filter="Completed" style="padding:4px 10px; font-size:12px; border:none; border-radius:6px; cursor:pointer; background:transparent; color:var(--text-secondary);">Completed</button>
            <button class="att-filter-tab" data-filter="Absent" style="padding:4px 10px; font-size:12px; border:none; border-radius:6px; cursor:pointer; background:transparent; color:var(--text-secondary);">Absent</button>
          </div>
        </div>
      </div>
      
      <div style="overflow-x:auto;">
        <table style="width:100%; border-collapse:collapse; text-align:left; font-size:13px; color:var(--text-primary);">
          <thead>
            <tr style="color:var(--text-muted); font-size:11px; font-weight:700; letter-spacing:0.5px; text-transform:uppercase; border-bottom:1px solid var(--border);">
              <th style="padding:12px 16px; font-weight:700;">Student</th>
              <th style="padding:12px 16px; font-weight:700;">Seat</th>
              <th style="padding:12px 16px; font-weight:700;">Check-In</th>
              <th style="padding:12px 16px; font-weight:700;">Check-Out</th>
              <th style="padding:12px 16px; font-weight:700;">Hours</th>
              <th style="padding:12px 16px; font-weight:700; text-align:right;">Status</th>
            </tr>
          </thead>
          <tbody id="attendance-table-body">
            <tr><td colspan="6" style="text-align:center; padding: 2rem;">Loading...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  if (!document.getElementById("qr-scan-modal")) {
    const modalDiv = document.createElement("div");
    modalDiv.innerHTML = `
      <dialog id="qr-scan-modal" class="card" style="border:none; border-radius:12px; padding:0; box-shadow:0 10px 30px rgba(0,0,0,0.5); background: var(--bg-card, #fff); color: var(--text-primary, #0f172a);">
        <div style="padding: 1.5rem; min-width: 400px; max-width: 500px; max-height: 85vh; overflow-y: auto;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
            <h2 style="margin: 0;">Scan QR Code (Check-in)</h2>
            <button class="btn btn-ghost" onclick="document.getElementById('qr-scan-modal').close()" style="padding: 0.25rem 0.5rem; background: transparent; border: none; font-size: 18px; cursor: pointer;">✕</button>
          </div>
          
          <div style="text-align:center; margin-bottom: 1.5rem;">
            <div style="width: 150px; height: 150px; border: 2px dashed var(--border, #e2e8f0); border-radius: 12px; margin: 0 auto; display: flex; align-items: center; justify-content: center; flex-direction: column; color: var(--text-muted, #94a3b8); background:var(--bg-hover);">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom: 0.5rem;"><path d="M4 4h4v4H4z"/><path d="M4 16h4v4H4z"/><path d="M16 4h4v4h-4z"/><path d="M14 14h2v2h-2z"/><path d="M18 18h2v2h-2z"/><path d="M14 18h2v2h-2z"/><path d="M18 14h2v2h-2z"/></svg>
              <span>Scanner Active...</span>
            </div>
            <p style="font-size: 13px; color: var(--text-secondary, #475569); margin-top: 1rem;">Or enter student details manually below</p>
          </div>

          <form id="qr-scan-form" onsubmit="event.preventDefault(); window.submitQRScan()">
            <div class="form-group" style="margin-bottom: 1rem;">
              <label style="display:block; margin-bottom:0.25rem; font-size:0.875rem; font-weight:600; color:var(--text-secondary);">Student Email, Phone, or ID</label>
              <input type="text" id="qr-scan-identifier" required placeholder="e.g. johndoe@email.com or 9876543210" class="input-field" style="width: 100%; box-sizing: border-box; padding: 0.5rem; border:1px solid var(--border, #e2e8f0); border-radius:6px;" />
            </div>
            <div class="form-group" style="margin-bottom: 1.5rem;">
              <label style="display:block; margin-bottom:0.25rem; font-size:0.875rem; font-weight:600; color:var(--text-secondary);">Seat Number (Optional)</label>
              <input type="text" id="qr-scan-seat" placeholder="Leave blank if fixed seat..." class="input-field" style="width: 100%; box-sizing: border-box; padding: 0.5rem; border:1px solid var(--border, #e2e8f0); border-radius:6px;" />
            </div>
            <div style="display: flex; justify-content: flex-end; gap: 0.75rem;">
              <button type="button" class="btn btn-ghost" onclick="document.getElementById('qr-scan-modal').close()" style="padding:8px 16px; border:1px solid var(--border, #e2e8f0); border-radius:999px; background:transparent;">Cancel</button>
              <button type="submit" class="btn btn-primary" id="btn-submit-scan" style="padding:8px 16px; border:none; border-radius:999px; background:var(--primary); color:#fff;">Process Check-In</button>
            </div>
          </form>
        </div>
      </dialog>
    `;
    document.body.appendChild(modalDiv.firstElementChild);
  }

  const btnScan = document.getElementById("btn-scan-qr");
  if (btnScan) {
    btnScan.addEventListener("click", () => {
      document.getElementById("qr-scan-identifier").value = "";
      document.getElementById("qr-scan-seat").value = "";
      document.getElementById("qr-scan-modal").showModal();
    });
  }

  window.submitQRScan = async () => {
    const identifier = document.getElementById("qr-scan-identifier").value.trim();
    const seatNumber = document.getElementById("qr-scan-seat").value.trim() || null;

    if (!identifier) {
      window.showToast("Please enter a student identifier.", "warning");
      return;
    }

    const btn = document.getElementById("btn-submit-scan");
    const originalText = btn.innerText;
    btn.innerText = "Processing...";
    btn.disabled = true;

    try {
      const q1 = query(collection(db, "students"), where("email", "==", identifier));
      const q2 = query(collection(db, "students"), where("phone", "==", identifier));
      const q3 = query(collection(db, "students"), where("studentId", "==", identifier));
      
      let studentSnap = await getDocs(q1);
      if (studentSnap.empty) studentSnap = await getDocs(q2);
      if (studentSnap.empty) studentSnap = await getDocs(q3);

      if (studentSnap.empty) {
        window.showToast("Student not found.", "error");
        return;
      }

      const studentDoc = studentSnap.docs[0];
      const studentData = { id: studentDoc.id, ...studentDoc.data() };

      let finalSeatNumber = seatNumber;
      if (!finalSeatNumber) {
        document.getElementById("qr-scan-modal").close();
        const currentFloorHint = studentData.seatFloor || "Ground Floor";
        finalSeatNumber = await window.showCustomPrompt(
          "Seat Required",
          `Enter seat number for ${studentData.name} (Assigned: ${studentData.seatNumber ? `Seat ${studentData.seatNumber} on ${currentFloorHint}` : 'None'}):`,
          "Check-In",
          false,
          studentData.seatNumber || ""
        );
        if (!finalSeatNumber) return;
      }

      const res = await checkIn(studentData, finalSeatNumber ? String(finalSeatNumber).trim() : null);
      if (res.success) {
        if(typeof showToast === 'function') showToast("Student checked in successfully!");
        else window.showToast("Student checked in successfully!", "success");
      } else {
        window.showToast("Failed to check in: " + res.error, "error");
      }
    } catch (err) {
      window.showToast("Error finding student: " + err.message, "error");
    } finally {
      btn.innerText = originalText;
      btn.disabled = false;
    }
  };

  if (unsubscribe) unsubscribe();
  unsubscribe = listenToAllAttendance((records) => {
    allRecords = records;
    renderMetrics();
    renderChart();
    renderTable();
  });

  if (unsubscribeStudents) unsubscribeStudents();
  unsubscribeStudents = listenToAllStudents((students) => {
    allStudents = students;
    renderTable();
  });

  // Attach search and filter tab listeners
  const searchInput = document.getElementById("att-search-input");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      currentFilters.search = e.target.value.trim();
      renderTable();
    });
  }

  document.querySelectorAll(".att-filter-tab").forEach(tab => {
    tab.addEventListener("click", (e) => {
      document.querySelectorAll(".att-filter-tab").forEach(t => {
        t.style.background = "transparent";
        t.style.color = "var(--text-secondary)";
        t.style.fontWeight = "normal";
      });
      const t = e.currentTarget;
      t.style.background = "var(--bg-card)";
      t.style.color = "var(--text-primary)";
      t.style.fontWeight = "600";
      currentFilters.status = t.getAttribute("data-filter") || "All";
      renderTable();
    });
  });

  const presentMetricCard = document.getElementById("card-present-metric");
  if (presentMetricCard) {
    presentMetricCard.onclick = () => {
      const tab = document.querySelector('.att-filter-tab[data-filter="Present"]');
      if (tab) tab.click();
    };
  }
};

const renderMetrics = () => {
  const getTodayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };
  const todayStr = getTodayStr();

  const todaysRecords = allRecords.filter(r => r.date === todayStr);
  const present = todaysRecords.filter(r => r.status === "Active").length;
  const completed = todaysRecords.filter(r => r.status === "Completed").length;
  const totalToday = todaysRecords.length;

  let totalHours = 0;
  let completedCount = 0;
  allRecords.forEach(r => {
    if(r.duration && r.duration > 0) {
       totalHours += r.duration;
       completedCount++;
    }
  });
  const avg = completedCount > 0 ? (totalHours / completedCount).toFixed(1) : "0.0";

  document.getElementById("att-metric-present").innerText = present;
  document.getElementById("att-metric-absent").innerText = completed;
  document.getElementById("att-metric-late").innerText = totalToday;
  document.getElementById("att-metric-avg").innerText = avg + "h";
};

const renderChart = () => {
  const barsContainer = document.getElementById("chart-bars");
  if (!barsContainer) return;

  const last14Days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const label = d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
    last14Days.push({ dateStr, label, dayIndex: i + 1 });
  }

  const data = last14Days.map(dInfo => {
    const recordsForDay = allRecords.filter(r => r.date === dInfo.dateStr);
    const totalCheckIns = recordsForDay.length; 
    const completed = recordsForDay.filter(r => r.status === "Completed").length;
    return { ...dInfo, total: totalCheckIns, completed: completed };
  });

  const chartMax = 40; // Static axis max based on HTML

  let html = "";
  data.forEach((d, i) => {
    let hTotal = (d.total / chartMax) * 100;
    if (hTotal > 100) hTotal = 100;
    
    let hCompleted = (d.completed / chartMax) * 100;
    if (hCompleted > 100) hCompleted = 100;

    const tooltip = `<div class="chart-tooltip" style="display:none; position:absolute; bottom:100%; left:50%; transform:translateX(-50%); background:var(--bg-card); border:1px solid var(--border); box-shadow:0 4px 6px rgba(0,0,0,0.1); padding:8px 12px; border-radius:8px; font-size:12px; font-weight:600; white-space:nowrap; margin-bottom:8px; z-index:20;">
      ${d.label}
      <div style="color:#1e3a8a; margin-top:4px;">Check-Ins: ${d.total}</div>
      <div style="color:#e11d48; margin-top:2px;">Completed: ${d.completed}</div>
    </div>`;
    
    html += `
      <div style="flex:1; height:100%; display:flex; flex-direction:column; justify-content:flex-end; align-items:center; position:relative; border-radius:4px 4px 0 0; padding: 0 4px; cursor:pointer;" 
           onmouseover="this.style.background='rgba(0,0,0,0.05)'; this.querySelector('.chart-tooltip').style.display='block';" 
           onmouseout="this.style.background='transparent'; this.querySelector('.chart-tooltip').style.display='none';">
        ${tooltip}
        <div style="display:flex; align-items:flex-end; gap:2px; width:100%; height:100%; justify-content:center;">
          <div style="background:#1e3a8a; width:14px; border-radius:3px 3px 0 0; height:${hTotal}%; transition: height 0.3s;"></div>
          <div style="background:#e11d48; width:14px; border-radius:3px 3px 0 0; height:${hCompleted}%; transition: height 0.3s;"></div>
        </div>
        <div style="font-size:10px; color:var(--text-muted); font-weight:600; margin-top:6px; position:absolute; top:100%; white-space:nowrap;">D${i+1}</div>
      </div>
    `;
  });
  barsContainer.innerHTML = html;
};

const renderTable = () => {
  const tbody = document.getElementById("attendance-table-body");
  if (!tbody) return;

  const getTodayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };
  const todayStr = getTodayStr();

  const todaysRecords = allRecords.filter(r => r.date === todayStr);
  const activeStudents = allStudents.filter(s => s.status === 'Active');

  if (activeStudents.length === 0 && todaysRecords.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 2rem; color:var(--text-secondary);">No active students or records found.</td></tr>`;
    return;
  }

  // Unified list of students to render (including any checked in not marked active)
  const studentMap = new Map();
  activeStudents.forEach(s => studentMap.set(s.id, s));
  todaysRecords.forEach(r => {
    if (r.studentId && !studentMap.has(r.studentId)) {
      studentMap.set(r.studentId, {
        id: r.studentId,
        name: r.studentName || "Student",
        studentId: r.studentAdmissionId || r.studentId,
        seatNumber: r.seatNumber || "",
        seatFloor: r.seatFloor || "Ground Floor",
        status: "Active"
      });
    }
  });

  let displayList = Array.from(studentMap.values()).map(student => {
    const record = todaysRecords.find(r => r.studentId === student.id);
    const isOnLeave = Array.isArray(student.leaveDates) && student.leaveDates.includes(todayStr);
    let derivedStatus = "Absent";
    if (record && record.status === "Active") derivedStatus = "Present";
    else if (record && record.status === "Completed") derivedStatus = "Completed";
    else if (isOnLeave) derivedStatus = "On Leave";

    return { student, record, isOnLeave, derivedStatus };
  });

  // Apply status filter
  if (currentFilters.status && currentFilters.status !== "All") {
    if (currentFilters.status === "Present") {
      displayList = displayList.filter(item => item.derivedStatus === "Present");
    } else if (currentFilters.status === "Completed") {
      displayList = displayList.filter(item => item.derivedStatus === "Completed");
    } else if (currentFilters.status === "Absent") {
      displayList = displayList.filter(item => item.derivedStatus === "Absent" || item.derivedStatus === "On Leave");
    }
  }

  // Apply search query
  if (currentFilters.search) {
    const q = currentFilters.search.toLowerCase();
    displayList = displayList.filter(item => {
      const name = (item.student.name || "").toLowerCase();
      const sId = (item.student.studentId || item.student.id || "").toLowerCase();
      const seat = (item.record?.seatNumber || item.student.seatNumber || "").toLowerCase();
      const phone = (item.student.phone || "").toLowerCase();
      return name.includes(q) || sId.includes(q) || seat.includes(q) || phone.includes(q);
    });
  }

  // Sort: Present first, then Completed, then Absent/Leave
  const statusPriority = { "Present": 0, "Completed": 1, "On Leave": 2, "Absent": 3 };
  displayList.sort((a, b) => {
    const priA = statusPriority[a.derivedStatus] ?? 4;
    const priB = statusPriority[b.derivedStatus] ?? 4;
    if (priA !== priB) return priA - priB;
    return (a.student.name || "").localeCompare(b.student.name || "");
  });

  if (displayList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 2rem; color:var(--text-secondary);">No students match the current filter or search.</td></tr>`;
    return;
  }

  let html = "";
  displayList.forEach(({ student, record, isOnLeave, derivedStatus }) => {
    let badgeHtml = "";
    if (derivedStatus === "Present" && record) {
      badgeHtml = `<span style="background:rgba(34,197,94,0.14); color:var(--success); border:1px solid rgba(34,197,94,0.45); padding:4px 12px; border-radius:999px; font-size:12px; font-weight:600; display:inline-flex; align-items:center; gap:5px;"><span style="width:6px; height:6px; border-radius:50%; background:var(--success); display:inline-block;"></span>Present</span>`;
    } else if (derivedStatus === "Completed") {
      badgeHtml = `<span style="background:var(--bg-hover); color:var(--text-secondary); border:1px solid var(--border); padding:4px 12px; border-radius:999px; font-size:12px; font-weight:600; display:inline-block; text-align:center; min-width:80px;">Completed</span>`;
    } else if (isOnLeave) {
      badgeHtml = `<button onclick="window.toggleLeave('${student.id}', '${todayStr}', false)" title="Remove Leave" style="background:rgba(245,158,11,0.14); color:var(--warning); border:1px solid rgba(245,158,11,0.45); padding:4px 12px; border-radius:999px; font-size:12px; font-weight:600; display:inline-block; text-align:center; min-width:80px; cursor:pointer; transition:all 0.2s; outline:none; font-family:inherit;" onmouseover="this.style.background='rgba(245,158,11,0.28)'" onmouseout="this.style.background='rgba(245,158,11,0.14)'">On Leave</button>`;
    } else {
      badgeHtml = `<span style="background:rgba(239,68,68,0.14); color:var(--danger); border:1px solid rgba(239,68,68,0.45); padding:4px 12px; border-radius:999px; font-size:12px; font-weight:600; display:inline-block; text-align:center; min-width:80px; margin-bottom: 4px;">Absent</span>
                   <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:2px;">
                     <div style="font-size:10px; color:var(--success); cursor:pointer; text-decoration:underline;" onclick="window.markPresent('${student.id}', event)">Mark Present</div>
                     <div style="font-size:10px; color:var(--text-secondary); cursor:pointer; text-decoration:underline;" onclick="window.toggleLeave('${student.id}', '${todayStr}', true, event)">Mark Leave</div>
                   </div>`;
    }

    const nameStr = student.name || "Unknown";
    const initials = nameStr.split(" ").map(n => n[0] || "").join("").substring(0, 2).toUpperCase();
    const shortId = (student.studentId || "").substring(0, 8);
    const assignedSeat = student.seatNumber ? `${student.seatNumber} (${student.seatFloor || 'Ground Floor'})` : "-";
    
    const inTime = (record && record.checkIn) ? new Date(record.checkIn).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : "-";
    const outTime = (record && record.checkOut) ? new Date(record.checkOut).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : "-";
    const hrs = (record && record.duration) ? record.duration + "h" : "-";

    const displaySeat = (record && record.seatNumber)
      ? `${record.seatNumber} (${record.seatFloor || student.seatFloor || 'Ground Floor'})`
      : assignedSeat;

    html += `
      <tr style="border-bottom:1px solid var(--border); transition:0.2s;" onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background='transparent'">
        <td style="padding:16px; display:flex; align-items:center; gap:12px;">
          <div style="width:36px; height:36px; border-radius:50%; background:var(--bg-hover); color:var(--text-secondary); display:flex; align-items:center; justify-content:center; font-weight:600; font-size:13px; border:1px solid var(--border);">${initials}</div>
          <div>
            <div style="font-weight:600; color:var(--text-primary); margin-bottom:2px;">${nameStr}</div>
            <div style="font-size:11px; color:var(--text-muted); font-family:monospace;">${shortId}...</div>
          </div>
        </td>
        <td style="padding:16px; font-weight:600; color:var(--text-primary);">${displaySeat}</td>
        <td style="padding:16px; color:var(--text-secondary);">${inTime}</td>
        <td style="padding:16px; color:var(--text-secondary);">${outTime}</td>
        <td style="padding:16px; font-weight:500; color:var(--text-secondary);">${hrs}</td>
        <td style="padding:16px; text-align:right;">
          <div style="display:flex; flex-direction:column; align-items:flex-end;">
            ${badgeHtml}
          </div>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;

  window.handleForceCheckOut = async (attId, inTime, studentId, studentName, seatNumber, event) => {
    if (event) event.stopPropagation();
    const nameDisplay = studentName ? ` for <b>${studentName}</b>` : "";
    const seatDisplay = seatNumber ? ` (Seat ${seatNumber})` : "";
    const confirmed = await window.showCustomConfirm(
      "Force Check-Out",
      `Are you sure you want to force check out${nameDisplay}${seatDisplay} now?<br><br>This will record their check-out time and immediately free up the seat.`
    );
    if (!confirmed) return;

    const res = await forceCheckOutStudent({
      attendanceId: attId,
      studentId: studentId,
      seatNumber: seatNumber,
      checkInTimestamp: inTime
    });
    if (res.success) {
      if (typeof window.showToast === "function") {
        window.showToast(res.message || `Checked out ${studentName || 'student'} successfully.`);
      }
    } else {
      if (typeof window.showToast === "function") {
        window.showToast(res.error || "Failed to force check out.", "error");
      }
    }
  };

  window.toggleLeave = async (studentId, dateStr, isAddingLeave, event) => {
    if (event) event.stopPropagation();
    const studentRef = doc(db, "students", studentId);
    const student = allStudents.find(s => s.id === studentId);
    if (!student) return;
    
    let currentLeaves = student.leaveDates || [];
    if (isAddingLeave) {
      if (!currentLeaves.includes(dateStr)) currentLeaves.push(dateStr);
    } else {
      currentLeaves = currentLeaves.filter(d => d !== dateStr);
    }
    
    try {
      await updateDoc(studentRef, { leaveDates: currentLeaves });
      if(typeof showToast === 'function') showToast(isAddingLeave ? "Marked as On Leave" : "Removed Leave");
    } catch (err) {
      window.showToast("Error updating leave: " + err.message, "error");
    }
  };

  window.markPresent = async (studentId, event) => {
    if (event) event.stopPropagation();
    const student = allStudents.find(s => s.id === studentId);
    if (!student) return;
    
    try {
      const defaultSeat = student.seatNumber || "";
      const currentFloorHint = student.seatFloor || "Ground Floor";
      let seatNumber = await window.showCustomPrompt(
        "Seat Required",
        `Enter seat number for ${student.name} (Assigned: ${student.seatNumber ? `Seat ${student.seatNumber} on ${currentFloorHint}` : 'None'}):`,
        "Check-In",
        false,
        defaultSeat
      );
      if (!seatNumber) return;

      const res = await checkIn(student, String(seatNumber).trim());
      if (res.success) {
        if(typeof showToast === 'function') showToast("Marked as Present!");
      } else {
        window.showToast("Failed to mark present: " + res.error, "error");
      }
    } catch (err) {
      window.showToast("Error marking present: " + err.message, "error");
    }
  };

  // Export functions
  window.handleAttendanceExport = async (format) => {
    try {
      const { exportToCSV, exportToExcel, exportToPDF } = await import("./exportService.js");
      
      const rows = allStudents.map(student => {
        const hasAttended = allRecords.some(a => a.studentId === student.id);
        const isOnLeave = Array.isArray(student.leaveDates) && student.leaveDates.includes(new Date().toISOString().split('T')[0]);
        let statusText = "Absent";
        if (hasAttended) statusText = "Present";
        else if (isOnLeave) statusText = "On Leave";

        return {
          "Student ID": student.studentId || student.id,
          "Name": student.name || "Unknown",
          "Phone": student.phone || "N/A",
          "Status": statusText
        };
      });

      const filename = `attendance_export_${new Date().toISOString().split('T')[0]}`;
      if (format === 'csv') exportToCSV(filename, rows);
      else if (format === 'excel') await exportToExcel(filename, rows);
      else if (format === 'pdf') await exportToPDF(filename, 'Attendance Report', rows);
    } catch (err) {
      console.error("Export Error:", err);
      if (typeof showToast === 'function') showToast("Export failed: " + err.message, "error");
    }
  };
};
