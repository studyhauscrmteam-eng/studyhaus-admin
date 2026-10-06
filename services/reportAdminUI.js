import { generateReportData } from "./reportDataEngine.js";
import { renderChart, clearChart } from "./chartService.js";
import { exportToCSV, exportToExcel, exportToPDF } from "./exportService.js";

let currentReportType = "";
let currentReportData = null;

const reportTitles = {
  "dashboard": window.t ? window.t("report.dashboardTitle") : "Dashboard Summary Report",
  "students": window.t ? window.t("report.studentTitle") : "Student Analytics Report",
  "attendance": window.t ? window.t("report.attendanceTitle") : "Attendance Trend Report",
  "payments": window.t ? window.t("report.paymentTitle") : "Revenue & Collections Report",
  "expenses": window.t ? window.t("report.expenseTitle") : "Expense Analysis Report",
  "complaints": window.t ? window.t("report.complaintTitle") : "Complaint Resolution Report",
  "visitors": window.t ? window.t("report.visitorTitle") : "Visitor Analytics Report",
  "renewals": window.t ? window.t("report.renewalTitle") : "Membership Renewal Report",
  "seats": window.t ? window.t("report.seatTitle") : "Seat Occupancy Report"
};

export const openReportViewer = async (type) => {
  const role = localStorage.getItem("userRole");
  if (role === "Employee" && type === "dashboard") {
    return window.showToast("Permission Denied.", "error");
  }

  currentReportType = type;
  
  // Hide main reports page, show viewer
  document.getElementById("page-reports").style.display = "";
  document.getElementById("page-reports").classList.remove("active");
  
  const viewer = document.getElementById("page-report-viewer");
  viewer.style.display = "";
  viewer.classList.add("active");
  
  // Update header
  document.getElementById("rv-title").innerText = reportTitles[type] || "Analytics Report";
  
  // Load data with default "thisMonth"
  await loadReportData("thisMonth");
};

export const closeReportViewer = () => {
  const viewer = document.getElementById("page-report-viewer");
  viewer.style.display = "";
  viewer.classList.remove("active");
  
  const reports = document.getElementById("page-reports");
  reports.style.display = "";
  reports.classList.add("active");
  clearChart();
};

window.handleReportFilterChange = async () => {
  const range = document.getElementById("rv-date-filter").value;
  await loadReportData(range);
};

window.handleReportExport = async (format) => {
  if (!currentReportData || currentReportData.rows.length === 0) {
    return window.showToast("No data to export.", "warning");
  }
  const title = reportTitles[currentReportType] || "Report";
  const filename = `${currentReportType}_report_${new Date().getTime()}`;

  const btn = document.getElementById(`btn-export-${format}`);
  const origText = btn.innerText;
  btn.innerText = "Exporting...";
  btn.disabled = true;

  if (format === 'csv') exportToCSV(filename, currentReportData.rows);
  if (format === 'excel') await exportToExcel(filename, currentReportData.rows);
  if (format === 'pdf') await exportToPDF(filename, title, currentReportData.rows);

  btn.innerText = origText;
  btn.disabled = false;
};

const loadReportData = async (dateRange) => {
  const tableContainer = document.getElementById("rv-table-container");
  const summaryContainer = document.getElementById("rv-summary-container");
  const chartContainer = document.getElementById("rv-chart-container");
  
  tableContainer.innerHTML = `<div style="text-align:center; padding:3rem; color:var(--text-muted);">Generating Report...</div>`;
  summaryContainer.innerHTML = "";
  clearChart();

  try {
    currentReportData = await generateReportData(currentReportType, dateRange);
    
    // Render Summary Metrics
    let summaryHtml = "";
    Object.entries(currentReportData.summary).forEach(([key, val]) => {
      summaryHtml += `
        <div class="metric-card" style="padding: 1rem;">
          <div class="metric-label">${key}</div>
          <div class="metric-value" style="font-size: 1.5rem;">${val}</div>
        </div>
      `;
    });
    summaryContainer.innerHTML = summaryHtml;

    // Render Chart
    if (currentReportData.chartConfig) {
      chartContainer.style.display = "block";
      await renderChart("rv-chart-canvas", currentReportData.chartConfig.type, currentReportData.chartConfig.data);
    } else {
      chartContainer.style.display = "none";
    }

    // Render Table
    if (currentReportData.rows.length === 0) {
      tableContainer.innerHTML = `<div style="text-align:center; padding:3rem; color:var(--text-muted);">No records found for this period.</div>`;
    } else {
      const headers = Object.keys(currentReportData.rows[0]);
      let tableHtml = `<table class="data-table"><thead><tr>`;
      headers.forEach(h => tableHtml += `<th>${h}</th>`);
      tableHtml += `</tr></thead><tbody>`;
      
      currentReportData.rows.forEach(row => {
        tableHtml += `<tr>`;
        headers.forEach(h => {
          tableHtml += `<td>${row[h] !== undefined && row[h] !== null ? row[h] : "-"}</td>`;
        });
        tableHtml += `</tr>`;
      });
      tableHtml += `</tbody></table>`;
      tableContainer.innerHTML = tableHtml;
    }

  } catch (error) {
    tableContainer.innerHTML = `<div style="text-align:center; padding:3rem; color:var(--danger);">Error loading report: ${error.message}</div>`;
  }
};
