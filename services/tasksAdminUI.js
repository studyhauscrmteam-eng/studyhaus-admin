import { collection, addDoc } from "firebase/firestore";
import { db } from "../firebase/firebase.js";

export const initTasksAdminUI = () => {
  const container = document.getElementById("page-tasks");
  if (!container) return;
  
  if (!document.getElementById("add-task-modal")) {
    const modalDiv = document.createElement("div");
    modalDiv.innerHTML = `
      <dialog id="add-task-modal" style="padding:0; border:none; border-radius:12px; box-shadow:0 10px 15px -3px rgba(0,0,0,0.1); width:90%; max-width:400px;">
        <div style="padding:1.5rem; background:var(--bg-card); border-bottom:1px solid var(--border);">
          <h2 style="font-size:1.25rem; font-weight:700; color:var(--text-primary); margin:0;">Create New Task</h2>
        </div>
        <form id="form-add-task" onsubmit="event.preventDefault(); window.submitAddTask()" style="padding:1.5rem;">
          <div class="form-group" style="margin-bottom:1rem;">
            <label style="display:block; margin-bottom:0.25rem; font-size:0.875rem; font-weight:600; color:var(--text-secondary);">Task Description</label>
            <input type="text" id="task-title" required class="input-field" placeholder="e.g. Check AC unit" style="width:100%; box-sizing:border-box; padding:0.5rem; border: 1px solid var(--border); border-radius:6px;" />
          </div>
          <div class="form-group" style="margin-bottom:1rem;">
            <label style="display:block; margin-bottom:0.25rem; font-size:0.875rem; font-weight:600; color:var(--text-secondary);">Assigned To</label>
            <input type="text" id="task-assignee" required class="input-field" placeholder="Name" style="width:100%; box-sizing:border-box; padding:0.5rem; border: 1px solid var(--border); border-radius:6px;" />
          </div>
          <div class="form-group" style="margin-bottom:1rem;">
            <label style="display:block; margin-bottom:0.25rem; font-size:0.875rem; font-weight:600; color:var(--text-secondary);">Due Date</label>
            <input type="date" id="task-due-date" required class="input-field" style="width:100%; box-sizing:border-box; padding:0.5rem; border: 1px solid var(--border); border-radius:6px;" />
          </div>
          <div class="form-group" style="margin-bottom:1.5rem;">
            <label style="display:block; margin-bottom:0.25rem; font-size:0.875rem; font-weight:600; color:var(--text-secondary);">Priority</label>
            <select id="task-priority" required class="input-field" style="width:100%; box-sizing:border-box; padding:0.5rem; border: 1px solid var(--border); border-radius:6px; background: var(--bg-card);">
              <option value="Urgent">Urgent</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>
          </div>
          <div style="display:flex; justify-content:flex-end; gap:0.75rem;">
            <button type="button" class="btn btn-ghost" onclick="document.getElementById('add-task-modal').close()" style="padding:8px 16px; border:1px solid var(--border); border-radius:999px; background:transparent;">Cancel</button>
            <button type="submit" id="btn-save-task" class="btn btn-primary" style="padding:8px 16px; border:none; border-radius:999px; background:var(--primary); color:#fff;">Save Task</button>
          </div>
        </form>
      </dialog>
    `;
    document.body.appendChild(modalDiv.firstElementChild);
  }

  const addTaskBtns = Array.from(document.querySelectorAll("button")).filter(b => b.textContent.includes("+ New Task"));
  addTaskBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      document.getElementById("form-add-task").reset();
      document.getElementById("add-task-modal").showModal();
    });
  });

  window.submitAddTask = async () => {
    const btn = document.getElementById("btn-save-task");
    btn.innerText = "Saving...";
    btn.disabled = true;

    try {
      const data = {
        title: document.getElementById("task-title").value.trim(),
        assignee: document.getElementById("task-assignee").value.trim(),
        dueDate: document.getElementById("task-due-date").value,
        priority: document.getElementById("task-priority").value,
        status: "open",
        createdAt: new Date().toISOString()
      };

      await addDoc(collection(db, "tasks"), data);
      
      document.getElementById("add-task-modal").close();
      window.showToast("Task saved! (Table is currently static but data was saved to Firebase)", "success");
      
    } catch (err) {
      window.showToast("Error adding task: " + err.message, "error");
    } finally {
      btn.innerText = "Save Task";
      btn.disabled = false;
    }
  };
};
