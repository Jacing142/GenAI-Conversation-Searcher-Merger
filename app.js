// app.js – Full file (DnD, modal viewer, exports, virtualization, static charts)

import { parseExport } from './parser.js';
import { initDashboard } from './dashboard.js';
import {
  init as initSearch,
  addFilter,
  removeFilter,
  clearFilters,
  getFilters,
  search as runSearch,
  getSnippet,
  clearSelections,
  toggleSelection,
  exportAsJSON,
  exportAsHTML,
  exportAsCSV,
  setSelections,
  downloadFile,
  highlightText,
  getDefaultFilename,
  setFilters
} from './search.js';

const $ = (id) => document.getElementById(id);

// ---- State ----
const state = {
  files: [],
  allThreads: [],
  filteredThreads: [],
  clusters: [],
  unclustered: [],
  debugMode: false,
  currentClusterName: null,
  currentClusterThreads: [],
  uploadHash: null,
  dashboardLocked: false,

  // Sample mode
  sampleMode: false,
  sampleDefaultFiltersCount: 0,
  _prevFilterCount: 0,
  _sampleExtraLimit: 0 // grows by up to +2 as filters are removed
};

// Charts: mount once per dataset (sample OR real)
let dashboardMounted = false;

// Fixed sample-mode stats (used only when state.sampleMode === true)
const DEMO_STATS = {
  activeDays: 220,
  peakHour: '10:00',
  // 24 values with a clear peak at 10:00
  byHour: [5,8,12,15,22,35,45,58,72,85,100,95,88,82,75,68,62,58,52,45,38,28,18,8],
  userVsAi: { user: 45, ai: 55 },
  // Desired distribution for lengths (absolute thread counts)
  lengthBuckets: { '1-5': 12, '6-10': 7, '11-20': 3, '21-50': 8, '50+': 2 },
  // Monthly activity counts (12 values = last 12 months)
  monthlyActivityCounts: [700, 950, 1020, 990, 720, 620, 800, 2100, 1650, 2800, 2400, 2520]
};

// ---- DOM Elements ----
const fileInput = $('fileInput');
const uploadBtn = $('uploadBtn');
const extractBtn = $('extractBtn');

const progressWrapper = $('progress-wrapper');
const progressBar = $('progressBar');
const statusEl = $('status');

const projectListContainer = $('project-list-container');
const projectListDiv = $('project-list');
const spotlightContainer = $('spotlight-container');

// Track page visit
mixpanel.track('Page Visit');

// ---- Debug Panel ----
function createDebugPanel() {
  if ($('debug-panel')) return;
  const panel = document.createElement('div');
  panel.id = 'debug-panel';
  panel.style.cssText = `
    position: fixed; bottom: 20px; left: 20px; max-width: 400px; max-height: 300px;
    overflow-y: auto; background: #1e293b; color: #e2e8f0; padding: 12px; border-radius: 8px;
    font-family: monospace; font-size: 11px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); z-index: 9999;
    display: ${state.debugMode ? 'block' : 'none'};
  `;
  panel.innerHTML = '<div style="font-weight:bold;margin-bottom:8px;">🔍 Debug Log</div><div id="debug-log"></div>';
  document.body.appendChild(panel);
}

function debugLog(message, data = null) {
  if (!state.debugMode) return;
  console.log(`[DEBUG] ${message}`, data || '');
  const logEl = $('debug-log');
  if (logEl) {
    const entry = document.createElement('div');
    entry.style.cssText = 'margin:4px 0;padding:4px;background:rgba(255,255,255,0.05);border-radius:4px;';
    entry.innerHTML = `
      <div style="color:#60a5fa;">${new Date().toTimeString().slice(0,8)}</div>
      <div>${message}</div>
      ${data ? `<div style="color:#94a3b8;margin-left:10px;">${JSON.stringify(data, null, 2)}</div>` : ''}
    `;
    logEl.insertBefore(entry, logEl.firstChild);
    while (logEl.children.length > 10) logEl.removeChild(logEl.lastChild);
  }
}

