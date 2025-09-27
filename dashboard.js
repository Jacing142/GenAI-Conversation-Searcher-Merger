// dashboard.js – Simplified to 4 key analytics charts + sample-mode overrides

import { 
  renderHourHistogram, 
  renderTopThreads, 
  renderWordsDistribution,
  renderMessagesPerChat,
  renderActivityTimeline,
  renderUserVsAI,
  destroyChart 
} from './charts.js';

const $ = (sel, ctx=document) => ctx.querySelector(sel);
const $$ = (sel, ctx=document) => ctx.querySelectorAll(sel);
const fmt = (n) => n?.toLocaleString?.() ?? n;

// Store current chart type
let currentChartType = null;
let currentCanvasId = null;

// Synthesize fake threads from monthly counts so charts.js can stay untouched.
// Distributes N "messages" per month across the last 12 months.
function synthesizeThreadsFromMonthlyCounts(monthlyCounts = []) {
  if (!Array.isArray(monthlyCounts) || monthlyCounts.length === 0) return [];
  const threads = [];
  const now = new Date();

  // Build from oldest → newest so axis looks natural
  const months = monthlyCounts.slice(); // copy
  const totalMonths = months.length;

  months.forEach((count, i) => {
    const msgs = [];
    // Choose a date in the i-th month from the end (older first)
    const d = new Date(now);
    d.setMonth(d.getMonth() - (totalMonths - 1 - i));
    d.setDate(15); // middle of month to keep it simple
    d.setHours(10, 0, 0, 0);

    // We only need "count" messages for charts.js to aggregate
    const n = Math.max(0, Math.floor(count));
    for (let k = 0; k < n; k++) {
      const mDate = new Date(d);
      // jitter within the day (minute-level) so they aren't all identical
      mDate.setMinutes(d.getMinutes() + (k % 60));
      msgs.push({
        role: k % 2 === 0 ? 'user' : 'assistant',
        text: 'synthetic',
        created_at: mDate.toISOString()
      });
    }

    threads.push({
      id: `synthetic_${i}`,
      title: `Synthetic Month ${i + 1}`,
      created_at: d.toISOString(),
      updated_at: d.toISOString(),
      messages: msgs
    });
  });

  return threads;
}


// ---------- Core stats from real threads ----------
function computeStats(threads){
  let chats = threads.length, messages = 0, words = 0;
  const byHour = Array(24).fill(0);
  let userMessages = 0, assistantMessages = 0;

  let earliest = null;
  let latest = null;
  const activeDaysSet = new Set();

  for (const t of threads) {
    const msgs = t.messages || [];
    for (const m of msgs) {
      const text = (m.text || '').trim();
      messages++;
      words += text.split(/\s+/).filter(Boolean).length;

      const d = (m.created_at instanceof Date) ? m.created_at : new Date(m.created_at);
      if (!isNaN(d)) {
        const h = d.getHours();
        byHour[h] = (byHour[h] || 0) + 1;

        earliest = (earliest === null || d < earliest) ? d : earliest;
        latest   = (latest   === null || d > latest)   ? d : latest;

        const dayKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        activeDaysSet.add(dayKey);
      }
      if (m.role === 'user') userMessages++;
      else if (m.role === 'assistant') assistantMessages++;
    }
  }

  // Peak hour
  let peakHour = 0;
  let maxMessages = 0;
  byHour.forEach((count, hour) => {
    if (count > maxMessages) { maxMessages = count; peakHour = hour; }
  });

  // Conversation lengths
  const conversationLengths = threads.map(t => t.messages?.length || 0).sort((a, b) => a - b);
  const shortest = conversationLengths[0] || 0;
  const longest = conversationLengths[conversationLengths.length - 1] || 0;
  const average = Math.round(
    conversationLengths.reduce((sum, len) => sum + len, 0) / (conversationLengths.length || 1)
  ) || 0;

  const spanMs = (earliest && latest) ? (latest - earliest) : 0;
  const spanDays = Math.max(1, Math.round(spanMs / (1000*60*60*24)) || 1);
  const activeDays = activeDaysSet.size || (messages ? 1 : 0);

  return {
    chats,
    messages,
    words,
    userMessages,
    assistantMessages,
    peakHour: `${String(peakHour).padStart(2,'0')}:00`,
    byHour,
    conversationLengths: { shortest, average, longest },
    earliest,
    latest,
    spanDays,
    activeDays
  };
}

