/**
 * Parses an array of visitor objects and returns analytics for the Dashboard and Admin views.
 */
export const calculateVisitorAnalytics = (visitors) => {
  const now = new Date();
  
  // Date strings for comparison
  const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  
  // Calculate 7 days ago string for weekly comparison
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const weekAgoStr = `${sevenDaysAgo.getFullYear()}-${String(sevenDaysAgo.getMonth()+1).padStart(2,'0')}-${String(sevenDaysAgo.getDate()).padStart(2,'0')}`;

  let todayCount = 0;
  let weeklyCount = 0;
  let monthlyCount = 0;
  let totalCount = visitors.length;

  const purposeCounts = {};

  visitors.forEach(v => {
    // Basic counts
    if (v.visitDate === todayStr) todayCount++;
    if (v.visitDate >= weekAgoStr) weeklyCount++;
    if (v.visitDate.startsWith(currentMonthStr)) monthlyCount++;

    // Purpose aggregation
    const p = v.purpose || "Unknown";
    purposeCounts[p] = (purposeCounts[p] || 0) + 1;
  });

  return {
    todayCount,
    weeklyCount,
    monthlyCount,
    totalCount,
    purposeCounts
  };
};
