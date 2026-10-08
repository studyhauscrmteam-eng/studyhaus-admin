import { listenToExpenseCategories, addExpenseCategory, updateExpenseCategory, toggleExpenseCategory, deleteExpenseCategory } from "./expenseCategoryService.js";
import { listenToExpenses, addExpense, deleteExpense } from "./expenseService.js";
import { exportToCSV, exportToPDF } from "./expenseExportService.js";

let allCategories = [];
let allExpenses = [];
let activeTab = "list"; // "list" or "categories"

let unsubCategories = null;
let unsubExpenses = null;

export const initExpenseAdminUI = () => {
  const container = document.getElementById("page-expenses");
  if (!container) return;

  const role = localStorage.getItem("userRole");
  if (role === "Student") return;

  const isOwner = role === "Owner/Admin";
  const canEdit = (role === "Owner/Admin" || role === "Manager");

  container.innerHTML = `
    <!-- Modal for adding expenses -->
    <div id="add-expense-modal" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:50; align-items:center; justify-content:center;">
      <div class="card" style="background:var(--bg-card); padding:2rem; border-radius:12px; width:100%; max-width:400px; box-shadow:0 10px 15px -3px rgba(0,0,0,0.1);">
        <h3 style="font-size:18px; font-weight:600; color:var(--text-primary); margin-bottom:1.5rem;">Add New Expense</h3>
        <form id="form-add-expense">
          <div style="margin-bottom:1rem;">
            <label style="display:block; font-size:13px; font-weight:500; color:var(--text-secondary); margin-bottom:4px;">Expense Name</label>
            <input type="text" id="exp-name" required placeholder="e.g. Electricity Bill" style="width:100%; padding:8px 12px; border:1px solid var(--border); border-radius:6px; background:var(--bg-card); color:var(--text-primary);">
          </div>
          <div style="margin-bottom:1rem;">
            <label style="display:block; font-size:13px; font-weight:500; color:var(--text-secondary); margin-bottom:4px;">Category</label>
            <select id="exp-category" required style="width:100%; padding:8px 12px; border:1px solid var(--border); border-radius:6px; background:var(--bg-card); color:var(--text-primary);">
              <!-- Will be populated dynamically -->
            </select>
          </div>
          <div style="display:flex; gap:1rem; margin-bottom:1rem;">
            <div style="flex:1;">
              <label style="display:block; font-size:13px; font-weight:500; color:var(--text-secondary); margin-bottom:4px;">Amount (₹)</label>
              <input type="number" id="exp-amount" required min="1" style="width:100%; padding:8px 12px; border:1px solid var(--border); border-radius:6px; background:var(--bg-card); color:var(--text-primary);">
            </div>
            <div style="flex:1;">
              <label style="display:block; font-size:13px; font-weight:500; color:var(--text-secondary); margin-bottom:4px;">Date</label>
              <input type="date" id="exp-date" required style="width:100%; padding:8px 12px; border:1px solid var(--border); border-radius:6px; background:var(--bg-card); color:var(--text-primary);">
            </div>
          </div>
          <div style="display:flex; gap:1rem; margin-bottom:1.5rem;">
            <div style="flex:1;">
              <label style="display:block; font-size:13px; font-weight:500; color:var(--text-secondary); margin-bottom:4px;">Payment Method</label>
              <select id="exp-method" required style="width:100%; padding:8px 12px; border:1px solid var(--border); border-radius:6px; background:var(--bg-card); color:var(--text-primary);">
                <option value="Cash">Cash</option>
                <option value="UPI">UPI</option>
                <option value="Cheque">Cheque</option>
              </select>
            </div>
            <div style="flex:1;">
              <label style="display:block; font-size:13px; font-weight:500; color:var(--text-secondary); margin-bottom:4px;">Status</label>
              <input type="text" id="exp-status" value="Paid" readonly style="width:100%; padding:8px 12px; border:1px solid var(--border); border-radius:6px; background:var(--bg-card); color:var(--text-primary); cursor:default; outline:none;">
            </div>
          </div>
          <div style="margin-bottom:1.5rem;">
            <label style="display:block; font-size:13px; font-weight:500; color:var(--text-secondary); margin-bottom:4px;">Vendor (Optional)</label>
            <input type="text" id="exp-vendor" placeholder="e.g. State Electricity Board" style="width:100%; padding:8px 12px; border:1px solid var(--border); border-radius:6px; background:var(--bg-card); color:var(--text-primary);">
          </div>
          
          <div style="display:flex; justify-content:flex-end; gap:0.75rem;">
            <button type="button" id="btn-cancel-expense" class="btn btn-ghost" style="padding:8px 16px; border:1px solid var(--border); border-radius:999px; background:transparent; color:var(--text-primary);">Cancel</button>
            <button type="submit" class="btn btn-primary" style="padding:8px 16px; border:none; border-radius:999px; background:var(--primary); color:#fff; font-weight:500;">Save Expense</button>
          </div>
        </form>
      </div>
    </div>

    <div class="page-header" style="margin-bottom: 2rem;">
      <div>
        <h1>Expenses</h1>
        <p class="page-subtitle">Track every operational cost.</p>
      </div>
      <div style="display: flex; gap: 0.75rem;">
        <button class="btn btn-ghost" id="btn-export-csv" style="background:var(--bg-card); color:var(--text-primary); border:1px solid var(--border); border-radius:999px; padding:8px 16px; font-weight:500; font-size:13px; display:inline-flex; align-items:center; gap:6px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Export</button>
        ${canEdit ? `<button class="btn btn-primary" id="btn-add-expense" style="background:var(--primary); color:#fff; border:none; border-radius:999px; padding:8px 16px; font-weight:500; font-size:13px; display:inline-flex; align-items:center; gap:6px;">+ Add expense</button>` : ""}
      </div>
    </div>
    
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(210px, 1fr)); gap:1rem; margin-bottom:1.5rem;">
      <div class="card card-theme" style="padding:1.5rem; display:flex; justify-content:space-between; align-items:flex-start;">
        <div><div style="font-size:11px; font-weight:700; letter-spacing:0.5px; color:var(--text-muted); margin-bottom:8px; text-transform:uppercase;">Total This Month</div><div style="font-size:24px; font-weight:700; color:var(--text-primary);" id="exp-total-month">₹0</div></div>
        <div style="width:32px; height:32px; background:#e0f2fe; color:#0284c7; border-radius:8px; display:flex; align-items:center; justify-content:center;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg></div>
      </div>
      <div class="card card-theme" style="padding:1.5rem; display:flex; justify-content:space-between; align-items:flex-start;">
        <div><div style="font-size:11px; font-weight:700; letter-spacing:0.5px; color:var(--text-muted); margin-bottom:8px; text-transform:uppercase;">Pending Bills</div><div style="font-size:24px; font-weight:700; color:var(--text-primary);" id="exp-total-pending">₹0</div></div>
      </div>
      <div class="card card-theme" style="padding:1.5rem; display:flex; justify-content:space-between; align-items:flex-start;">
        <div><div style="font-size:11px; font-weight:700; letter-spacing:0.5px; color:var(--text-muted); margin-bottom:8px; text-transform:uppercase;">Recurring</div><div style="font-size:24px; font-weight:700; color:var(--text-primary);" id="exp-recurring">0</div></div>
      </div>
    </div>
    
    <div style="display:flex; gap:1.5rem; align-items:flex-start;">
      
      <div class="card" style="flex:2; padding:1.5rem; background:var(--bg-card); border:1px solid var(--border); border-radius:12px; box-shadow:0 4px 6px -1px rgba(0,0,0,0.02);">
        <h3 style="font-size:15px; font-weight:600; color:var(--text-primary); margin-bottom:1.5rem;">Expense log</h3>
        
        <div style="overflow-x:auto;">
          <table style="width:100%; border-collapse:collapse; text-align:left; font-size:13px; color:var(--text-secondary);">
            <thead>
              <tr style="color:var(--text-muted); font-size:11px; font-weight:700; letter-spacing:0.5px; text-transform:uppercase; border-bottom:1px solid var(--border);">
                <th style="padding:12px 16px; font-weight:700; color:var(--text-primary);">Category</th>
                <th style="padding:12px 16px; font-weight:700;">Vendor</th>
                <th style="padding:12px 16px; font-weight:700;">Bill #</th>
                <th style="padding:12px 16px; font-weight:700; text-align:right;">Amount</th>
                <th style="padding:12px 16px; font-weight:700;">Date</th>
                <th style="padding:12px 16px; font-weight:700; text-align:right;">Status</th>
              </tr>
            </thead>
            <tbody id="expense-tbody">
              <tr><td colspan="6" style="text-align:center; padding: 2rem;">Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card" style="flex:1; padding:1.5rem; background:var(--bg-card); border:1px solid var(--border); border-radius:12px; box-shadow:0 4px 6px -1px rgba(0,0,0,0.02); display:flex; flex-direction:column;">
        <h3 style="font-size:15px; font-weight:600; color:var(--text-primary); margin-bottom:4px;">By category</h3>
        <p style="font-size:13px; color:var(--text-muted); margin-bottom:2.5rem;">This month</p>
        
        <div style="flex:1; display:flex; align-items:center; justify-content:center; margin-bottom:2.5rem;">
          <!-- Simulated Donut Chart using CSS conic-gradient -->
          <div style="width:160px; height:160px; border-radius:50%; background: conic-gradient(#1e3a8a 0% 60%, #0ea5e9 60% 75%, #06b6d4 75% 80%, #eab308 80% 90%, #f43f5e 90% 92%, #64748b 92% 95%, #84cc16 95% 96%, #8b5cf6 96% 100%); display:flex; align-items:center; justify-content:center; position:relative;">
            <div style="width:100px; height:100px; border-radius:50%; background:var(--bg-card);"></div>
            <!-- White slice borders for gap effect -->
            <div style="position:absolute; inset:0; border-radius:50%; background: conic-gradient(transparent 0% 59.5%, white 59.5% 60.5%, transparent 60.5% 74.5%, white 74.5% 75.5%, transparent 75.5% 79.5%, white 79.5% 80.5%, transparent 80.5% 89.5%, white 89.5% 90.5%, transparent 90.5% 91.5%, white 91.5% 92.5%, transparent 92.5% 94.5%, white 94.5% 95.5%, transparent 95.5% 95.8%, white 95.8% 96.2%, transparent 96.2% 100%); pointer-events:none;"></div>
          </div>
        </div>
        
        <div style="display:flex; flex-wrap:wrap; gap:12px; font-size:11px; font-weight:600; color:var(--text-muted);">
          <div style="display:flex; align-items:center; gap:6px;"><div style="width:8px; height:8px; border-radius:50%; background:var(--primary);"></div>Rent</div>
          <div style="display:flex; align-items:center; gap:6px;"><div style="width:8px; height:8px; border-radius:50%; background:#0ea5e9;"></div>Electricity</div>
          <div style="display:flex; align-items:center; gap:6px;"><div style="width:8px; height:8px; border-radius:50%; background:#06b6d4;"></div>Internet</div>
          <div style="display:flex; align-items:center; gap:6px;"><div style="width:8px; height:8px; border-radius:50%; background:#eab308;"></div>Salary</div>
          <div style="display:flex; align-items:center; gap:6px;"><div style="width:8px; height:8px; border-radius:50%; background:#f43f5e;"></div>Cleaning</div>
          <div style="display:flex; align-items:center; gap:6px;"><div style="width:8px; height:8px; border-radius:50%; background:#64748b;"></div>Repairs</div>
          <div style="display:flex; align-items:center; gap:6px;"><div style="width:8px; height:8px; border-radius:50%; background:#84cc16;"></div>Snacks</div>
          <div style="display:flex; align-items:center; gap:6px;"><div style="width:8px; height:8px; border-radius:50%; background:#8b5cf6;"></div>Marketing</div>
        </div>
      </div>
    </div>
  `;

  // Start Listeners
  if (unsubCategories) unsubCategories();
  unsubCategories = listenToExpenseCategories(cats => {
    allCategories = cats;
    renderExpenses();
  });

  if (unsubExpenses) unsubExpenses();
  unsubExpenses = listenToExpenses(exps => {
    allExpenses = exps;
    renderExpenses();
  });

  if(document.getElementById("btn-export-csv")) {
    document.getElementById("btn-export-csv").addEventListener("click", () => exportToCSV(allExpenses));
  }

  
  const modal = document.getElementById("add-expense-modal");
  
  if(document.getElementById("btn-add-expense")) {
    document.getElementById("btn-add-expense").addEventListener("click", () => {
      // Populate categories dropdown
      const catSelect = document.getElementById("exp-category");
      if (allCategories.length > 0) {
        catSelect.innerHTML = allCategories.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
      } else {
        catSelect.innerHTML = `
          <option value="cat_general">General</option>
          <option value="cat_rent">Rent</option>
          <option value="cat_electricity">Electricity</option>
          <option value="cat_internet">Internet</option>
          <option value="cat_salary">Salary</option>
          <option value="cat_cleaning">Cleaning</option>
          <option value="cat_repairs">Repairs</option>
          <option value="cat_snacks">Snacks</option>
          <option value="cat_marketing">Marketing</option>
        `;
      }
      
      // Set default date
      document.getElementById("exp-date").value = new Date().toISOString().split('T')[0];
      
      // Show modal
      modal.style.display = "flex";
    });
  }
  
  if(document.getElementById("btn-cancel-expense")) {
    document.getElementById("btn-cancel-expense").addEventListener("click", () => {
      modal.style.display = "none";
      document.getElementById("form-add-expense").reset();
    });
  }

  const form = document.getElementById("form-add-expense");
  if(form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const expenseName = document.getElementById("exp-name").value;
      const categoryId = document.getElementById("exp-category").value;
      const categoryName = document.getElementById("exp-category").options[document.getElementById("exp-category").selectedIndex].text;
      const amount = document.getElementById("exp-amount").value;
      const expenseDate = document.getElementById("exp-date").value;
      const paymentMethod = document.getElementById("exp-method").value;
      const status = document.getElementById("exp-status").value;
      const vendor = document.getElementById("exp-vendor").value;

      const expenseData = {
        expenseName,
        categoryId,
        amount,
        paymentMethod,
        vendor: vendor || "",
        description: "",
        expenseDate,
        status
      };
      
      const res = await addExpense(expenseData, categoryName, localStorage.getItem("userName") || "Admin User");
      if (res.success) {
        modal.style.display = "none";
        form.reset();
      } else {
        window.showToast("Failed to add expense: " + res.error, "error");
      }
    });
  }
};