// ---- Helpers ----
function showStatus(msg, showProg = false) {
  if (!statusEl || !progressWrapper) return;
  statusEl.textContent = msg || '';
  progressWrapper.style.display = msg ? 'block' : 'none';
  if (progressBar) progressBar.style.display = showProg ? 'block' : 'none';
  debugLog(`Status: ${msg}`);
}

function enableRunButtons(enabled) {
  if (extractBtn) extractBtn.disabled = !enabled;
}

function resetViews() {
  if (projectListContainer) projectListContainer.style.display = 'none';
  if (spotlightContainer) spotlightContainer.style.display = 'none';
  showStatus('');
}

// Upload file merging (de-dupe by name/size/mtime)
function mergeSelectedFiles(newFiles) {
  const key = f => `${f.name}__${f.size}__${f.lastModified}`;
  const mergedMap = new Map((state.files || []).map(f => [key(f), f]));
  newFiles.forEach(f => mergedMap.set(key(f), f));
  state.files = Array.from(mergedMap.values());

  const names = state.files.map(f => f.name).join(', ');
  uploadBtn.textContent = state.files.length === 1
    ? `Selected: ${state.files[0].name}`
    : `Selected: ${state.files.length} files`;

  let list = document.getElementById('uploaded-files');
  if (!list) {
    list = document.createElement('div');
    list.id = 'uploaded-files';
    list.style.cssText = 'margin-top:8px;color:#475569;font-size:12px;';
    uploadBtn.parentNode.appendChild(list);
  }
  list.textContent = names;

  Toastify({ text: `Selected: ${names}`, style: { background: '#3b82f6' } }).showToast();
  enableRunButtons(true);
  resetViews();
  debugLog('Files selected', { count: state.files.length, names });
}

// ---- Sample Data Loading ----
async function loadSampleData() {
  try {
    const response = await fetch('./sample-data.json');
    if (!response.ok) {
      console.warn('Sample data not found, skipping…');
      return;
    }
    const sampleJson = await response.json();

    // Direct hydrate (preserve titles)
    state.allThreads = (sampleJson.conversations || []).map((c, i) => {
      const norm = d => (d ? new Date(d) : null);
      return {
        ...c,
        id: c.id || `sample_${i + 1}`,
        title: (c.title && c.title.trim()) ? c.title.trim() : `Conversation ${i + 1}`,
        created_at: norm(c.created_at),
        updated_at: norm(c.updated_at),
        messages: (c.messages || []).map(m => ({ ...m, created_at: norm(m.created_at) }))
      };
    });
    state.uploadHash = 'sample-json';

    initSearch(state.allThreads);

    // Sample mode with your 4 curated filters (2 phrases)
    state.sampleMode = true;
    const sampleFilters = [
      'marketing strategy',
      'SQL',
      'interview',
      'follow-up email'
    ];
    setFilters(sampleFilters);
    state.sampleDefaultFiltersCount = sampleFilters.length;
    state._prevFilterCount = sampleFilters.length;
    state._sampleExtraLimit = 0;

    // Show search UI
    const searchSection = document.getElementById('search-section');
    if (searchSection) searchSection.style.display = 'block';

    // Charts once (static for sample mode)
    dashboardMounted = false; // ensure mount
    showGlobalStats();

    showSampleDataBanner();
    renderFilterChips();
    runAndRenderSearch();

    console.log('✅ Sample data loaded:', state.allThreads.length, 'conversations');
    mixpanel.track('Sample Data Loaded', { conversation_count: state.allThreads.length });
  } catch (err) {
    console.error('Failed to load sample data:', err);
  }
}

function showSampleDataBanner() {
  let banner = document.getElementById('sample-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'sample-banner';
    banner.style.cssText = `
      background:#fef3c7;border:1px solid #fcd34d;color:#92400e;
      padding:12px 16px;margin:16px 0;border-radius:8px;text-align:center;
      font-weight:500;box-shadow:var(--shadow-sm);
    `;
    banner.textContent = '📊 Viewing sample data — Upload your files to replace this with your own analytics and conversations.';
    const header = document.querySelector('header');
    (header?.parentNode || document.body).insertBefore(banner, header?.nextSibling || null);
  }
}