// ---------- Synthetic builders used only in sample mode ----------
function makeThreadsForBuckets(bucketCounts) {
  const now = new Date();
  const mkMsgs = (n) => Array.from({ length: n }, (_, i) => ({
    role: i % 2 ? 'assistant' : 'user',
    text: `Sample message ${i + 1}`,
    created_at: now.toISOString()
  }));
  const out = [];
  const pushN = (nThreads, msgsPerThread) => {
    for (let i = 0; i < nThreads; i++) {
      out.push({
        id: `bucket_${msgsPerThread}_${i}`,
        title: `Sample conversation (${msgsPerThread} messages)`,
        created_at: now.toISOString(),
        messages: mkMsgs(msgsPerThread)
      });
    }
  };
  // Example mapping: pick a typical size inside each bucket
  pushN(bucketCounts['1-5']   || 0, 3);
  pushN(bucketCounts['6-10']  || 0, 8);
  pushN(bucketCounts['11-20'] || 0, 15);
  pushN(bucketCounts['21-50'] || 0, 30);
  pushN(bucketCounts['50+']   || 0, 60);
  return out;
}

function makeThreadsForMonthlyCounts(monthCounts) {
  const out = [];
  const now = new Date();
  monthCounts.forEach((count, i) => {
    const d = new Date(now);
    d.setMonth(d.getMonth() - (11 - i)); // oldest → newest
    const y = d.getFullYear();
    const m = d.getMonth();
    const messages = Array.from({ length: count }, (_, k) => {
      const dd = new Date(y, m, Math.min(25, 1 + (k % 25)), 10, 0, 0);
      return {
        role: k % 2 ? 'assistant' : 'user',
        text: `Synthetic activity ${k + 1}`,
        created_at: dd.toISOString()
      };
    });
    out.push({
      id: `month_${y}_${String(m + 1).padStart(2, '0')}`,
      title: `Activity ${y}-${String(m + 1).padStart(2, '0')}`,
      created_at: new Date(y, m, 1).toISOString(),
      messages
    });
  });
  return out;
}