const renderExpenses = () => {
  const tbody = document.getElementById("expense-tbody");
  if (!tbody) return;

  const role = localStorage.getItem("userRole");
  const canEdit = (role === "Owner/Admin" || role === "Manager");

  let totalMonth = 0;
  let totalPending = 0;
  let recurring = 0;

  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();

  allExpenses.forEach(exp => {
    const amt = parseFloat(exp.amount) || 0;
    const expDate = exp.expenseDate || exp.date; // Fallback
    const d = expDate ? new Date(expDate) : new Date();
    const status = exp.status || "Paid"; // Default to Paid if not set

    if (status === "Pending") {
      totalPending += amt;
    }
    
    if (d.getMonth() === month && d.getFullYear() === year) {
      if (status === "Paid") {
        totalMonth += amt;
      }
    }
    
    // In our mock logic, let's just count Rent/Salary as recurring for visual
    const catName = exp.categoryName || exp.category;
    if (catName === "Rent" || catName === "Salary" || catName === "Internet") {
      recurring++;
    }
  });

  const domTotal = document.getElementById("exp-total-month");
  const domPending = document.getElementById("exp-total-pending");
  const domRecur = document.getElementById("exp-recurring");

  if (domTotal) domTotal.innerText = "₹" + totalMonth.toLocaleString();
  if (domPending) domPending.innerText = "₹" + totalPending.toLocaleString();
  if (domRecur) domRecur.innerText = recurring;

  if (allExpenses.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 2rem; color: var(--text-muted);">No expenses found.</td></tr>`;
    return;
  }

  // Sort descending by date
  allExpenses.sort((a,b) => new Date(b.expenseDate || b.date) - new Date(a.expenseDate || a.date));

  let html = "";
  allExpenses.forEach(r => {
    const status = r.status || "Paid";
    const isPending = status === "Pending";
    const statusText = isPending ? "Pending" : "Paid";
    const statusStyle = isPending 
      ? "background:#fffbeb; color:#d97706; border:1px solid #fde68a;" 
      : "background:#f0fdf4; color:#16a34a; border:1px solid #bbf7d0;";

    const catName = r.categoryName || r.category || "General";
    const expName = r.expenseName || r.name || "-";
    const expDate = r.expenseDate || r.date;

    html += `
      <tr style="border-bottom:1px solid var(--border);">
        <td style="padding:16px; font-weight:600; color:var(--text-primary);">${catName}</td>
        <td style="padding:16px;">${r.vendor || expName}</td>
        <td style="padding:16px;">${r.id.substring(0,6).toUpperCase()}</td>
        <td style="padding:16px; font-weight:600; color:var(--text-primary); text-align:right;">₹${r.amount}</td>
        <td style="padding:16px;">${expDate ? new Date(expDate).toISOString().split('T')[0] : "-"}</td>
        <td style="padding:16px; text-align:right;">
          <span style="${statusStyle} padding:4px 12px; border-radius:999px; font-size:11px; font-weight:600;">${statusText}</span>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
};
