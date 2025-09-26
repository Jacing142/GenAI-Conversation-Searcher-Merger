// app.js – Full file (includes: DnD, modal viewer, better filenames, virtualization, legacy button hide, no price pill)

import { parseExport, detectQAConversations } from './parser.js';
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
  getDefaultFilename
} from './search.js';

const $ = (id) => document.getElementById(id);

// ---- State ----
const state = {
  files: [],
  allThreads: [],
  filteredThreads: [],
  clusters: [],
  unclustered: [],
  estimatedPrice: 5,
  debugMode: false,
  qa: [],
  currentClusterName: null,
  currentClusterThreads: [],
  uploadHash: null
};

// ---- DOM Elements ----
const fileInput = $('fileInput');
const uploadBtn = $('uploadBtn');
const extractBtn = $('extractBtn');
const processBtn = $('processBtn');
const pdfBtn = $('pdfBtn');
const copyBtn = $('copyBtn');

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

function enableRunButtons(enabled, keepOutputs = false) {
  if (extractBtn) extractBtn.disabled = !enabled;
  if (processBtn) processBtn.disabled = !enabled;
  if (!keepOutputs) {
    if (pdfBtn) pdfBtn.disabled = true;
    if (copyBtn) copyBtn.disabled = true;
  }
}

function resetViews() {
  if (projectListContainer) projectListContainer.style.display = 'none';
  if (spotlightContainer) spotlightContainer.style.display = 'none';
  showStatus('');
}

function ensureReportActions() {
  let bar = document.getElementById('report-actions');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'report-actions';
    bar.style.cssText = 'margin:12px 0 0 0; display:flex; gap:8px; flex-wrap:wrap;';
    const host = document.getElementById('spotlight-container');
    (host?.parentNode || document.body).insertBefore(bar, host?.nextSibling || null);
  }
  return bar;
}

// Hide legacy Analyze buttons (keep functions alive; just hide the UI)
function hideLegacyReportUI() {
  processBtn?.style && (processBtn.style.display = 'none');
  pdfBtn?.style && (pdfBtn.style.display = 'none');
  copyBtn?.style && (copyBtn.style.display = 'none');
  const pricePill = $('price-pill');
  if (pricePill) pricePill.remove();
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
  enableRunButtons(true, false);
  resetViews();
  debugLog('Files selected', { count: state.files.length, names });
}

// ---- Show Global Stats (place AFTER the buttons row so Extract stays above charts) ----
function showGlobalStats() {
  let statsContainer = $('global-stats-container');
  if (!statsContainer) {
    statsContainer = document.createElement('div');
    statsContainer.id = 'global-stats-container';
    statsContainer.className = 'container';
  }

  // Insert right AFTER the first .row in Analyze fieldset (the buttons row)
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

  initDashboard({
    threads: state.allThreads,
    container: statsContainer,
    title: `📊 Your Complete GenAI Analytics (${state.allThreads.length} conversations)`
  });
}

// ---- Q&A Section (hidden for now, keep data only) ----
function renderHiddenQAStore(_qaItems) { return; }

// ---- Optional Project List (kept but hidden/disabled) ----
function renderProjectListHidden() {
  if (projectListContainer) {
    projectListContainer.style.display = 'none'; // explicitly hide per current product scope
  }
}

