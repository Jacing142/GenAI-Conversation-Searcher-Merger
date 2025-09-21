// charts.js – Fixed chart destruction and management

// Global chart registry - track ALL chart instances
const chartInstances = new Map();

// ---- Global theme ----
function setTheme() {
  if (!window.Chart) return;
  Chart.defaults.borderColor = '#d1d5db';
  Chart.defaults.font.family = 'Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
  Chart.defaults.font.size = 13;
  Chart.defaults.color = '#374151';
  Chart.defaults.responsive = true;
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.plugins.tooltip.backgroundColor = '#1f2937';
  Chart.defaults.plugins.tooltip.titleColor = '#ffffff';
  Chart.defaults.plugins.tooltip.bodyColor = '#e5e7eb';
  Chart.defaults.plugins.tooltip.titleFont = { size: 14, weight: '600' };
  Chart.defaults.plugins.tooltip.bodyFont = { size: 13 };
  Chart.defaults.plugins.legend.display = false;
}
if (window.Chart) {
  setTheme();
} else {
  window.addEventListener('load', setTheme);
}


const grid = { color: '#e2e8f0', borderDash: [2, 2] };
const ticks = { color: '#64748b', font: { size: 11 } };

function thousands(n){ 
  try{ return Number(n).toLocaleString(); } 
  catch { return n; } 
}

// CRITICAL: Destroy ALL charts or specific chart
export function destroyChart(canvasId = null) {
  if (canvasId) {
    // Destroy specific chart
    const chart = chartInstances.get(canvasId);
    if (chart) {
      console.log(`Destroying chart for canvas: ${canvasId}`);
      chart.destroy();
      chartInstances.delete(canvasId);
    }
  } else {
    // Destroy all charts
    console.log(`Destroying ${chartInstances.size} chart(s)`);
    chartInstances.forEach((chart, id) => {
      chart.destroy();
    });
    chartInstances.clear();
  }
}

// Helper to safely create chart
function createChart(ctx, config) {
  if (!ctx) return null;
  
  const canvasId = ctx.canvas?.id || 'default';
  
  // More aggressive chart cleanup
  const existingChart = Chart.getChart(ctx);
  if (existingChart) {
    existingChart.destroy();
  }
  
  // Also clear from our registry
  chartInstances.delete(canvasId);
  
  // Create new chart
  try {
    const chart = new Chart(ctx, config);
    chartInstances.set(canvasId, chart);
    return chart;
  } catch (err) {
    console.error('Error creating chart:', err);
    return null;
  }
}

// Ensure we always have an array[24]
function normalize24(x){
  if (Array.isArray(x)) {
    const arr = x.slice(0,24);
    while (arr.length < 24) arr.push(0);
    return arr;
  }
  const out = Array(24).fill(0);
  if (x && typeof x === 'object') {
    for (let i=0;i<24;i++) { 
      const k = String(i); 
      out[i] = Number(x[k] ?? x[i] ?? 0); 
    }
  }
  return out;
}

// ---- Hour-of-day vertical columns ----
export function renderHourHistogram(ctx, counts){
  if (!ctx) return;
  
  const data = normalize24(counts);
  
  const config = {
    type: 'bar',
    data: {
      labels: [...Array(24)].map((_, i) => String(i).padStart(2, '0')),
      datasets: [{
        data,
        backgroundColor: '#dbeafe',
        borderColor: '#2563eb',
        borderWidth: 1,
        borderRadius: 6,
        barPercentage: 0.9,
        categoryPercentage: 0.8
      }]
    },
    options: {
      animation: { duration: 300 },
      plugins: {
        title: { 
          display: true, 
          text: 'Messages by Hour of Day', 
          color: '#0f172a', 
          font: { weight: '600', size: 14 }, 
          padding: { bottom: 8 } 
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `Messages: ${thousands(ctx.parsed.y)}`
          }
        }
      },
      scales: {
        x: { grid, ticks },
        y: { 
          grid, 
          ticks: { ...ticks, precision: 0 }, 
          beginAtZero: true 
        }
      },
      layout: { 
        padding: { left: 6, right: 6, top: 4, bottom: 4 } 
      }
    }
  };
  
  return createChart(ctx, config);
}

// ---- Top threads horizontal bars ----
export function renderTopThreads(ctx, labels, counts){
  if (!ctx) return;
  
  const L = (labels || []).map(String);
  const C = (counts || []).map(Number);
  
  // Truncate long labels
  const trunc = (s) => s.length > 38 ? s.slice(0,35) + '…' : s;

  const config = {
    type: 'bar',
    data: {
      labels: L.map(trunc),
      datasets: [{
        data: C,
        backgroundColor: '#dbeafe',
        borderColor: '#2563eb',
        borderWidth: 1,
        borderRadius: 6,
        barPercentage: 0.85,
        categoryPercentage: 0.8
      }]
    },
    options: {
      indexAxis: 'y', // Horizontal bars
      animation: { duration: 300 },
      plugins: {
        title: { 
          display: true, 
          text: 'Top 10 Threads (by messages)', 
          color: '#0f172a', 
          font: { weight:'600', size:14 }, 
          padding:{ bottom: 8 } 
        },
        tooltip: {
          callbacks: {
            title: (items) => (items[0]?.label || ''),
            label: (ctx) => `Messages: ${thousands(ctx.parsed.x)}`
          }
        }
      },
      scales: {
        x: { 
          grid, 
          ticks: { ...ticks, precision: 0 }, 
          beginAtZero: true 
        },
        y: { 
          grid: { display:false }, 
          ticks: { color: '#0f172a', font: { size: 12 } } 
        }
      },
      layout: { 
        padding: { left: 6, right: 10, top: 4, bottom: 4 } 
      }
    }
  };
  
  return createChart(ctx, config);
}

