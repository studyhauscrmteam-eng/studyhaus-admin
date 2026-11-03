/**
 * Export Service
 * Dynamically loads SheetJS and handles exporting data to CSV and Excel with full UTF-8 Unicode (Gujarati) support.
 * Uses UTF-8 BOM so Microsoft Excel automatically renders Gujarati characters natively without mojibake.
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

/**
 * Formats a single cell value for CSV.
 * Preserves Gujarati UTF-8 text and protects long numbers (phones, UTRs >= 10 digits)
 * from being converted into scientific notation (e.g. 9.19898E+11) by Excel.
 */
const formatCsvCell = (val) => {
  if (val === null || val === undefined) return '""';
  const str = String(val);

  // If numeric string with 10 or more digits (phone number, 12-digit UTR, or leading zero),
  // wrap in ="..." so Excel opens it strictly as plain text without scientific notation.
  if (/^\d{10,}$/.test(str) || /^0\d+$/.test(str)) {
    return `="${str}"`;
  }

  // Standard CSV escaping: escape quotes and wrap in quotes
  return `"${str.replace(/"/g, '""')}"`;
};

export const exportToCSV = (filename, rows) => {
  if (!rows || rows.length === 0) {
    if (typeof window.showToast === 'function') {
      window.showToast("No data to export.", "warning");
    } else {
      alert("No data to export.");
    }
    return;
  }
  
  // Extract headers
  const headers = Object.keys(rows[0]);
  
  // Build CSV string with escaped headers and values
  const csvContent = [
    headers.map(h => `"${String(h).replace(/"/g, '""')}"`).join(","),
    ...rows.map(row => 
      headers.map(header => formatCsvCell(row[header])).join(",")
    )
  ].join("\r\n");

  // CRITICAL: Prepend UTF-8 BOM (\uFEFF) to guarantee Microsoft Excel detects UTF-8
  // and renders Gujarati characters natively with zero mojibake!
  const blob = new Blob(["\uFEFF", csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  
  link.setAttribute("href", url);
  link.setAttribute("download", `${filename}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const exportToExcel = async (filename, rows) => {
  if (!rows || rows.length === 0) {
    if (typeof window.showToast === 'function') {
      window.showToast("No data to export.", "warning");
    } else {
      alert("No data to export.");
    }
    return;
  }

  try {
    // Load SheetJS from CDN
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
    
    // Generate worksheet from JSON
    const worksheet = window.XLSX.utils.json_to_sheet(rows, { raw: false });

    // Auto-calculate optimal column widths based on maximum content length
    const colKeys = Object.keys(rows[0]);
    const colWidths = colKeys.map(key => {
      let maxLen = String(key).length;
      rows.forEach(r => {
        const valStr = String(r[key] == null ? "" : r[key]);
        if (valStr.length > maxLen) maxLen = Math.min(valStr.length, 60);
      });
      return { wch: Math.max(maxLen + 4, 14) };
    });
    worksheet['!cols'] = colWidths;

    const workbook = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(workbook, worksheet, "Data");
    
    // Trigger download
    window.XLSX.writeFile(workbook, `${filename}.xlsx`);
  } catch (err) {
    console.error("Failed to export to Excel:", err);
    if (typeof window.showToast === 'function') {
      window.showToast("Excel export library loading failed. Downloading UTF-8 CSV instead...", "info");
    }
    // Reliable fallback to UTF-8 BOM CSV which Excel opens flawlessly
    exportToCSV(filename, rows);
  }
};

export const exportToPDF = async (filename, title, rows) => {
  if (!rows || rows.length === 0) {
    if (typeof window.showToast === 'function') {
      window.showToast("No data to export.", "warning");
    } else {
      alert("No data to export.");
    }
    return;
  }

  try {
    if (typeof window.showToast === 'function') {
      window.showToast("Generating PDF report...", "info");
    }

    // Load html2canvas and jsPDF for 100% native Gujarati font rendering without mojibake
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js");
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");

    const headers = Object.keys(rows[0]);
    const reportWidth = 794; // Exact A4 width at 96 DPI

    const tempContainer = document.createElement("div");
    tempContainer.style.cssText = `
      position: absolute;
      left: -9999px;
      top: 0;
      width: ${reportWidth}px;
      min-width: ${reportWidth}px;
      max-width: ${reportWidth}px;
      z-index: -9999;
      background: #ffffff;
      color: #1e293b;
      padding: 30px 24px;
      box-sizing: border-box;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans Gujarati', 'Shruti', 'Gujarati Sangam MN', sans-serif;
    `;

    const nowFormatted = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });

    tempContainer.innerHTML = `
      <div style="border-bottom: 2.5px solid #4f46e5; padding-bottom: 12px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: flex-end;">
        <div>
          <div style="font-size: 11px; font-weight: 800; color: #4f46e5; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px;">Shreeji Premium Reading Library</div>
          <h1 style="font-size: 22px; font-weight: 800; color: #0f172a; margin: 0;">${title}</h1>
        </div>
        <div style="text-align: right; font-size: 11px; color: #64748b; font-weight: 500; line-height: 1.5;">
          <div><strong>Date:</strong> ${nowFormatted}</div>
          <div><strong>Total Records:</strong> ${rows.length}</div>
        </div>
      </div>

      <table style="width: 100%; border-collapse: collapse; font-size: 11px; text-align: left;">
        <thead>
          <tr style="background: #4f46e5; color: #ffffff;">
            ${headers.map(h => `<th style="padding: 9px 8px; font-weight: 700; border: 1px solid #4338ca; text-align: left; font-size: 11px;">${h}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${rows.map((row, idx) => `
            <tr style="background: ${idx % 2 === 0 ? '#ffffff' : '#f8fafc'};">
              ${headers.map(h => {
                const val = row[h] != null ? String(row[h]) : '-';
                return `<td style="padding: 7px 8px; border: 1px solid #e2e8f0; color: #1e293b; font-size: 11px; line-height: 1.4; vertical-align: top;">${val}</td>`;
              }).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div style="margin-top: 18px; padding-top: 10px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #94a3b8; display: flex; justify-content: space-between;">
        <span>Official Library Records Report</span>
        <span>Generated from Shreeji Library Management System</span>
      </div>
    `;

    document.body.appendChild(tempContainer);

    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }

    const canvas = await window.html2canvas(tempContainer, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: "#ffffff",
      width: reportWidth,
      logging: false
    });

    tempContainer.remove();

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4"
    });

    const pageWidth = 210;
    const pageHeight = 297;
    const margin = 8;
    const contentWidth = pageWidth - (margin * 2);
    const contentHeight = (canvas.height * contentWidth) / canvas.width;

    if (contentHeight <= (pageHeight - (margin * 2))) {
      const imgData = canvas.toDataURL("image/png");
      doc.addImage(imgData, "PNG", margin, margin, contentWidth, contentHeight, undefined, "FAST");
    } else {
      // Clean multi-page slicing
      const pageCanvasHeight = (canvas.width * (pageHeight - (margin * 2))) / contentWidth;
      let remainingHeight = canvas.height;
      let yOffset = 0;
      let pageIdx = 0;

      while (remainingHeight > 0) {
        const chunkHeight = Math.min(remainingHeight, pageCanvasHeight);
        const chunkCanvas = document.createElement("canvas");
        chunkCanvas.width = canvas.width;
        chunkCanvas.height = chunkHeight;
        const ctx = chunkCanvas.getContext("2d");
        ctx.drawImage(canvas, 0, yOffset, canvas.width, chunkHeight, 0, 0, canvas.width, chunkHeight);

        const chunkImg = chunkCanvas.toDataURL("image/png");
        if (pageIdx > 0) doc.addPage();
        const pdfChunkHeight = (chunkHeight * contentWidth) / canvas.width;
        doc.addImage(chunkImg, "PNG", margin, margin, contentWidth, pdfChunkHeight, undefined, "FAST");

        yOffset += chunkHeight;
        remainingHeight -= chunkHeight;
        pageIdx++;
      }
    }

    doc.save(`${filename}.pdf`);
    if (typeof window.showToast === 'function') {
      window.showToast("PDF report downloaded successfully!", "success");
    }
  } catch (err) {
    console.error("Failed to export to PDF:", err);
    if (typeof window.showToast === 'function') {
      window.showToast("Failed to generate PDF: " + err.message, "error");
    }
  }
};
