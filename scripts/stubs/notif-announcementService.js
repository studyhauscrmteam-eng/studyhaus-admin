/**
 * Data source for the notification harness — three announcements, delivered the
 * way listenToAnnouncements delivers them (asynchronously, after the module has
 * finished rendering its "Loading announcements..." placeholder).
 */
export const ANNOUNCEMENTS = [
  { id: "ann-a", title: "Diwali timings", message: "Library closes at 8pm on Diwali.", type: "info", audience: "All Students", createdAt: { seconds: 1759900000 } },
  { id: "ann-b", title: "New batch", message: "Morning batch starts Monday.", type: "success", audience: "All Students", createdAt: { seconds: 1759900100 } },
  { id: "ann-c", title: "Seat change", message: "Row 4 is reserved.", type: "warning", audience: "Specific Students", createdAt: { seconds: 1759900200 } },
];

export const listenToAnnouncements = (onData) => {
  setTimeout(() => onData(ANNOUNCEMENTS.slice()), 0);
  return () => {};
};

export const createAnnouncement = async () => ({ success: true });
export const deleteAnnouncement = async () => ({ success: true });
export const getAllStudentsForDropdown = async () => [];
export const isAnnouncementLive = () => true;