// ---- Main Extract Handler ----
async function handleExtract() {
  if (!state.files || state.files.length === 0) {
    Toastify({ text: 'Please select file(s) first.', style: { background: '#b91c1c' } }).showToast();
    return;
  }

  enableRunButtons(false);
  showStatus('Reading and parsing files…', true);
  createDebugPanel();

  try {
    // Parse multiple files, merging progressively
    state.allThreads = [];
    let parseResult = null;

    for (let i = 0; i < state.files.length; i++) {
      const file = state.files[i];
      showStatus(`Processing file ${i + 1}/${state.files.length}: ${file.name}…`, true);
      debugLog(`Processing file ${i + 1}`, { fileName: file.name, fileSize: file.size });
      parseResult = await parseExport(file, state.allThreads); // parser merges with existing + dedupe
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

    // Show global stats (after buttons)
    showGlobalStats();

    // Q&A (internal only)
    const { qa } = detectQAConversations(state.allThreads);
    state.qa = qa.map(q => ({
      index: state.allThreads.findIndex(t => t.id === q.id),
      question: q.question,
      title: q.title
    }));
    renderHiddenQAStore(state.qa);

    state.estimatedPrice = Math.max(5, Math.round(state.allThreads.length * 0.002 * 100));
    showStatus(`Parsed ${state.allThreads.length} conversations.`);

    // Track successful file upload
    mixpanel.track('File Uploaded', { 
      file_count: state.files.length,
      conversation_count: state.allThreads.length 
    });

    // Hide/disable projects UI for now
    renderProjectListHidden();
    spotlightContainer.style.display = 'none';

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

/* ===========================================================
   PTR helpers (unchanged parts kept)
   =========================================================== */

async function loadScriptOnce(src) {
  if (document.querySelector(`script[src="${src}"]`)) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}
function take(n, arr) { return arr.slice(0, n); }
function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }
function hasDigits(s){ return /\d/.test(s); }
function scoreMessage(msg, threadTitle, maxDate) {
  const t = (msg.text || '').toLowerCase();
  let s = 0;
  if (/\b(decide|decided|decision|approved|ship|shipped|launch|launched|implement(ed)?|fixed|refactor|migrate|buy)\b/.test(t)) s += 6;
  if (/\b(next|todo|to-do|plan|roadmap|assign(ed)?|due|deadline|milestone)\b/.test(t)) s += 5;
  if (/\b(pivot|change(d)?|revert|rollback|mistake|issue|bug|postmortem)\b/.test(t)) s += 5;
  if (hasDigits(t)) s += 3;

  const len = (msg.text || '').length;
  s += clamp(100 - Math.abs(len - 180)/5, 0, 10)/10;

  const title = (threadTitle || '').toLowerCase();
  if (title) {
    const overlap = title.split(/\W+/).filter(w => w.length>3 && t.includes(w)).length;
    s += Math.min(3, overlap);
  }

  const when = msg.created_at ? new Date(msg.created_at) : null;
  if (when && maxDate) {
    const days = (maxDate - when) / (1000*60*60*24);
    if (days <= 7) s += 2; else if (days <= 30) s += 1;
  }
  if (msg.role === 'assistant') s += 0.5;
  return s;
}
function tokenize2(s){
  return String(s||'').toLowerCase().split(/[^a-z0-9]+/).filter(w => w && w.length >= 3);
}
function topTokensFromThreads_PTR(threads, limit=30){
  const stop = new Set(['the','and','for','you','with','this','that','are','was','have','has','but','not','your','from','into','our','about','will','can','just','like']);
  const freq = new Map();
  threads.forEach(t=>{
    tokenize2(t.title).forEach(w => { if(!stop.has(w)) freq.set(w,(freq.get(w)||0)+2); });
    (t.messages||[]).forEach(m=>{
      tokenize2(m.text).forEach(w => { if(!stop.has(w)) freq.set(w,(freq.get(w)||0)+1); });
    });
  });
  return [...freq.entries()].sort((a,b)=>b[1]-a[1]).slice(0,limit).map(([w])=>w);
}
function buildProjectKeywords(projectName, threads){
  const nameTokens = tokenize2(projectName||'');
  const bodyTokens = topTokensFromThreads_PTR(threads, 30);
  return [...new Set([...nameTokens, ...bodyTokens])];
}
function selectTopKEvidence(threads, K, keywords){
  K = Math.max(1, K|0);
  let maxDate = new Date(0);
  threads.forEach(t => (t.messages || []).forEach(m => {
    const d = m.created_at ? new Date(m.created_at) : null;
    if (d && d.getTime() && d > maxDate) maxDate = d;
  }));

  const lines = [];
  threads.forEach((t, ti) => {
    (t.messages || []).forEach((m, mi) => {
      const txt = (m.text || '').toLowerCase();
      let s = scoreMessage(m, t.title, maxDate);
      const overlap = keywords.filter(k => k.length >= 3 && txt.includes(k)).length;
      if (overlap >= 2) s += 4;
      else if (overlap === 1) s += 2;
      if (s > 1) {
        lines.push({
          ref: `t:${ti}#m:${mi}`,
          threadIndex: ti, messageIndex: mi,
          date: m.created_at || null,
          role: m.role, text: m.text || '',
          score: s
        });
      }
    });
  });

  lines.sort((a,b) => b.score - a.score);
  return lines.slice(0, K);
}
function normDate(d) {
  if (!d) return '';
  if (d instanceof Date) {
    const t = d.getTime();
    return Number.isFinite(t) ? d.toISOString() : '';
  }
  const parsed = new Date(d);
  const t = parsed.getTime();
  return Number.isFinite(t) ? parsed.toISOString() : '';
}
function fmtYYYYMM(isoLike) {
  if (!isoLike) return '';
  const s = (isoLike instanceof Date) ? isoLike.toISOString() : String(isoLike);
  return s.length >= 7 ? s.slice(0,7) : '';
}
function fmtYYYYMMDD(isoLike) {
  if (!isoLike) return '';
  const s = (isoLike instanceof Date) ? isoLike.toISOString() : String(isoLike);
  return s.length >= 10 ? s.slice(0,10) : '';
}
function escapeHTML(s){ return String(s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function buildPTRSkeleton(projectName, threads, evidence) {
  let earliest = new Date(8640000000000000), latest = new Date(0);
  threads.forEach(t => (t.messages || []).forEach(m => {
    const d = m.created_at ? new Date(m.created_at) : null;
    if (!d || !Number.isFinite(d.getTime())) return;
    if (d < earliest) earliest = d;
    if (d > latest)  latest  = d;
  }));
  if (!Number.isFinite(latest.getTime()) || latest.getTime() === 0) {
    const now = new Date(); earliest = now; latest = now;
  }

  const pickBy = (regex) => evidence.filter(e => regex.test((e.text || '').toLowerCase()));
  const decisions = pickBy(/\b(decide|decided|approved|chose|selected)\b/);
  const dones     = pickBy(/\b(ship|shipped|launch|launched|fixed|completed|done|implemented)\b/);
  const nexts     = pickBy(/\b(next|todo|to-do|plan|assign|due|deadline)\b/);
  const pivots    = pickBy(/\b(pivot|change|revert|rollback|switch)\b/);
  const blockers  = pickBy(/\b(blocker|stuck|blocked|issue|bug|risk)\b/);

  const asItems = (arr, mapFn) => take(Math.max(1, Math.min(10, arr.length)), arr).map(mapFn);

  const ptr = {
    project: {
      name: projectName || 'Selected Project',
      chat_count: threads.length,
      date_range: { start: normDate(earliest), end: normDate(latest) }
    },
    summary: [],
    timeline: [],
    done: asItems(dones, d => ({ item: d.text.slice(0,240), date: normDate(d.date), owner: 'You', evidence: [d.ref] })),
    next:  asItems(nexts,  d => ({ item: d.text.slice(0,240), priority: 'high', owner: 'You', due: '', evidence: [d.ref] })),
    decisions: asItems(decisions, d => ({ date: normDate(d.date), decision: d.text.slice(0,240), rationale: '', evidence: [d.ref] })),
    pivots: asItems(pivots, d => ({ date: normDate(d.date), what_changed: d.text.slice(0,240), why: '', evidence: [d.ref] })),
    blockers: asItems(blockers, d => ({ item: d.text.slice(0,240), evidence: [d.ref] })),
    meta: { generated_at: new Date().toISOString(), mode: 'heuristic' }
  };

  const titleTerms = (projectName || '').toLowerCase().split(/\W+/).filter(w=>w.length>3);
  const head = take(12, evidence).map(e => e.text).filter(Boolean);
  const seeds = [...new Set([...titleTerms, ...head])].slice(0, 8);
  ptr.summary = seeds.map(s => ({ text: (''+s).slice(0,200), evidence: [] })).slice(0, clamp(seeds.length, 5, 8));

  const bucket = {};
  evidence.forEach(e => {
    const d = e.date ? new Date(e.date) : null;
    if (!d) return;
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    bucket[key] = bucket[key] || { count:0, samples:[] };
    bucket[key].count += 1;
    if (bucket[key].samples.length < 2) bucket[key].samples.push(e);
  });
  const months = Object.entries(bucket).sort((a,b)=>a[0].localeCompare(b[0]));
  ptr.timeline = months.map(([ym, obj]) => ({
    date: ym + '-01',
    title: obj.count >= 15 ? 'Major activity' : obj.count >= 5 ? 'Milestone' : 'Update',
    detail: (obj.samples[0]?.text || '').slice(0,160),
    evidence: obj.samples.map(s=>s.ref)
  }));

  const ensure = (key, fallbackText) => {
    if (ptr[key].length === 0 && evidence.length) {
      ptr[key] = [{ item: fallbackText, evidence: [evidence[0].ref] }];
    }
  };
  ensure('done', 'Progress recorded (details in chats).');
  ensure('next', 'Define next tangible steps for the upcoming week.');
  ensure('blockers', 'No explicit blockers detected; confirm assumptions.');

  return ptr;
}
function ptrToMarkdown(ptr){
  const h = (s)=>`## ${s}\n`;
  const li = (t)=>`- ${t}\n`;
  let md = `# Project Trajectory Report — ${ptr.project.name}\n\n`;
  md += `**Chats:** ${ptr.project.chat_count}  \n`;
  md += `**Range:** ${ptr.project.date_range.start.slice(0,10)} → ${ptr.project.date_range.end.slice(0,10)}\n\n`;
  md += h('Executive Summary');
  ptr.summary.forEach(b=> md += li(b.text));
  md += '\n' + h('Timeline');
  ptr.timeline.forEach(x=> md += li(`${fmtYYYYMM(x.date)} — ${x.title}: ${x.detail}`));
  md += '\n' + h('What\'s Done');
  ptr.done.forEach(x=> md += li(`${x.item}${fmtYYYYMMDD(x.date) ? ` (${fmtYYYYMMDD(x.date)})` : ''}`));
  md += '\n' + h('What\'s Next');
  ptr.next.forEach(x=> md += li(`${x.item} [${x.priority}]`));
  md += '\n' + h('Key Decisions');
  ptr.decisions.forEach(x=> md += li(`${fmtYYYYMMDD(x.date) ? fmtYYYYMMDD(x.date) + ' — ' : ''}${x.decision}`));
  md += '\n' + h('Pivots / Mistakes');
  ptr.pivots.forEach(x=> md += li(`${fmtYYYYMMDD(x.date) ? fmtYYYYMMDD(x.date) + ' — ' : ''}${x.what_changed}`));
  md += '\n' + h('Open Questions / Blockers');
  ptr.blockers.forEach(x=> md += li(x.item));
  return md;
}
async function copyText(str){
  try {
    await navigator.clipboard.writeText(str);
    Toastify({ text: 'Markdown copied', style: { background: '#10b981' }, duration: 1500 }).showToast();
  } catch {
    alert('Copy failed. You can manually copy from the preview.');
  }
}
async function ptrToPdfCanvas(ptr){
  await loadScriptOnce('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js');
  await loadScriptOnce('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js');
  const { jsPDF } = window.jspdf;

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed; left:-99999px; top:-99999px; width:800px; background:#fff; z-index:-1;';
  host.innerHTML = (function ptrToHTML(ptr){
    const css = `
      <style>
        .ptr-root{ width:800px; font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,"Noto Sans",Arial; color:#0f172a; }
        .ptr-section{ background:#fff; padding:20px 24px; border:1px solid #e5e7eb; border-radius:12px; margin:12px 0; }
        .ptr-h1{ font-size:22px; font-weight:700; margin:0 0 6px; }
        .ptr-meta{ color:#475569; margin-bottom:4px; }
        .ptr-h2{ font-size:16px; font-weight:700; margin:0 0 8px; }
        .ptr-ul{ margin:0; padding-left:18px; }
        .ptr-li{ margin:3px 0; }
        .ptr-table{ width:100%; border-collapse:collapse; }
        .ptr-table th,.ptr-table td{ border:1px solid #e5e7eb; padding:6px 8px; text-align:left; vertical-align:top; }
        .ptr-kicker{ color:#334155; font-weight:600; width:110px; }
      </style>
    `;
    const bullets = (arr, pick) => `<ul class="ptr-ul">${arr.map(x=>`<li class="ptr-li">${escapeHTML(pick(x))}</li>`).join('')}</ul>`;
    const summary = `<div class="ptr-section"><div class="ptr-h2">Executive Summary</div>${bullets(ptr.summary, x=>x.text)}</div>`;
    const timeline = `<div class="ptr-section"><div class="ptr-h2">Timeline</div>${bullets(ptr.timeline, t=>`${fmtYYYYMM(t.date)} — ${t.title}: ${t.detail}`)}</div>`;
    const done = `<div class="ptr-section"><div class="ptr-h2">What's Done</div>${bullets(ptr.done, d=>`${d.item}${fmtYYYYMMDD(d.date) ? ` (${fmtYYYYMMDD(d.date)})` : ''}`)}</div>`;
    const next = `<div class="ptr-section"><div class="ptr-h2">What's Next</div><table class="ptr-table"><thead><tr><th class="ptr-kicker">Priority</th><th>Item</th><th>Owner</th></tr></thead><tbody>${ptr.next.map(n=>`<tr><td>${escapeHTML(n.priority||'')}</td><td>${escapeHTML(n.item||'')}</td><td>${escapeHTML(n.owner||'You')}</td></tr>`).join('')}</tbody></table></div>`;
    const decisions = `<div class="ptr-section"><div class="ptr-h2">Key Decisions</div><table class="ptr-table"><thead><tr><th class="ptr-kicker">Date</th><th>Decision</th></tr></thead><tbody>${ptr.decisions.map(d=>`<tr><td>${fmtYYYYMMDD(d.date)||''}</td><td>${escapeHTML(d.decision||'')}</td></tr>`).join('')}</tbody></table></div>`;
    const pivots = `<div class="ptr-section"><div class="ptr-h2">Pivots / Mistakes</div>${bullets(ptr.pivots, p=>`${fmtYYYYMMDD(p.date) ? fmtYYYYMMDD(p.date)+' — ' : ''}${p.what_changed}`)}</div>`;
    const blockers = `<div class="ptr-section"><div class="ptr-h2">Open Questions / Blockers</div>${bullets(ptr.blockers, b=>b.item)}</div>`;
    const cover = `<div class="ptr-section"><div class="ptr-h1">Project Trajectory Report — ${escapeHTML(ptr.project.name)}</div><div class="ptr-meta">Chats: ${ptr.project.chat_count}</div><div class="ptr-meta">Range: ${fmtYYYYMMDD(ptr.project.date_range.start)} → ${fmtYYYYMMDD(ptr.project.date_range.end)}</div></div>`;
    return css + `<div class="ptr-root">${cover}${summary}${timeline}${done}${next}${decisions}${pivots}${blockers}</div>`;
  })(ptr);
  document.body.appendChild(host);

  const pdf = new jsPDF({ unit:'pt', format:'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 36;
  const maxW = pageW - margin*2;
  const maxH = pageH - margin*2;

  const blocks = host.querySelectorAll('.ptr-section');
  let first = true;
  for (const el of blocks) {
    const canvas = await html2canvas(el, { scale: 2, backgroundColor:'#ffffff' });
    let imgW = maxW;
    let imgH = canvas.height * (imgW / canvas.width);
    if (imgH > maxH) {
      imgH = maxH;
      imgW = canvas.width * (imgH / canvas.height);
      if (imgW > maxW) { imgW = maxW; imgH = canvas.height * (imgW / canvas.width); }
    }
    const imgData = canvas.toDataURL('image/png');
    if (!first) pdf.addPage();
    first = false;
    pdf.addImage(imgData, 'PNG', (pageW - imgW)/2, (pageH - imgH)/2, imgW, imgH, undefined, 'FAST');
  }

  document.body.removeChild(host);
  pdf.save(`PTR_${(ptr.project.name||'project').replace(/\s+/g,'_')}.pdf`);
}

async function handleProcessReport() {
  if (!state.allThreads.length) {
    Toastify({ text: 'Please extract data first', style: { background: '#f59e0b' } }).showToast();
    return;
  }
  if (!state.currentClusterThreads || state.currentClusterThreads.length === 0) {
    Toastify({ text: 'Select a project first (click a project chip).', style: { background: '#f59e0b' } }).showToast();
    return;
  }

  try {
    enableRunButtons(false);
    showStatus('Collecting evidence…', true);
    createDebugPanel();

    const keywords = buildProjectKeywords(state.currentClusterName, state.currentClusterThreads);
    const evidence = selectTopKEvidence(state.currentClusterThreads, 250, keywords);

    showStatus('Building sections…', true);
    const ptr = buildPTRSkeleton(state.currentClusterName, state.currentClusterThreads, evidence);

    showStatus('Rendering report…', true);
    let md = '';
    md = (function ptrToMarkdownInner(p){ return ptrToMarkdown(p); })(ptr);

    if (copyBtn) { copyBtn.disabled = false; copyBtn.onclick = () => copyText(md); }
    if (pdfBtn)  { pdfBtn.disabled  = false; pdfBtn.onclick  = ()=> ptrToPdfCanvas(ptr); }

    const bar = ensureReportActions();
    bar.innerHTML = '';
    const copyLocal = document.createElement('button');
    copyLocal.className = 'btn-secondary';
    copyLocal.textContent = 'Copy for Notion';
    copyLocal.onclick = () => copyText(md);
    bar.appendChild(copyLocal);

    const dl = document.createElement('a');
    const blob = new Blob([md], { type: 'text/markdown' });
    dl.href = URL.createObjectURL(blob);
    dl.download = `PTR_${(state.currentClusterName || 'project').replace(/\s+/g,'_')}.md`;
    dl.textContent = 'Download .md';
    dl.className = 'btn-secondary';
    dl.style.padding = '6px 12px';
    bar.appendChild(dl);

    const pdfLocal = document.createElement('button');
    pdfLocal.className = 'btn-secondary';
    pdfLocal.textContent = 'Download PDF';
    pdfLocal.onclick = () => ptrToPdfCanvas(ptr);
    bar.appendChild(pdfLocal);

    Toastify({ text: 'PTR ready — use Copy / Download.', style: { background:'#10b981' }, duration: 3000 }).showToast();
    showStatus('');
  } catch (err) {
    console.error(err);
    Toastify({ text: `Error generating PTR: ${err.message||err}`, style: { background:'#b91c1c' }, duration: 6000 }).showToast();
    showStatus('Error generating PTR');
  } finally {
    enableRunButtons(true, true);
  }
}

// ---- Search UI helpers (filters-as-chips and results rendering) ----
function ensureUploadListUI(files) {
  let list = document.getElementById('uploaded-files-list');
  if (!list) {
    list = document.createElement('div');
    list.id = 'uploaded-files-list';
    list.style.cssText = 'margin-top:8px;color:#475569;font-size:12px;';
    uploadBtn.parentNode.appendChild(list);
  }
  list.innerHTML = files.map(f => `<div>📄 ${f.name}</div>`).join('');
}

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
      <span>"${f}"</span>
      <button class="chip-x" data-filter="${encodeURIComponent(f)}" style="border:none;background:transparent;cursor:pointer;">✕</button>
    </span>
  `).join('');
  bar.querySelectorAll('.chip-x').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = decodeURIComponent(btn.getAttribute('data-filter'));
      removeFilter(v);
      renderFilterChips();
      runAndRenderSearch(); // refresh list
    });
  });
}

// Virtualized results config/state
const VIRT_CHUNK = 100;
let virtRendered = 0;
let virtResultsCache = [];

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
              <h4 style="margin:0 0 0.25rem 0; color:#1e40af;">${conv.title}</h4>
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

function runAndRenderSearch() {
  const dateFilter = document.getElementById('dateFilter');
  const filters = getFilters();
  const results = runSearch(filters, dateFilter ? dateFilter.value : 'all');
  clearSelections(); // reset selections each new search
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

  // make the dialog visible to assistive tech
  modal.removeAttribute('aria-hidden');

  // optional: prevent interaction with everything behind the modal
  document.querySelectorAll('body > *:not(#conv-modal)').forEach(el => {
    try { el.inert = true; } catch {}
  });

  // focus management to avoid aria-hidden warnings
  setTimeout(() => closeBtn?.focus(), 0);
}
function closeModal() {
  const modal = $('conv-modal');
  if (!modal) return;

  // hide visually
  modal.style.display = 'none';

  // hide from assistive tech while closed
  modal.setAttribute('aria-hidden', 'true');

  // re-enable background interactivity
  document.querySelectorAll('body > *').forEach(el => {
    try { el.inert = false; } catch {}
  });

  // return focus to search input for good UX
  document.getElementById('searchInput')?.focus();
}

// ---- Event Wiring ----
function wire() {
  // Hide legacy report buttons (UI only)
  hideLegacyReportUI();

  // Upload button opens file dialog
  if (uploadBtn) {
    uploadBtn.addEventListener('click', () => {
      if (fileInput) fileInput.click();
    });
  }

  // File input handler — show file names clearly (separate label area so buttons don't move)
  if (fileInput) {
    fileInput.setAttribute('multiple', 'multiple');
    fileInput.addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) {
        mergeSelectedFiles(files);
      }
    });
  }

  // Drag & Drop over document
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

  // Main buttons
  if (extractBtn) extractBtn.addEventListener('click', handleExtract);
  if (processBtn) processBtn.addEventListener('click', handleProcessReport);

  // Debug panel toggle (Ctrl+Shift+D)
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

  // Add filter on click
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

  // Add filter on Enter
  if (searchInput) {
    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        searchBtn?.click();
      }
    });
  }

  // Re-run search when date changes
  if (dateFilter) {
    dateFilter.addEventListener('change', runAndRenderSearch);
  }

  // Select all / clear selections
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

  // Export handlers (use readable default filenames)
  document.getElementById('exportJsonBtn')?.addEventListener('click', () => {
    const checkedIds = Array.from(document.querySelectorAll('#results-list input[type="checkbox"]:checked'))
      .map(cb => cb.dataset.convId);

    setSelections(checkedIds); // sync UI → module selection

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

    setSelections(checkedIds); // sync UI → module selection

    const html = exportAsHTML();
    if (!html) {
      Toastify({ text: 'Select at least one conversation to export', style: { background: '#f59e0b' } }).showToast();
      return;
    }
    downloadFile(html, getDefaultFilename('html', 'Claude-GPT-merge'), 'text/html;charset=utf-8');
    Toastify({ text: 'HTML exported successfully', style: { background: '#10b981' } }).showToast();
     mixpanel.track('Data Exported', { format: 'HTML', count: checkedIds.length });
  });

  // NEW: CSV export (make sure you add a button with id="exportCsvBtn" in index.html)
  document.getElementById('exportCsvBtn')?.addEventListener('click', () => {
    const checkedIds = Array.from(document.querySelectorAll('#results-list input[type="checkbox"]:checked'))
      .map(cb => cb.dataset.convId);

    setSelections(checkedIds); // sync UI → module selection

    const csv = exportAsCSV();
    if (!csv) {
      Toastify({ text: 'Select at least one conversation to export', style: { background: '#f59e0b' } }).showToast();
      return;
    }
    // CSV returns with BOM for Excel compatibility
    downloadFile(csv, getDefaultFilename('csv', 'Claude-GPT-merge'), 'text/csv;charset=utf-8');
    Toastify({ text: 'CSV exported successfully', style: { background: '#10b981' } }).showToast();
     mixpanel.track('Data Exported', { format: 'CSV', count: checkedIds.length });
  });

  // Initial filters bar render
  renderFilterChips();
}

// ---- App Startup ----
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wire);
} else {
  wire();
}

// Keep listener for review UI → PTR bridge (kept for future when Projects UI returns)
window.addEventListener('cluster-review:generate', (e) => {
  try {
    const { name, threadIndices } = e.detail || {};
    if (!Array.isArray(threadIndices) || !threadIndices.length) {
      Toastify({ text: 'No conversations selected for report.', style: { background: '#f59e0b' } }).showToast();
      return;
    }
    state.currentClusterName = name || 'Selected Project';
    state.currentClusterThreads = threadIndices.map(i => state.allThreads[i]).filter(Boolean);
    handleProcessReport();
  } catch (err) {
    console.error('PTR trigger error:', err);
    Toastify({ text: `Error: ${err.message || err}`, style: { background: '#b91c1c' } }).showToast();
  }
});