// ---- Show Global Stats (insert AFTER the Extract buttons row) ----
function showGlobalStats() {
  let statsContainer = $('global-stats-container');
  if (!statsContainer) {
    statsContainer = document.createElement('div');
    statsContainer.id = 'global-stats-container';
    statsContainer.className = 'container';
  }

  const analyzeFieldset = extractBtn?.closest('fieldset');
  if (analyzeFieldset) {
    const firstRow = analyzeFieldset.querySelector('.row');
    if (firstRow) {
      if (firstRow.nextSibling !== statsContainer) {
        firstRow.parentNode.insertBefore(statsContainer, firstRow.nextSibling);
      }
    } else {
      analyzeFieldset.appendChild(statsContainer);
    }
  } else {
    document.body.appendChild(statsContainer);
  }

  // Mount once per dataset; do not re-render on search/filter
  if (!dashboardMounted) {
    initDashboard({
      threads: state.allThreads,
      container: statsContainer,
      title: `📊 Your Complete GenAI Analytics (${state.allThreads.length} conversations)`,
      statsOverride: state.sampleMode ? DEMO_STATS : null,
      sampleMode: state.sampleMode === true
    });
    dashboardMounted = true;
  } else {
    const h2 = statsContainer.querySelector('h2');
    if (h2) h2.textContent = `📊 Your Complete GenAI Analytics (${state.allThreads.length} conversations)`;
  }
}

// ---- Optional Project List (kept but hidden/disabled) ----
function renderProjectListHidden() {
  if (projectListContainer) {
    projectListContainer.style.display = 'none';
  }
}

// ---- Main Extract Handler ----
async function handleExtract() {
  const banner = document.getElementById('sample-banner');
  if (banner) banner.remove();

  if (!state.files || state.files.length === 0) {
    Toastify({ text: 'Please select file(s) first.', style: { background: '#b91c1c' } }).showToast();
    return;
  }

  enableRunButtons(false);
  showStatus('Reading and parsing files…', true);
  createDebugPanel();

  try {
    // Real data mode
    state.sampleMode = false;
    clearFilters();

    // Parse multiple files, merging progressively
    state.allThreads = [];
    let parseResult = null;

    for (let i = 0; i < state.files.length; i++) {
      const file = state.files[i];
      showStatus(`Processing file ${i + 1}/${state.files.length}: ${file.name}…`, true);
      debugLog(`Processing file ${i + 1}`, { fileName: file.name, fileSize: file.size });
      parseResult = await parseExport(file, state.allThreads);
      state.allThreads = parseResult.conversations;
      state.uploadHash = parseResult.hash;
    }

    // Initialize search with parsed conversations
    initSearch(state.allThreads);

    // Show search section if we have data
    const searchSection = document.getElementById('search-section');
    if (searchSection && state.allThreads.length > 0) {
      searchSection.style.display = 'block';
    }

    // Charts: mount once for the newly uploaded dataset
    dashboardMounted = false;
    showGlobalStats();

    showStatus(`Parsed ${state.allThreads.length} conversations.`);

    mixpanel.track('File Uploaded', {
      file_count: state.files.length,
      conversation_count: state.allThreads.length
    });

    renderProjectListHidden();
    spotlightContainer.style.display = 'none';

    // Render initial conversations (no filters → show all)
    renderFilterChips();
    runAndRenderSearch();
    
    enableRunButtons(true);
    showStatus('');
  } catch (error) {
    console.error('Extract error:', error);
    Toastify({
      text: `Error: ${error.message}`,
      style: { background: '#b91c1c' },
      duration: 5000
    }).showToast();
    showStatus('Error during extraction');
    enableRunButtons(true);
  }
}

