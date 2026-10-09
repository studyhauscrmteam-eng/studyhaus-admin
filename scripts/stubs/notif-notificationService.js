/**
 * The `notifications` collection feed: two approval-decision records, so the
 * Activity block has something to render and count.
 */
export const SYSTEM_NOTIFS = [
  { id: "sys-1", type: "approval", title: "Admission approved", body: "Riya Sharma · SH-0229 approved", createdAt: { seconds: 1759910000 } },
  { id: "sys-2", type: "approval", title: "Admission rejected", body: "Unknown · duplicate number", createdAt: { seconds: 1759910500 } },
];

export const listenToAdminNotifications = (onData) => {
  setTimeout(() => onData(SYSTEM_NOTIFS.slice()), 0);
  return () => {};
};
