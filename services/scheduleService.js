import { getDoc, doc } from "firebase/firestore";
import { db } from "../firebase/firebase.js";

export const DEFAULT_SCHEDULES = {
  normal: {
    dayStart: "06:00",
    dayEnd: "18:00",
    nightStart: "18:00",
    nightEnd: "06:00"
  },
  premium: {
    dayStart: "06:00",
    dayEnd: "18:00",
    nightStart: "18:00",
    nightEnd: "06:00"
  }
};

/**
 * Parses "HH:MM" (24-hour) into minutes from midnight (0..1439).
 */
export const timeToMinutes = (timeStr) => {
  if (!timeStr || typeof timeStr !== "string") return 0;
  const parts = timeStr.trim().split(":");
  const h = Number(parts[0]) || 0;
  const m = Number(parts[1]) || 0;
  return (h * 60) + m;
};

/**
 * Checks whether a given "HH:MM" time falls within [start, end).
 * Supports ranges that cross midnight (e.g. 18:00 -> 06:00).
 */
export const isTimeInRange = (currentHHMM, startHHMM, endHHMM) => {
  const cur = timeToMinutes(currentHHMM);
  const start = timeToMinutes(startHHMM);
  const end = timeToMinutes(endHHMM);

  if (start === end) {
    // 24-hour range
    return true;
  }

  if (start < end) {
    // Normal daytime interval, e.g. 06:00 to 18:00
    return cur >= start && cur < end;
  } else {
    // Overnight interval crossing midnight, e.g. 18:00 to 06:00
    return cur >= start || cur < end;
  }
};

/**
 * Get current local time as "HH:MM"
 */
export const getCurrentTimeString = (date = new Date()) => {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
};

/**
 * Cached schedules to avoid repeated Firestore reads.
 */
let cachedSchedules = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 60000; // 1 minute

export const getLibrarySchedules = async () => {
  const now = Date.now();
  if (cachedSchedules && (now - lastFetchTime) < CACHE_TTL_MS) {
    return cachedSchedules;
  }
  try {
    const snap = await getDoc(doc(db, "settings", "global_settings"));
    const data = snap.exists() ? snap.data() : {};
    const schedules = {
      normal: {
        ...DEFAULT_SCHEDULES.normal,
        ...(data.schedules?.normal || {
          dayStart: data.normalDayStart || DEFAULT_SCHEDULES.normal.dayStart,
          dayEnd: data.normalDayEnd || DEFAULT_SCHEDULES.normal.dayEnd,
          nightStart: data.normalNightStart || DEFAULT_SCHEDULES.normal.nightStart,
          nightEnd: data.normalNightEnd || DEFAULT_SCHEDULES.normal.nightEnd
        })
      },
      premium: {
        ...DEFAULT_SCHEDULES.premium,
        ...(data.schedules?.premium || {
          dayStart: data.premiumDayStart || DEFAULT_SCHEDULES.premium.dayStart,
          dayEnd: data.premiumDayEnd || DEFAULT_SCHEDULES.premium.dayEnd,
          nightStart: data.premiumNightStart || DEFAULT_SCHEDULES.premium.nightStart,
          nightEnd: data.premiumNightEnd || DEFAULT_SCHEDULES.premium.nightEnd
        })
      }
    };
    cachedSchedules = schedules;
    lastFetchTime = now;
    return schedules;
  } catch (_) {
    return DEFAULT_SCHEDULES;
  }
};

/**
 * Invalidate schedule cache (called when settings are saved)
 */
export const invalidateScheduleCache = () => {
  cachedSchedules = null;
  lastFetchTime = 0;
};

/**
 * Determine the current active shift for a library ('day' or 'night')
 */
export const getCurrentShift = (schedule, timeStr = getCurrentTimeString()) => {
  const isNight = isTimeInRange(timeStr, schedule.nightStart, schedule.nightEnd);
  return isNight ? "night" : "day";
};

/**
 * Validates whether a student can access/check in at the current time for the given floor/library.
 *
 * @param {Object} student - student document data
 * @param {string} targetFloor - "Ground Floor" or "First Floor"
 * @param {Date} [nowDate]
 * @returns {Promise<{ allowed: boolean, reason?: string, currentShift: string, planShift: string }>}
 */
export const validateStudentScheduleAccess = async (student, targetFloor = "Ground Floor", nowDate = new Date()) => {
  const schedules = await getLibrarySchedules();
  const isPremiumFloor = String(targetFloor || "").toLowerCase().includes("first") || String(targetFloor || "").toLowerCase().includes("premium");
  const libSchedule = isPremiumFloor ? schedules.premium : schedules.normal;
  const libName = isPremiumFloor ? "Shreeji Premium Reading Library (First Floor)" : "Shreeji Reading Library (Ground Floor)";

  const currentTime = getCurrentTimeString(nowDate);
  const planName = String(student.planName || "").toLowerCase();

  // Determine plan shift requirement
  const isNightPlan = planName.includes("night") || planName.includes("ln") || planName.includes("pn");
  const isDayPlan = (planName.includes("day") || planName.includes("lr") || planName.includes("pr")) && !planName.includes("full") && !planName.includes("24");
  const isFullDayOr24h = planName.includes("24") || planName.includes("full") || (!isNightPlan && !isDayPlan);

  const planShift = isNightPlan ? "night" : (isDayPlan ? "day" : "24hr");
  const currentShift = getCurrentShift(libSchedule, currentTime);

  // Full day or 24/7 plans can enter anytime
  if (isFullDayOr24h) {
    return { allowed: true, currentShift, planShift };
  }

  if (isNightPlan) {
    const inNight = isTimeInRange(currentTime, libSchedule.nightStart, libSchedule.nightEnd);
    if (!inNight) {
      return {
        allowed: false,
        reason: `Your night-shift plan permits entry between ${libSchedule.nightStart} and ${libSchedule.nightEnd}. Current time is ${currentTime}.`,
        currentShift,
        planShift
      };
    }
    return { allowed: true, currentShift, planShift };
  }

  if (isDayPlan) {
    const inDay = isTimeInRange(currentTime, libSchedule.dayStart, libSchedule.dayEnd);
    if (!inDay) {
      return {
        allowed: false,
        reason: `Your day-shift plan permits entry between ${libSchedule.dayStart} and ${libSchedule.dayEnd}. Current time is ${currentTime}.`,
        currentShift,
        planShift
      };
    }
    return { allowed: true, currentShift, planShift };
  }

  return { allowed: true, currentShift, planShift };
};
