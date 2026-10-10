/**
 * Shared read/dismiss state for notification lists (admin + student portals).
 *
 * Gone means gone — across sign-ins, reopens and accounts on this device.
 * The old key (`readNotifs_<userId>`) broke that promise: the stored userId
 * can resolve differently between sign-ins (uid vs legacy auto-id doc), so
 * every fresh login silently switched to an empty read-set and the exact
 * same notifications came back. The key below is device-wide and stable, and
 * a one-time migration merges every legacy per-user key into it.
 */

const DEVICE_KEY = "sh_read_notifs_v2";
const MIGRATION_FLAG = "__sh_read_migrated_v2";

/** One-time merge of all legacy `readNotifs_*` sets into the stable key. */
const migrateLegacy = () => {
  try {
    if (typeof localStorage === "undefined") return;
    if (localStorage.getItem(MIGRATION_FLAG)) return;
    const legacyKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf("readNotifs_") === 0) legacyKeys.push(k);
    }
    const merged = new Set();
    const absorb = (raw) => {
      try {
        const arr = JSON.parse(raw || "[]");
        if (Array.isArray(arr)) arr.forEach((v) => merged.add(String(v)));
      } catch (_) {}
    };
    absorb(localStorage.getItem(DEVICE_KEY));
    for (const k of legacyKeys) absorb(localStorage.getItem(k));
    localStorage.setItem(DEVICE_KEY, JSON.stringify([...merged].slice(-500)));
    localStorage.setItem(MIGRATION_FLAG, "1");
  } catch (_) {}
};

const storeKey = () => DEVICE_KEY;

export const getReadIds = () => {
  try {
    migrateLegacy();
    const raw = localStorage.getItem(storeKey()) || "[]";
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch (_) {
    return new Set();
  }
};

export const isNotifRead = (id) => {
  if (id == null) return false;
  return getReadIds().has(String(id));
};

export const markNotifRead = (id) => {
  if (id == null) return;
  try {
    const set = getReadIds();
    set.add(String(id));
    localStorage.setItem(storeKey(), JSON.stringify([...set].slice(-500)));
  } catch (_) {}
};

/**
 * Batch version — one storage round-trip for a whole page of ids.
 * Used by the visit-to-clear acknowledgement (open the page → all badges
 * drop at once, no per-item clicking, no buttons).
 */
export const markNotifsRead = (ids) => {
  if (!Array.isArray(ids) || ids.length === 0) return;
  try {
    const set = getReadIds();
    for (const id of ids) {
      if (id != null) set.add(String(id));
    }
    localStorage.setItem(storeKey(), JSON.stringify([...set].slice(-500)));
  } catch (_) {}
};

/**
 * Counts the ids that have NOT been clicked yet — the badge number.
 */
export const countUnread = (ids) => {
  const read = getReadIds();
  return (ids || []).filter((id) => !read.has(String(id))).length;
};
