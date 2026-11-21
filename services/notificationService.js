import { collection, addDoc, setDoc, serverTimestamp, query, where, orderBy, limit, onSnapshot, updateDoc, doc, getDocs, deleteDoc } from "firebase/firestore";
import { db } from "../firebase/firebase.js";

/**
 * In-app admin notifications (bell/badge + pending queue).
 * Collection: notifications/{autoId}
 * { type, title, body, admissionId, studentId, leadId, createdAt, read, forRoles }
 */

export const notifyAdmins = async ({ type, title, body, admissionId = "", studentId = "", leadId = "", notifId = "" }) => {
  try {
    const id = notifId || (leadId ? `lead_${leadId}` : (admissionId ? `admission_${admissionId}` : ""));
    const payload = {
      type: type || "info",
      title: title || "Notification",
      body: body || "",
      admissionId,
      studentId,
      leadId,
      read: false,
      forRoles: ["Owner/Admin", "Manager"],
      createdAt: serverTimestamp(),
    };
    if (id) {
      await setDoc(doc(db, "notifications", id), payload, { merge: true });
    } else {
      await addDoc(collection(db, "notifications"), payload);
    }
  } catch (e) {
    console.warn("[notifications] queue failed:", e?.message || e);
  }
};

export const notifyNewAdmission = (admission) =>
  notifyAdmins({
    notifId: `admission_${admission.id || admission.uid || ""}`,
    type: "new-admission",
    title: "New admission request",
    body: `${admission.name || "A student"} (${admission.phone || "no phone"}) requested "${admission.planName || "a plan"}". Open Admissions → Pending approval.`,
    admissionId: admission.id || admission.uid || "",
    studentId: admission.id || admission.uid || "",
  });

/**
 * Live count of unread admin notifications for the Pending badge.
 */
export const listenToUnreadNotifications = (onUpdate) => {
  try {
    const q = query(collection(db, "notifications"), where("read", "==", false));
    return onSnapshot(
      q,
      (snap) => {
        let count = 0;
        snap.forEach((d) => {
          const data = d.data() || {};
          if (data.discarded !== true) count++;
        });
        onUpdate(count);
      },
      () => onUpdate(0)
    );
  } catch (_) {
    onUpdate(0);
    return () => {};
  }
};

/**
 * Live list of active unread admin notifications (for the Notifications page).
 * Discarded or read notifications are excluded.
 */
export const listenToAdminNotifications = (onUpdate, max = 50) => {
  try {
    const q = query(collection(db, "notifications"), orderBy("createdAt", "desc"), limit(max));
    return onSnapshot(
      q,
      (snap) => {
        const list = [];
        snap.forEach((d) => {
          const data = d.data() || {};
          if (data.read !== true && data.discarded !== true) {
            list.push({ id: d.id, ...data });
          }
        });
        onUpdate(list);
      },
      () => onUpdate([])
    );
  } catch (_) {
    onUpdate([]);
    return () => {};
  }
};

/**
 * Discards a notification permanently: deletes from Firestore, falls back to read flag.
 */
export const discardNotification = async (id) => {
  if (!id) return;
  try {
    await deleteDoc(doc(db, "notifications", id));
  } catch (e) {
    try {
      await updateDoc(doc(db, "notifications", id), { read: true });
    } catch (err) {
      console.warn("[notifications] discard failed:", err?.message || err);
    }
  }
};

export const markNotificationRead = async (id) => {
  return discardNotification(id);
};

/**
 * Discards all notifications permanently so they are never stored or shown again.
 */
export const discardAllNotifications = async () => {
  try {
    const snap = await getDocs(collection(db, "notifications"));
    const ops = [];
    snap.forEach((d) => {
      ops.push(
        deleteDoc(d.ref).catch(() => updateDoc(d.ref, { read: true }).catch(() => {}))
      );
    });
    if (ops.length > 0) {
      await Promise.all(ops);
    }
  } catch (e) {
    console.warn("[notifications] discard-all failed:", e?.message || e);
  }
};

export const markAllNotificationsRead = async () => {
  return discardAllNotifications();
};