// ---------- Rendering ----------
function renderCards(stats, threads, container, { sampleMode, statsOverride }){
  const bar = $('#facts-bar', container);
  if (!bar) return;

  const displayActiveDays = (sampleMode && statsOverride?.activeDays != null)
    ? statsOverride.activeDays
    : stats.activeDays;

  const displayPeakHour = (sampleMode && statsOverride?.peakHour)
    ? statsOverride.peakHour
    : stats.peakHour;

  const ratioLabel = (sampleMode && statsOverride?.userVsAi)
    ? `${statsOverride.userVsAi.user}% vs ${statsOverride.userVsAi.ai}%`
    : 'View Distribution';

  const cards = [
    { key: 'activity', label: 'Activity Over Time', value: `${displayActiveDays} active days`, chartTitle: 'Activity Over Time' },
    { key: 'peak',     label: 'Peak Hour',          value: displayPeakHour,                 chartTitle: 'Messages by Hour of Day' },
    { key: 'lengths',  label: 'Conversation Lengths', value: `${stats.conversationLengths.shortest}-${stats.conversationLengths.longest} msgs`, chartTitle: 'Conversation Length Distribution' },
    { key: 'ratio',    label: 'User vs AI',         value: ratioLabel,                      chartTitle: 'User vs AI Messages' }
  ];

  bar.innerHTML = cards.map(card => `
    <div class="fact-card" data-key="${card.key}" data-chart-title="${card.chartTitle}">
      <div class="fact-title">${card.label}</div>
      <div class="fact-value">${fmt(card.value)}</div>
    </div>
  `).join('');

  const chartCanvas = $(`#${currentCanvasId}`, container);
  const chartTitle = $('#chart-title', container);

  function renderChartForKey(key) {
    if (!chartCanvas) return console.error('Canvas not found:', currentCanvasId);
    const ctx = chartCanvas.getContext('2d');
    if (!ctx) return console.error('Could not get 2D context');

    destroyChart(currentCanvasId);

    setTimeout(() => {
      try {
        switch (key) {
          case 'activity': {
            // SAMPLE MODE: keep your hand-crafted chart exactly as-is
            if (sampleMode) {
              // Hardwired labels & values to match the screenshot
              const labels = [
                '10/24','11/24','12/24','01/25','02/25','03/25',
                '04/25','05/25','06/25','07/25','08/25','09/25'
              ];
              const values = [700, 950, 1020, 990, 720, 620, 800, 2100, 1650, 2800, 2400, 2520];

              // eslint-disable-next-line no-undef
              new Chart(ctx, {
                type: 'line',
                data: {
                  labels,
                  datasets: [{
                    label: 'Messages per Month',
                    data: values,
                    fill: true,
                    tension: 0.35,
                    borderWidth: 3,
                    borderColor: 'rgba(99, 102, 241, 1)',
                    backgroundColor: 'rgba(99, 102, 241, 0.15)',
                    pointRadius: 3,
                    pointHoverRadius: 5
                  }]
                },
                options: {
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { display: false },
                    title: {
                      display: true,
                      text: 'Activity Over Time (Messages per Month)',
                      color: '#0f172a',
                      font: { size: 14, weight: '600' },
                      padding: { bottom: 8 }
                    },
                    tooltip: { mode: 'index', intersect: false }
                  },
                  scales: {
                    x: { grid: { display: false }, ticks: { color: '#475569' } },
                    y: {
                      beginAtZero: true,
                      suggestedMax: 3000,
                      ticks: { color: '#475569' },
                      grid: { color: 'rgba(148, 163, 184, 0.2)' }
                    }
                  }
                }
              });
            } else {
              // REAL DATA: keep charts.js pipeline
              renderActivityTimeline(ctx, threads);
            }
            break;
          }
          case 'peak': {
            if (sampleMode && Array.isArray(statsOverride?.byHour) && statsOverride.byHour.length === 24) {
              renderHourHistogram(ctx, statsOverride.byHour);
            } else {
              renderHourHistogram(ctx, stats.byHour);
            }
            break;
          }
          case 'lengths': {
            if (sampleMode && statsOverride?.lengthBuckets) {
              const synthetic = makeThreadsForBuckets(statsOverride.lengthBuckets);
              renderMessagesPerChat(ctx, synthetic);
            } else {
              renderMessagesPerChat(ctx, threads);
            }
            break;
          }
          case 'ratio': {
            if (sampleMode && statsOverride?.userVsAi) {
              renderUserVsAI(ctx, statsOverride.userVsAi.user, statsOverride.userVsAi.ai);
            } else {
              renderUserVsAI(ctx, stats.userMessages, stats.assistantMessages);
            }
            break;
          }
          default:
            console.warn('Unknown chart key:', key);
        }
      } catch (err) {
        console.error('Error rendering chart:', err);
      }
    }, 100);
  }

  function showChart(key) {
    $$('.fact-card', container).forEach(c => c.classList.remove('active'));
    const activeCard = bar.querySelector(`.fact-card[data-key="${key}"]`);
    if (activeCard) {
      activeCard.classList.add('active');
      const title = activeCard.getAttribute('data-chart-title');
      if (chartTitle) chartTitle.textContent = title;
    }
    currentChartType = key;
    renderChartForKey(key);
  }

  setTimeout(() => showChart('activity'), 200);

  bar.addEventListener('click', (e) => {
    const card = e.target.closest('.fact-card');
    if (card) {
      const key = card.getAttribute('data-key');
      if (key && key !== currentChartType) showChart(key);
    }
  });
}

// ---------- Entry ----------
export function initDashboard({ threads, container, title, statsOverride = null, sampleMode = false }){
  if (!container) return;

  destroyChart();
  currentChartType = null;

  if (!threads || !threads.length) {
    container.innerHTML = `<h2>${title || 'Dashboard'}</h2><p style="padding:1rem;">No data available.</p>`;
    container.style.display = 'block';
    return;
  }

  const sortedThreads = [...threads].sort((a, b) =>
    (b.messages?.length || 0) - (a.messages?.length || 0)
  );

  currentCanvasId = `chart-canvas-${Date.now()}`;

  const displayTitle = title ? title.replace(/ChatGPT/gi, 'GenAI') : 'GenAI Analytics';

  container.innerHTML = `
    <h2>${displayTitle}</h2>
    <div id="facts-bar"></div>
    <div id="chart-wrap" style="
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      padding: 14px;
      margin: 16px 0;
      background: white;
      min-height: 420px;
      position: relative;
    ">
      <div id="chart-title" style="
        font-size: 14px;
        color: #64748b;
        font-weight: 500;
        margin: 0 0 10px;
        height: 20px;
      "></div>
      <div style="position: relative; height: 360px; padding-bottom: 10px;">
        <canvas id="${currentCanvasId}" style="width: 100%; height: 100%;"></canvas>
      </div>
    </div>
  `;

  const stats = computeStats(threads);
  renderCards(stats, sortedThreads, container, { sampleMode, statsOverride });

  container.style.display = 'block';
}
