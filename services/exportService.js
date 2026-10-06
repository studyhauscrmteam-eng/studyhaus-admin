/**
 * Export Service
 * Dynamically loads SheetJS and handles exporting data to CSV and Excel.
 * PDF logic relies on the existing pdfService.js integration (which we will adapt slightly).
 */

const loadScript = (src) => {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
};

export const exportToCSV = (filename, rows) => {
  if (!rows || rows.length === 0) {
    window.showToast("No data to export.", "warning");
    return;
  }
  
  // Extract headers
  const headers = Object.keys(rows[0]);
  
  // Build CSV string
  const csvContent = [
    headers.join(","),
    ...rows.map(row => 
      headers.map(header => {
        let val = row[header] === null || row[header] === undefined ? "" : String(row[header]);
        // Escape quotes and wrap in quotes if there's a comma
        if (val.includes(",") || val.includes('"') || val.includes("\n")) {
          val = `"${val.replace(/"/g, '""')}"`;
        }
        return val;
      }).join(",")
    )
  ].join("\n");

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  
  link.setAttribute("href", url);
  link.setAttribute("download", `${filename}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const exportToExcel = async (filename, rows) => {
  if (!rows || rows.length === 0) {
    window.showToast("No data to export.", "warning");
    return;
  }

  try {
    // Load SheetJS from CDN
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
    
    // Generate workbook
    const worksheet = window.XLSX.utils.json_to_sheet(rows);
    const workbook = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(workbook, worksheet, "Report Data");
    
    // Trigger download
    window.XLSX.writeFile(workbook, `${filename}.xlsx`);
  } catch (err) {
    console.error("Failed to export to Excel:", err);
    window.showToast("Failed to load Excel export library. Try CSV instead.", "error");
  }
};

export const exportToPDF = async (filename, title, rows) => {
  if (!rows || rows.length === 0) {
    window.showToast("No data to export.", "warning");
    return;
  }

  try {
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.28/jspdf.plugin.autotable.min.js");

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    // Header
    doc.setFontSize(18);
    doc.text(title, 14, 20);
    
    doc.setFontSize(10);
    doc.text(`Generated On: ${new Date().toLocaleDateString()}`, 14, 28);
    doc.text(`Total Records: ${rows.length}`, 14, 34);

    // Extract table data
    const headers = Object.keys(rows[0]);
    const tableData = rows.map(row => headers.map(header => row[header] || "-"));

    doc.autoTable({
      head: [headers],
      body: tableData,
      startY: 40,
      theme: 'grid',
      styles: { fontSize: 8 },
      headStyles: { fillColor: [79, 70, 229] }
    });

    doc.save(`${filename}.pdf`);
  } catch (err) {
    console.error("Failed to export to PDF:", err);
    window.showToast("Failed to load PDF export library.", "error");
  }
};
