import { collection, addDoc, getDocs } from "firebase/firestore";
import { db } from "../firebase/firebase.js";

export const initStaffAdminUI = () => {
  const container = document.getElementById("page-staff");
  if (!container) return;
  
  if (!document.getElementById("add-staff-modal")) {
    const modalDiv = document.createElement("div");
    modalDiv.innerHTML = `
      <dialog id="add-staff-modal" style="padding:0; border:none; border-radius:12px; box-shadow:0 10px 15px -3px rgba(0,0,0,0.1); width:90%; max-width:400px;">
        <div style="padding:1.5rem; background:var(--bg-card); border-bottom:1px solid var(--border);">
          <h2 style="font-size:1.25rem; font-weight:700; color:var(--text-primary); margin:0;">Add New Staff</h2>
        </div>
        <form id="form-add-staff" onsubmit="event.preventDefault(); window.submitAddStaff()" style="padding:1.5rem;">
          <div class="form-group" style="margin-bottom:1rem;">
            <label style="display:block; margin-bottom:0.25rem; font-size:0.875rem; font-weight:600; color:var(--text-secondary);">Name</label>
            <input type="text" id="staff-name" required class="input-field" style="width:100%; box-sizing:border-box; padding:0.5rem; border: 1px solid var(--border); border-radius:6px;" />
          </div>
          <div class="form-group" style="margin-bottom:1rem;">
            <label style="display:block; margin-bottom:0.25rem; font-size:0.875rem; font-weight:600; color:var(--text-secondary);">Role</label>
            <select id="staff-role" required class="input-field" style="width:100%; box-sizing:border-box; padding:0.5rem; border: 1px solid var(--border); border-radius:6px; background: var(--bg-card);">
              <option value="Manager">Manager</option>
              <option value="Receptionist">Receptionist</option>
              <option value="Security">Security</option>
              <option value="Cleaner">Cleaner</option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom:1rem;">
            <label style="display:block; margin-bottom:0.25rem; font-size:0.875rem; font-weight:600; color:var(--text-secondary);">Contact</label>
            <input type="text" id="staff-contact" required class="input-field" placeholder="+91 ..." style="width:100%; box-sizing:border-box; padding:0.5rem; border: 1px solid var(--border); border-radius:6px;" />
          </div>
          <div class="form-group" style="margin-bottom:1.5rem;">
            <label style="display:block; margin-bottom:0.25rem; font-size:0.875rem; font-weight:600; color:var(--text-secondary);">Salary (₹)</label>
            <input type="number" id="staff-salary" required class="input-field" style="width:100%; box-sizing:border-box; padding:0.5rem; border: 1px solid var(--border); border-radius:6px;" />
          </div>
          <div style="display:flex; justify-content:flex-end; gap:0.75rem;">
            <button type="button" class="btn btn-ghost" onclick="document.getElementById('add-staff-modal').close()" style="padding:8px 16px; border:1px solid var(--border); border-radius:999px; background:transparent;">Cancel</button>
            <button type="submit" id="btn-save-staff" class="btn btn-primary" style="padding:8px 16px; border:none; border-radius:999px; background:var(--primary); color:#fff;">Save Staff</button>
          </div>
        </form>
      </dialog>
    `;
    document.body.appendChild(modalDiv.firstElementChild);
  }

  const addStaffBtns = Array.from(document.querySelectorAll("button")).filter(b => b.textContent.includes("Add staff"));
  addStaffBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      document.getElementById("form-add-staff").reset();
      document.getElementById("add-staff-modal").showModal();
    });
  });

  window.submitAddStaff = async () => {
    const btn = document.getElementById("btn-save-staff");
    btn.innerText = "Saving...";
    btn.disabled = true;

    try {
      const data = {
        name: document.getElementById("staff-name").value.trim(),
        role: document.getElementById("staff-role").value,
        contact: document.getElementById("staff-contact").value.trim(),
        salary: Number(document.getElementById("staff-salary").value),
        joined: new Date().toISOString().split('T')[0],
        status: "Active"
      };

      await addDoc(collection(db, "staff"), data);
      
      document.getElementById("add-staff-modal").close();
      window.showToast("Staff member saved! (Table is currently static but data was saved to Firebase)", "success");
      
    } catch (err) {
      window.showToast("Error adding staff: " + err.message, "error");
    } finally {
      btn.innerText = "Save Staff";
      btn.disabled = false;
    }
  };
};