function escapeHTML(s){ return String(s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

// ---- Search UI helpers (filters-as-chips and results rendering) ----
function ensureFiltersBar() {
  let bar = document.getElementById('active-filters');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'active-filters';
    bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0 0;';
    const searchRow = document.querySelector('#search-section .row');
    if (searchRow) searchRow.parentNode.insertBefore(bar, searchRow.nextSibling);
  }
  return bar;
}

function renderFilterChips() {
  const bar = ensureFiltersBar();
  const filters = getFilters();
  if (!filters.length) {
    bar.innerHTML = '<span style="color:#94a3b8;font-size:12px;">No filters added yet.</span>';
    return;
  }
  bar.innerHTML = filters.map(f => `
    <span style="display:inline-flex;align-items:center;gap:6px;background:#e2e8f0;border-radius:16px;padding:4px 10px;font-size:12px;">
      <span>"${escapeHTML(f)}"</span>
      <button class="chip-x" data-filter="${encodeURIComponent(f)}" style="border:none;background:transparent;cursor:pointer;">✕</button>
    </span>
  `).join('');
  bar.querySelectorAll('.chip-x').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = decodeURIComponent(btn.getAttribute('data-filter'));
      removeFilter(v);
      renderFilterChips();
      runAndRenderSearch();
    });
  });
}

// Virtualized results config/state
const VIRT_CHUNK = 100;
let virtRendered = 0;
let virtResultsCache = [];

// Results renderer
function renderResults(results) {
  const resultsList = document.getElementById('results-list');
  const searchResultsEl = document.getElementById('search-results');
  const resultCount = document.getElementById('result-count');
  if (!resultsList || !searchResultsEl) return;

  virtResultsCache = results.slice();
  virtRendered = 0;

  function renderNextChunk() {
    const slice = virtResultsCache.slice(virtRendered, virtRendered + VIRT_CHUNK);
    const html = slice.map(conv => {
      const snippet = getSnippet(conv); // uses active filters internally
      const showSnippet = snippet && snippet.trim() && snippet.trim() !== conv.title.trim();
      return `
        <div class="search-result">
          <label style="display:flex; align-items:start; gap:0.5rem; cursor:pointer;">
            <input type="checkbox" data-conv-id="${conv.id}" style="margin-top:4px;">
            <div style="flex:1;">
              <h4 style="margin:0 0 0.25rem 0; color:#1e40af;">${escapeHTML(conv.title)}</h4>
              ${showSnippet ? `<div style="color:#64748b; font-size:0.875rem; line-height:1.4;">${snippet}</div>` : ''}
              <div style="color:#94a3b8; font-size:0.75rem; margin-top:0.5rem;">
                ${new Date(conv.created_at).toLocaleDateString()} • ${conv.messages.length} messages
              </div>
            </div>
          </label>
        </div>
      `;
    }).join('');

    if (virtRendered === 0) {
      resultsList.innerHTML = html || '<p style="color:#64748b;text-align:center;padding:2rem;">No results found. Try different keywords.</p>';
    } else {
      const frag = document.createElement('div');
      frag.innerHTML = html;
      while (frag.firstChild) resultsList.appendChild(frag.firstChild);
    }
    virtRendered += slice.length;

    // wire checkbox only once at first render
    if (virtRendered === slice.length) {
      resultsList.addEventListener('change', (e) => {
        if (e.target.type === 'checkbox') {
          toggleSelection(e.target.dataset.convId);
          updateExportButtons();
        }
      });
    }

    // wire titles for the newly added chunk
    resultsList.querySelectorAll('h4').forEach(h => {
      if (!h.__wired) {
        h.__wired = true;
        h.style.cursor = 'pointer';
        h.addEventListener('click', () => {
          const card = h.closest('.search-result');
          const id = card?.querySelector('input[type="checkbox"]')?.dataset?.convId;
          if (!id) return;
          const conv = state.allThreads.find(c => c.id === id);
          if (conv) openModalWithConversation(conv);
        });
      }
    });
  }

  // initial
  resultsList.innerHTML = '';
  resultCount.textContent = `${results.length} results`;
  searchResultsEl.style.display = 'block';
  renderNextChunk();

  // lazy-load on scroll
  resultsList.onscroll = () => {
    if (resultsList.scrollTop + resultsList.clientHeight + 40 >= resultsList.scrollHeight) {
      if (virtRendered < virtResultsCache.length) renderNextChunk();
    }
  };
}

