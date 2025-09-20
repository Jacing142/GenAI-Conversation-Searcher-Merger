// dashboard.js – Cleaned up version + fun facts under each stat

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

function computeStats(threads){
  let chats = threads.length, messages = 0, words = 0;
  const byHour = Array(24).fill(0);
  let userMessages = 0, assistantMessages = 0;

  // extra for fun facts
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

        // time range + active days
        earliest = (earliest === null || d < earliest) ? d : earliest;
        latest   = (latest   === null || d > latest)   ? d : latest;
        const dayKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        activeDaysSet.add(dayKey);
      }
      
      if (m.role === 'user') userMessages++;
      else if (m.role === 'assistant') assistantMessages++;
    }
  }

  // Find peak hour
  let peakHour = 0;
  let maxMessages = 0;
  byHour.forEach((count, hour) => {
    if (count > maxMessages) {
      maxMessages = count;
      peakHour = hour;
    }
  });

  // span days (min 1 to avoid div by 0)
  const spanMs = (earliest && latest) ? (latest - earliest) : 0;
  const spanDays = Math.max(1, Math.round(spanMs / (1000*60*60*24)) || 1);
  const activeDays = activeDaysSet.size || (messages ? 1 : 0);

  const msgsPerDay = messages ? (messages / spanDays) : 0;
  const wordsPerDay = words ? (words / spanDays) : 0;

  return {
    chats,
    messages,
    words,
    avgWordsPerMsg: messages ? Math.round(words / messages) : 0,
    avgMsgsPerChat: chats ? (messages / chats).toFixed(1) : 0,
    userMessages,
    assistantMessages,
    peakHour: `${peakHour}:00`,
    byHour,

    // extras for fun facts
    earliest,
    latest,
    spanDays,
    activeDays,
    msgsPerDay,
    wordsPerDay
  };
}

// ---- Fun facts helpers ----
function funFactFor(key, stats){
  switch (key) {
    case 'chats': {
      // chats over the time range
      const chatsPerWeek = stats.chats ? (stats.chats / Math.max(1, stats.spanDays/7)) : 0;
      return stats.spanDays > 1
        ? `≈ ${chatsPerWeek.toFixed(1)}/week across ${stats.spanDays} days`
        : `All in a single day`;
    }
    case 'messages': {
      const mpd = stats.msgsPerDay;
      return stats.spanDays > 1
        ? `≈ ${mpd.toFixed(1)} messages/day (${stats.activeDays} active days)`
        : `All in one day`;
    }
    case 'words': {
      const w = stats.words;
      // very rough analogies
      const novels = Math.max(1, Math.round(w / 80000)); // ~80k words/novel
      let bits = [`≈ ${novels} novel${novels>1?'s':''}`];
      if (w >= 400000) bits.push(`${(w / 783000).toFixed(1)}× the Bible`);
      if (w >= 500000) bits.push(`${(w / 1084000).toFixed(1)}× Harry Potter`);
      return bits.slice(0,2).join(' • ');
    }
    case 'avgw': {
      return `≈ ${Math.round(stats.wordsPerDay || 0)} words/day`;
    }
    case 'avgm': {
      return `Median chat ≈ ${(stats.messages && stats.chats) ? Math.max(1, Math.round(stats.messages / stats.chats)) : 0} msgs`;
    }
    case 'hour': {
      const h = parseInt(stats.peakHour, 10);
      const tag = (h >= 22 || h <= 5) ? '🌙 Night owl' : (h >= 6 && h <= 10) ? '🌅 Early bird' : '📈 Peak time';
      return `${tag}`;
    }
    case 'ratio': {
      const total = stats.userMessages + stats.assistantMessages;
      const you = total ? Math.round((stats.userMessages / total) * 100) : 0;
      return `You wrote ${you}% of messages`;
    }
    default:
      return '';
  }
}

