/**
 * Chart Service
 * Dynamically loads Chart.js and handles rendering and destroying canvas charts.
 */

const loadScript = (src) => {
  return new Promise((resolve, reject) => {
    if (window.Chart || document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
};

let currentChartInstance = null;

export const renderChart = async (canvasId, type, data, options = {}) => {
  try {
    await loadScript("https://cdn.jsdelivr.net/npm/chart.js");

    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    // Destroy existing chart instance if it exists on this canvas
    if (currentChartInstance) {
      currentChartInstance.destroy();
    }

    currentChartInstance = new window.Chart(ctx, {
      type: type,
      data: data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom' }
        },
        ...options
      }
    });

  } catch (err) {
    console.error("Failed to load or render Chart.js:", err);
  }
};

export const clearChart = () => {
  if (currentChartInstance) {
    currentChartInstance.destroy();
    currentChartInstance = null;
  }
};