// Search + render (charts remain static; no re-init here)
function runAndRenderSearch() {
  const dateFilter = document.getElementById('dateFilter');
  const filters = getFilters();

  // AND across all active filters (consistent behavior)
  const results = runSearch(filters, dateFilter ? dateFilter.value : 'all');

  clearSelections();
  renderResults(results);
  updateExportButtons();
}

function updateExportButtons() {
  const checkedCount = document.querySelectorAll('#results-list input[type="checkbox"]:checked').length;
  const exportJson = document.getElementById('exportJsonBtn');
  const exportHtml = document.getElementById('exportHtmlBtn');
  const exportCsv = document.getElementById('exportCsvBtn');
  if (exportJson) exportJson.disabled = checkedCount === 0;
  if (exportHtml) exportHtml.disabled = checkedCount === 0;
  if (exportCsv) exportCsv.disabled = checkedCount === 0;
}

// ---- Modal (full conversation) ----
function ensureModal() {
  if ($('conv-modal')) return $('conv-modal');
  const overlay = document.createElement('div');
  overlay.id = 'conv-modal';
  overlay.style.cssText = `
    position:fixed; inset:0; background:rgba(15,23,42,.55);
    display:none; align-items:center; justify-content:center; z-index:10000;
  `;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-hidden', 'true');

  overlay.innerHTML = `
    <div id="conv-modal-card" style="
      width:min(900px,92vw); max-height:85vh; overflow:auto; background:#fff;
      border-radius:12px; box-shadow:0 20px 60px rgba(0,0,0,.35); padding:16px 18px;
    " tabindex="-1">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;">
        <h3 id="conv-modal-title" style="margin:0;font-size:18px;color:#0f172a;"></h3>
        <button id="conv-modal-close" class="btn-secondary">Close</button>
      </div>
      <div id="conv-modal-body" style="font-size:14px;color:#0f172a;"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target.id === 'conv-modal') closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
  $('conv-modal-close').addEventListener('click', closeModal);
  return overlay;
}
function openModalWithConversation(conv) {
  const modal = ensureModal();
  const titleEl = document.getElementById('conv-modal-title');
  const bodyEl  = document.getElementById('conv-modal-body');
  const closeBtn = document.getElementById('conv-modal-close');

  titleEl.textContent = conv.title || 'Conversation';
  bodyEl.innerHTML = (conv.messages || []).map(m => {
    const roleLabel = m.role === 'user' ? 'You' : 'Assistant';
    return `
      <div style="margin:.5rem 0;padding:.5rem;border-left:3px solid ${m.role==='user'?'#2563eb':'#10b981'};background:${m.role==='user'?'#eff6ff':'#f0fdf4'}">
        <div style="font-weight:600;color:#64748b">${roleLabel}</div>
        <div>${highlightText(m.text || '')}</div>
      </div>
    `;
  }).join('');
  modal.style.display = 'flex';

  modal.removeAttribute('aria-hidden');
  document.querySelectorAll('body > *:not(#conv-modal)').forEach(el => {
    try { el.inert = true; } catch {}
  });
  setTimeout(() => closeBtn?.focus(), 0);
}
function closeModal() {
  const modal = $('conv-modal');
  if (!modal) return;
  modal.style.display = 'none';
  modal.setAttribute('aria-hidden', 'true');
  document.querySelectorAll('body > *').forEach(el => {
    try { el.inert = false; } catch {}
  });
  document.getElementById('searchInput')?.focus();
}

// ---- Event Wiring ----
function wire() {
  if (uploadBtn) {
    uploadBtn.addEventListener('click', () => {
      if (fileInput) fileInput.click();
    });
  }

  if (fileInput) {
    fileInput.setAttribute('multiple', 'multiple');
    fileInput.addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) {
        mergeSelectedFiles(files);
      }
    });
  }

  document.addEventListener('dragover', (e) => { e.preventDefault(); });
  document.addEventListener('drop', (e) => {
    if (!e.dataTransfer) return;
    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) return;
    e.preventDefault();
    const accepted = files.filter(f => /\.zip$/i.test(f.name) || /\.json$/i.test(f.name));
    if (!accepted.length) {
      Toastify({ text: 'Drop .zip or .json files only', style: { background: '#b91c1c' } }).showToast();
      return;
    }
    mergeSelectedFiles(accepted);
  });

  if (extractBtn) extractBtn.addEventListener('click', handleExtract);

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
      state.debugMode = !state.debugMode;
      const panel = $('debug-panel');
      if (panel) {
        panel.style.display = state.debugMode ? 'block' : 'none';
      } else if (state.debugMode) {
        createDebugPanel();
      }
      console.log('Debug mode:', state.debugMode);
    }
  });

  // ---- Search functionality (filters workflow) ----
  const searchBtn = document.getElementById('searchBtn');
  const searchInput = document.getElementById('searchInput');
  const dateFilter = document.getElementById('dateFilter');

  if (searchBtn && searchInput) {
    searchBtn.addEventListener('click', () => {
      const q = searchInput.value.trim();
      if (!q) {
        Toastify({ text: 'Please type a word or "quoted phrase", then click Search to add it as a filter.', style: { background: '#f59e0b' } }).showToast();
        return;
      }
      addFilter(q);
      searchInput.value = '';
      renderFilterChips();
      runAndRenderSearch();
    });
  }

  if (searchInput) {
    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        searchBtn?.click();
      }
    });
  }

  if (dateFilter) {
    dateFilter.addEventListener('change', runAndRenderSearch);
  }

  document.getElementById('selectAllBtn')?.addEventListener('click', () => {
    document.querySelectorAll('#results-list input[type="checkbox"]').forEach(cb => {
      cb.checked = true;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });

  document.getElementById('clearBtn')?.addEventListener('click', async () => {
    clearSelections();
    document.querySelectorAll('#results-list input[type="checkbox"]').forEach(cb => { cb.checked = false; });
    updateExportButtons();
  });

  // Exports
  document.getElementById('exportJsonBtn')?.addEventListener('click', () => {
    const checkedIds = Array.from(document.querySelectorAll('#results-list input[type="checkbox"]:checked'))
      .map(cb => cb.dataset.convId);

    setSelections(checkedIds);
    const json = exportAsJSON();
    if (!json) {
      Toastify({ text: 'Select at least one conversation to export', style: { background: '#f59e0b' } }).showToast();
      return;
    }
    downloadFile('\uFEFF' + json, getDefaultFilename('json', 'Claude-GPT-merge'), 'application/json;charset=utf-8');
    Toastify({ text: 'JSON exported successfully', style: { background: '#10b981' } }).showToast();
    mixpanel.track('Data Exported', { format: 'JSON', count: checkedIds.length });
  });

  document.getElementById('exportHtmlBtn')?.addEventListener('click', () => {
    const checkedIds = Array.from(document.querySelectorAll('#results-list input[type="checkbox"]:checked'))
      .map(cb => cb.dataset.convId);

    setSelections(checkedIds);
    const html = exportAsHTML();
    if (!html) {
      Toastify({ text: 'Select at least one conversation to export', style: { background: '#f59e0b' } }).showToast();
      return;
    }
    downloadFile(html, getDefaultFilename('html', 'Claude-GPT-merge'), 'text/html;charset=utf-8');
    Toastify({ text: 'HTML exported successfully', style: { background: '#10b981' } }).showToast();
    mixpanel.track('Data Exported', { format: 'HTML', count: checkedIds.length });
  });

  document.getElementById('exportCsvBtn')?.addEventListener('click', () => {
    const checkedIds = Array.from(document.querySelectorAll('#results-list input[type="checkbox"]:checked'))
      .map(cb => cb.dataset.convId);

    setSelections(checkedIds);
    const csv = exportAsCSV();
    if (!csv) {
      Toastify({ text: 'Select at least one conversation to export', style: { background: '#f59e0b' } }).showToast();
      return;
    }
    downloadFile(csv, getDefaultFilename('csv', 'Claude-GPT-merge'), 'text/csv;charset=utf-8');
    Toastify({ text: 'CSV exported successfully', style: { background: '#10b981' } }).showToast();
    mixpanel.track('Data Exported', { format: 'CSV', count: checkedIds.length });
  });

  renderFilterChips();
}

// ---- App Startup ----
async function initializeApp() {
  await loadSampleData();
  wire();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}