function renderCards(stats, threads, container){
  const bar = $('#facts-bar', container);
  if (!bar) return;

  // Define each card with its corresponding chart function
  const cards = [
    {
      key: 'chats',
      label: 'Total Chats',
      value: stats.chats,
      chartTitle: 'Conversation Length Distribution'
    },
    {
      key: 'messages',
      label: 'Messages',
      value: stats.messages,
      chartTitle: 'Top Conversations'
    },
    {
      key: 'words',
      label: 'Total Words',
      value: stats.words,
      chartTitle: 'Message Length Distribution'
    },
    {
      key: 'avgw',
      label: 'Avg Words/Msg',
      value: stats.avgWordsPerMsg,
      chartTitle: 'Activity Over Time'
    },
    {
      key: 'avgm',
      label: 'Avg Msgs/Chat',
      value: stats.avgMsgsPerChat,
      chartTitle: 'Chat Length Analysis'
    },
    {
      key: 'hour',
      label: 'Peak Hour',
      value: stats.peakHour,
      chartTitle: 'Activity by Hour'
    },
    {
      key: 'ratio',
      label: 'User vs AI',
      value: `${stats.userMessages}:${stats.assistantMessages}`,
      chartTitle: 'User vs AI Messages'
    }
  ];

  // Render the cards (with fun subtext)
  bar.innerHTML = cards.map(card => {
    const sub = funFactFor(card.key, stats);
    return `
      <div class="fact-card" data-key="${card.key}" data-chart-title="${card.chartTitle}">
        <div class="fact-title">${card.label}</div>
        <div class="fact-value">${fmt(card.value)}</div>
        ${sub ? `<div class="fact-sub" style="font-size:12px;color:#64748b;margin-top:4px;">${sub}</div>` : ''}
      </div>
    `;
  }).join('');

  // Get canvas element  
  const chartCanvas = $(`#${currentCanvasId}`, container);
  const chartTitle = $('#chart-title', container);

  // Function to render chart based on key
  function renderChartForKey(key) {
    if (!chartCanvas) {
      console.error('Canvas not found:', currentCanvasId);
      return;
    }
    
    // Get fresh context
    const ctx = chartCanvas.getContext('2d');
    if (!ctx) {
      console.error('Could not get 2D context');
      return;
    }
    
    // Clear any existing chart
    destroyChart(currentCanvasId);
    
    // Small delay to ensure canvas is ready
    setTimeout(() => {
      try {
        switch(key) {
          case 'chats':
            renderMessagesPerChat(ctx, threads);
            break;
          case 'messages': {
            const topThreads = threads
              .slice(0)
              .sort((a, b) => (b.messages?.length || 0) - (a.messages?.length || 0))
              .slice(0, 10);
            renderTopThreads(
              ctx,
              topThreads.map(t => t.title),
              topThreads.map(t => t.messages?.length || 0)
            );
            break;
          }
          case 'words':
            renderWordsDistribution(ctx, threads);
            break;
          case 'avgw':
            renderActivityTimeline(ctx, threads);
            break;
          case 'avgm':
            renderMessagesPerChat(ctx, threads);
            break;
          case 'hour':
            renderHourHistogram(ctx, stats.byHour);
            break;
          case 'ratio':
            renderUserVsAI(ctx, stats.userMessages, stats.assistantMessages);
            break;
          default:
            console.warn('Unknown chart key:', key);
        }
      } catch (err) {
        console.error('Error rendering chart:', err);
      }
    }, 100);
  }

  // Set default view and handle clicks
  function showChart(key) {
    console.log('Switching to chart:', key);
    
    // Update active state
    $$('.fact-card', container).forEach(c => c.classList.remove('active'));
    const activeCard = bar.querySelector(`.fact-card[data-key="${key}"]`);
    if (activeCard) {
      activeCard.classList.add('active');
      const title = activeCard.getAttribute('data-chart-title');
      if (chartTitle) chartTitle.textContent = title;
    }
    
    // Render new chart
    currentChartType = key;
    renderChartForKey(key);
  }

  // Show hour chart by default
  setTimeout(() => showChart('hour'), 200);

  // Add click handlers
  bar.addEventListener('click', (e) => {
    const card = e.target.closest('.fact-card');
    if (card) {
      const key = card.getAttribute('data-key');
      if (key && key !== currentChartType) {
        showChart(key);
      }
    }
  });
}

// Main dashboard initialization - simplified without spotlight options
export function initDashboard({ threads, container, title }){
  if (!container) return;

  // Clear any existing charts
  destroyChart();
  currentChartType = null;

  if (!threads || !threads.length) {
    container.innerHTML = `<h2>${title || 'Dashboard'}</h2><p style="padding:1rem;">No data available.</p>`;
    container.style.display = 'block';
    return;
  }

  // Sort threads by message count
  const sortedThreads = [...threads].sort((a, b) => 
    (b.messages?.length || 0) - (a.messages?.length || 0)
  );

  // Create unique canvas ID for this container
  currentCanvasId = `chart-canvas-${Date.now()}`;
  
  // Rebuild container with proper spacing to prevent cutoff
  container.innerHTML = `
    <h2>${title || 'All Conversations'}</h2>
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

  // Compute stats and render
  const stats = computeStats(threads);
  renderCards(stats, sortedThreads, container);

  container.style.display = 'block';
}
