// dashboard.js – Simplified to 4 key analytics charts

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

  // Calculate conversation length stats
  const conversationLengths = threads.map(t => t.messages?.length || 0).sort((a, b) => a - b);
  const shortest = conversationLengths[0] || 0;
  const longest = conversationLengths[conversationLengths.length - 1] || 0;
  const average = Math.round(conversationLengths.reduce((sum, len) => sum + len, 0) / conversationLengths.length) || 0;

  // span days (min 1 to avoid div by 0)
  const spanMs = (earliest && latest) ? (latest - earliest) : 0;
  const spanDays = Math.max(1, Math.round(spanMs / (1000*60*60*24)) || 1);
  const activeDays = activeDaysSet.size || (messages ? 1 : 0);

  return {
    chats,
    messages,
    words,
    userMessages,
    assistantMessages,
    peakHour: `${peakHour}:00`,
    byHour,
    conversationLengths: { shortest, average, longest },

    // extras for fun facts
    earliest,
    latest,
    spanDays,
    activeDays
  };
}

function renderCards(stats, threads, container){
  const bar = $('#facts-bar', container);
  if (!bar) return;

  // Define the 4 key analytics cards
  const cards = [
    {
      key: 'activity',
      label: 'Activity Over Time',
      value: `${stats.activeDays} active days`,
      chartTitle: 'Activity Over Time'
    },
    {
      key: 'peak',
      label: 'Peak Hour',
      value: stats.peakHour,
      chartTitle: 'Messages by Hour of Day'
    },
    {
      key: 'lengths',
      label: 'Conversation Lengths',
      value: `${stats.conversationLengths.shortest}-${stats.conversationLengths.longest} msgs`,
      chartTitle: 'Conversation Length Distribution'
    },
    {
      key: 'ratio',
      label: 'User vs AI',
      value: 'View Distribution',
      chartTitle: 'User vs AI Messages'
    }
  ];

  // Render the cards
  bar.innerHTML = cards.map(card => {
    return `
      <div class="fact-card" data-key="${card.key}" data-chart-title="${card.chartTitle}">
        <div class="fact-title">${card.label}</div>
        <div class="fact-value">${fmt(card.value)}</div>
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
          case 'activity':
            renderActivityTimeline(ctx, threads);
            break;
            
          case 'peak':
            renderHourHistogram(ctx, stats.byHour);
            break;
          
          case 'lengths':
            renderMessagesPerChat(ctx, threads);
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

  // Show activity chart by default
  setTimeout(() => showChart('activity'), 200);

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

// Main dashboard initialization
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
  
  // Update title to use "GenAI" instead of "ChatGPT"
  const displayTitle = title ? title.replace(/ChatGPT/gi, 'GenAI') : 'GenAI Analytics';
  
  // Rebuild container with proper spacing
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

  // Compute stats and render
  const stats = computeStats(threads);
  renderCards(stats, sortedThreads, container);

  container.style.display = 'block';
}