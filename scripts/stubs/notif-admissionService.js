/**
 * The Pending-approval queue feed. Same contract as the real
 * listenToPendingAdmissions: hand back a list of pending records. The harness
 * can push a fresh record later to prove a NEW arrival raises every badge.
 */
export const PENDING = [
  { id: "f3B3XTYQ3Xy6vH6EsPzI", name: "Shubh patel", phone: "9000000001", planName: "Annual ₹6000", createdAt: { seconds: 1759940000 } },
  { id: "fVRJzTlv9cogXP1Yrd5D", name: "Soumyarajsinh Zala", phone: "9000000002", planName: "Monthly ₹1000", createdAt: { seconds: 1759680000 } },
];

let subscriber = null;

export const listenToPendingAdmissions = (onData) => {
  subscriber = onData;
  setTimeout(() => onData(PENDING.slice()), 0);
  return () => {};
};

/** Harness hook: simulate a brand-new admission request arriving live. */
window.__pushPending = (list) => {
  PENDING.length = 0;
  PENDING.push(...list);
  if (subscriber) subscriber(list.slice());
};
