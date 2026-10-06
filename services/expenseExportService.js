/**
 * Exports data to a CSV file.
 * We use this for both CSV and Excel compatibility.
 */
export const exportToCSV = (data, filename = "expenses_export.csv") => {
  if (!data || data.length === 0) {
    window.showToast("No data to export.", "warning");
    return;
  }

  // Define Headers
  const headers = ["Expense Name", "Category", "Amount", "Date", "Vendor", "Payment Method", "Created By"];
  
  // Convert Data to CSV Rows
  const csvRows = [];
  csvRows.push(headers.join(","));

  for (const row of data) {
    const values = [
      `"${(row.expenseName || "").replace(/"/g, '""')}"`,
      `"${(row.categoryName || "").replace(/"/g, '""')}"`,
      row.amount,
      `"${row.expenseDate || ""}"`,
      `"${(row.vendor || "").replace(/"/g, '""')}"`,
      `"${row.paymentMethod || ""}"`,
      `"${(row.createdBy || "").replace(/"/g, '""')}"`
    ];
    csvRows.push(values.join(","));
  }

  // Create Blob and Trigger Download
  const csvString = csvRows.join("\n");
  const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

/**
 * Generates a PDF via the browser's native print-to-pdf functionality.
 */
export const exportToPDF = (data, filename = "Expenses_Report") => {
  if (!data || data.length === 0) {
    window.showToast("No data to export.", "warning");
    return;
  }

  // Construct HTML Table
  let tableHtml = `
    <table style="width: 100%; border-collapse: collapse; font-family: sans-serif; font-size: 14px;">
      <thead>
        <tr style="background: #f3f4f6; text-align: left;">
          <th style="padding: 10px; border-bottom: 2px solid #ddd;">Date</th>
          <th style="padding: 10px; border-bottom: 2px solid #ddd;">Name</th>
          <th style="padding: 10px; border-bottom: 2px solid #ddd;">Category</th>
          <th style="padding: 10px; border-bottom: 2px solid #ddd;">Vendor</th>
          <th style="padding: 10px; border-bottom: 2px solid #ddd;">Method</th>
          <th style="padding: 10px; border-bottom: 2px solid #ddd;">Amount</th>
        </tr>
      </thead>
      <tbody>
  `;

  let total = 0;
  for (const row of data) {
    total += Number(row.amount);
    tableHtml += `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #ddd;">${row.expenseDate}</td>
        <td style="padding: 8px; border-bottom: 1px solid #ddd;">${row.expenseName}</td>
        <td style="padding: 8px; border-bottom: 1px solid #ddd;">${row.categoryName}</td>
        <td style="padding: 8px; border-bottom: 1px solid #ddd;">${row.vendor || "-"}</td>
        <td style="padding: 8px; border-bottom: 1px solid #ddd;">${row.paymentMethod}</td>
        <td style="padding: 8px; border-bottom: 1px solid #ddd;">₹${row.amount}</td>
      </tr>
    `;
  }

  tableHtml += `
      </tbody>
      <tfoot>
        <tr>
          <td colspan="5" style="padding: 10px; text-align: right; font-weight: bold;">Total:</td>
          <td style="padding: 10px; font-weight: bold;">₹${total}</td>
        </tr>
      </tfoot>
    </table>
  `;

  // Create Print Window
  const printWindow = window.open('', '_blank');
  printWindow.document.write(`
    <html>
      <head>
        <title>${filename}</title>
        <style>
          body { padding: 20px; }
          h2 { font-family: sans-serif; color: #333; margin-bottom: 5px; }
          p { font-family: sans-serif; color: #666; margin-top: 0; margin-bottom: 20px; }
          @media print {
            @page { margin: 10mm; }
          }
        </style>
      </head>
      <body>
        <h2>Expense Report</h2>
        <p>Generated on ${new Date().toLocaleDateString()}</p>
        ${tableHtml}
      </body>
    </html>
  `);
  
  printWindow.document.close();
  printWindow.focus();
  
  // Wait a tiny bit for resources to load, then print
  setTimeout(() => {
    printWindow.print();
    printWindow.close();
  }, 250);
};