// ---- Words per Message Distribution ----
export function renderWordsDistribution(ctx, threads) {
  if (!ctx) return;
  
  // Calculate word counts per message
  const wordCounts = [];
  threads.forEach(t => {
    t.messages?.forEach(m => {
      const words = (m.text || '').trim().split(/\s+/).filter(Boolean).length;
      wordCounts.push(words);
    });
  });
  
  // Create buckets
  const buckets = {
    '0-50': 0,
    '51-100': 0,
    '101-200': 0,
    '201-500': 0,
    '500+': 0
  };
  
  wordCounts.forEach(count => {
    if (count <= 50) buckets['0-50']++;
    else if (count <= 100) buckets['51-100']++;
    else if (count <= 200) buckets['101-200']++;
    else if (count <= 500) buckets['201-500']++;
    else buckets['500+']++;
  });
  
  const config = {
    type: 'doughnut',
    data: {
      labels: Object.keys(buckets),
      datasets: [{
        data: Object.values(buckets),
        backgroundColor: [
          '#dbeafe',
          '#bfdbfe',
          '#93c5fd',
          '#60a5fa',
          '#3b82f6'
        ],
        borderColor: '#2563eb',
        borderWidth: 1
      }]
    },
    options: {
      animation: { duration: 300 },
      plugins: {
        title: { 
          display: true, 
          text: 'Message Length Distribution (words)', 
          color: '#0f172a', 
          font: { weight:'600', size:14 }, 
          padding:{ bottom: 8 } 
        },
        legend: {
          display: true,
          position: 'right'
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.label}: ${thousands(ctx.parsed)} messages`
          }
        }
      }
    }
  };
  
  return createChart(ctx, config);
}

// ---- Messages per Chat Distribution ----
export function renderMessagesPerChat(ctx, threads) {
  if (!ctx) return;
  
  // Count messages per thread
  const distribution = {};
  threads.forEach(t => {
    const count = t.messages?.length || 0;
    const bucket = count <= 5 ? '1-5' :
                   count <= 10 ? '6-10' :
                   count <= 20 ? '11-20' :
                   count <= 50 ? '21-50' : '50+';
    distribution[bucket] = (distribution[bucket] || 0) + 1;
  });
  
  const orderedBuckets = ['1-5', '6-10', '11-20', '21-50', '50+'];
  const data = orderedBuckets.map(b => distribution[b] || 0);
  
  const config = {
    type: 'bar',
    data: {
      labels: orderedBuckets,
      datasets: [{
        data,
        backgroundColor: '#10b981',
        borderColor: '#059669',
        borderWidth: 1,
        borderRadius: 6
      }]
    },
    options: {
      animation: { duration: 300 },
      plugins: {
        title: { 
          display: true, 
          text: 'Conversation Length Distribution', 
          color: '#0f172a', 
          font: { weight:'600', size:14 }, 
          padding:{ bottom: 8 } 
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `${thousands(ctx.parsed.y)} chats with ${ctx.label} messages`
          }
        }
      },
      scales: {
        x: { grid, ticks },
        y: { 
          grid, 
          ticks: { ...ticks, precision: 0 }, 
          beginAtZero: true 
        }
      }
    }
  };
  
  return createChart(ctx, config);
}

// ---- Activity Over Time ----
export function renderActivityTimeline(ctx, threads) {
  if (!ctx) return;
  
  // Group by month
  const monthlyActivity = {};
  threads.forEach(t => {
    t.messages?.forEach(m => {
      const date = m.created_at instanceof Date ? m.created_at : new Date(m.created_at);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      monthlyActivity[monthKey] = (monthlyActivity[monthKey] || 0) + 1;
    });
  });
  
  // Sort by date and take last 12 months
  const sorted = Object.entries(monthlyActivity)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-12);
  
  const config = {
    type: 'line',
    data: {
      labels: sorted.map(([month]) => {
        const [year, m] = month.split('-');
        return `${m}/${year.slice(2)}`;
      }),
      datasets: [{
        data: sorted.map(([, count]) => count),
        borderColor: '#8b5cf6',
        backgroundColor: 'rgba(139, 92, 246, 0.1)',
        borderWidth: 2,
        tension: 0.4,
        fill: true
      }]
    },
    options: {
      animation: { duration: 300 },
      plugins: {
        title: { 
          display: true, 
          text: 'Activity Over Time (Messages per Month)', 
          color: '#0f172a', 
          font: { weight:'600', size:14 }, 
          padding:{ bottom: 8 } 
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `${thousands(ctx.parsed.y)} messages`
          }
        }
      },
      scales: {
        x: { grid, ticks },
        y: { 
          grid, 
          ticks: { ...ticks, precision: 0 }, 
          beginAtZero: true 
        }
      }
    }
  };
  
  return createChart(ctx, config);
}

// ---- User vs AI Pie Chart ----
export function renderUserVsAI(ctx, userCount, aiCount) {
  if (!ctx) return;
  
  const config = {
    type: 'pie',
    data: {
      labels: ['User Messages', 'AI Responses'],
      datasets: [{
        data: [userCount, aiCount],
        backgroundColor: ['#3b82f6', '#10b981'],
        borderWidth: 1
      }]
    },
    options: {
      animation: { duration: 300 },
      plugins: {
        title: { 
          display: true, 
          text: 'Message Distribution', 
          color: '#0f172a', 
          font: { weight:'600', size:14 }
        },
        legend: { 
          display: true, 
          position: 'bottom' 
        }
      }
    }
  };
  
  return createChart(ctx, config);
}