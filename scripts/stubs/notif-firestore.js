/**
 * Importmap replacement for "firebase/firestore" used by the notification
 * harness. The notification UI modules only ever *build* queries for the lead
 * watch; nothing needs to reach the network, so a no-op query layer is enough
 * and keeps the test hermetic.
 */
export const collection = (db, name) => ({ __col: name, db });
export const where = (field, op, value) => ({ __where: [field, op, value] });
export const query = (col, ...clauses) => ({ __query: [col, ...clauses] });
export const doc = (...parts) => ({ __doc: parts, path: parts.join("/") });
export const serverTimestamp = () => null;
export const onSnapshot = (q, next) => {
  if (typeof next === "function") setTimeout(() => next({ forEach: () => {}, size: 0, docs: [] }), 0);
  return () => {};
};
export const getDoc = async () => ({ exists: () => false, data: () => undefined });
export const getDocs = async () => ({ forEach: () => {}, docs: [], size: 0 });
export const setDoc = async () => {};
export const addDoc = async () => ({ id: "stub" });
export const updateDoc = async () => {};
export const deleteDoc = async () => {};
export const runTransaction = async (db, fn) =>
  fn({
    get: async () => ({ exists: () => false, data: () => ({}) }),
    set: () => {},
    update: () => {},
    delete: () => {},
  });
