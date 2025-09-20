// search.js - Phrase-aware search, numeric tokens, safe HTML, and full conversation export (JSON/HTML/CSV) + download helper + default filenames

let searchIndex = null;
let allConversations = [];
let searchResults = [];
let selectedConversations = new Set();
let activeFilters = []; // Store active search phrases

// ============ Init / Index ============

export function init(conversations) {
  allConversations = conversations || [];
  searchIndex = buildSearchIndex(allConversations);
  console.log('🔍 Search initialized with', allConversations.length, 'conversations');
}

function buildSearchIndex(conversations) {
  const index = new Map();

  conversations.forEach((conv, idx) => {
    // Title
    tokenize(conv.title).forEach(token => {
      if (!index.has(token)) index.set(token, new Set());
      index.get(token).add(idx);
    });

    // Messages
    (conv.messages || []).forEach(msg => {
      tokenize(msg.text).forEach(token => {
        if (!index.has(token)) index.set(token, new Set());
        index.get(token).add(idx);
      });
    });
  });

  return index;
}

// Keep short tokens if they contain digits (so "42" or "gpt-4" are indexable).
function tokenize(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(token => token && (/\d/.test(token) || token.length > 2));
}

// ============ Query Parsing / Matching ============

export function parseSearchQuery(query) {
  if (!query) return [];
  const phrases = [];
  const regex = /"([^"]+)"|(\S+)/g;
  let match;

  while ((match = regex.exec(query)) !== null) {
    if (match[1]) phrases.push(match[1].toLowerCase());
    else if (match[2]) phrases.push(match[2].toLowerCase());
  }
  return phrases;
}

export function containsPhrase(text, phrase) {
  if (!text || !phrase) return false;
  return String(text).toLowerCase().includes(String(phrase).toLowerCase());
}

// ============ Search core ============

export function search(filtersOrQuery = activeFilters, dateFilter = 'all') {
  if (!searchIndex) return [];

  let filters = [];
  if (Array.isArray(filtersOrQuery)) {
    filters = filtersOrQuery.filter(Boolean).map(s => String(s).toLowerCase());
  } else if (typeof filtersOrQuery === 'string') {
    filters = parseSearchQuery(filtersOrQuery);
  }

  if (filters.length === 0) {
    searchResults = [];
    return searchResults;
  }

  const now = new Date();
  const results = [];

  allConversations.forEach((conv) => {
    // Date filter
    if (dateFilter !== 'all') {
      const convDate = conv.created_at instanceof Date ? conv.created_at : new Date(conv.created_at);
      const daysDiff = (now - convDate) / (24 * 60 * 60 * 1000);
      if (dateFilter === '30' && daysDiff > 30) return;
      if (dateFilter === '90' && daysDiff > 90) return;
      if (dateFilter === '365' && daysDiff > 365) return;
    }

    // Must match ALL filters
    let matchesAll = true;
    let score = 0;

    for (const filter of filters) {
      let foundInConv = false;

      // Title
      if (containsPhrase(conv.title, filter)) {
        foundInConv = true;
        score += 3;
      }

      // Messages
      if (!foundInConv) {
        for (const msg of (conv.messages || [])) {
          if (containsPhrase(msg.text, filter)) {
            foundInConv = true;
            score += 1;
            break;
          }
        }
      }

      if (!foundInConv) {
        matchesAll = false;
        break;
      }
    }

    if (matchesAll) {
      results.push({ conv, score });
    }
  });

  results.sort((a, b) => b.score - a.score);
  searchResults = results.map(r => r.conv);
  return searchResults;
}

// ============ Filters (for UI pill management) ============

export function addFilter(phrase) {
  const p = (phrase || '').trim();
  if (!p) return false;
  if (!activeFilters.includes(p)) {
    activeFilters.push(p);
    return true;
  }
  return false;
}

export function removeFilter(phrase) {
  const idx = activeFilters.indexOf(phrase);
  if (idx > -1) {
    activeFilters.splice(idx, 1);
    return true;
  }
  return false;
}

export function clearFilters() {
  activeFilters = [];
}

export function getFilters() {
  return activeFilters.slice();
}

// ============ Selection helpers ============

export function toggleSelection(conversationId) {
  if (selectedConversations.has(conversationId)) {
    selectedConversations.delete(conversationId);
  } else {
    selectedConversations.add(conversationId);
  }
  return selectedConversations.has(conversationId);
}

export function clearSelections() {
  selectedConversations.clear();
}

export function getSelectedConversations() {
  return Array.from(selectedConversations).map(id => {
    return allConversations.find(c => c.id === id);
  }).filter(Boolean);
}

export function getConversationById(id) {
  return allConversations.find(c => c.id === id) || null;
}

// Force-set the current selection from a list of conversation IDs (used by app.js before export)
export function setSelections(ids = []) {
  selectedConversations = new Set((ids || []).filter(Boolean));
}

// Optional: quick introspection for debugging
export function getSelectionCount() {
  return selectedConversations.size;
}

// ============ Snippets / Highlighting (safe) ============

function escapeHTML(s) {
  return String(s || '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

// Returns a safe HTML snippet with <mark> highlighting, or '' if no match.
// NOTE: second argument may be (incorrectly) passed as a query string by caller;
// we ignore non-numeric values and use default length.
export function getSnippet(conversation, maybeMaxLen = 200) {
  const maxLength = (typeof maybeMaxLen === 'number' && isFinite(maybeMaxLen)) ? maybeMaxLen : 200;

  for (const msg of (conversation.messages || [])) {
    for (const filter of activeFilters) {
      if (containsPhrase(msg.text, filter)) {
        const raw = String(msg.text || '');
        const idx = raw.toLowerCase().indexOf(filter.toLowerCase());
        if (idx !== -1) {
          const start = Math.max(0, idx - 50);
          const end = Math.min(raw.length, idx + maxLength);
          let snippet = raw.slice(start, end);

          if (start > 0) snippet = '...' + snippet;
          if (end < raw.length) snippet = snippet + '...';

          // Escape first to avoid executing/embedding HTML/URLs from the message
          snippet = escapeHTML(snippet);

          // Then highlight
          activeFilters.forEach(f => {
            const regex = new RegExp(`(${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
            snippet = snippet.replace(regex, '<mark>$1</mark>');
          });

          return snippet;
        }
      }
    }
  }
  return '';
}

// Highlight text for exports (safe)
export function highlightText(text) {
  if (!text) return '';
  let highlighted = escapeHTML(String(text));
  activeFilters.forEach(filter => {
    const escaped = filter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    highlighted = highlighted.replace(regex, '<mark>$1</mark>');
  });
  return highlighted;
}

// ============ Filename helpers ============

function yyyymmdd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// best-effort: assume merged sources; caller can override base if needed
export function getDefaultFilename(ext = 'json', base = 'Claude-GPT-merge') {
  return `${base}-${yyyymmdd()}.${ext}`;
}

// ============ Exports ============

export function exportAsJSON() {
  const selected = getSelectedConversations();
  if (selected.length === 0) return null;

  const exportData = {
    export_date: new Date().toISOString(),
    conversation_count: selected.length,
    search_filters: activeFilters,
    conversations: selected
  };

  return JSON.stringify(exportData, null, 2);
}

export function exportAsHTML() {
  const selected = getSelectedConversations();
  if (selected.length === 0) return null;

  const filterText = escapeHTML(activeFilters.join(', '));

  let html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Conversation Export: ${filterText}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 900px; margin: 0 auto; padding: 2rem; }
    h1 { color: #2563eb; border-bottom: 2px solid #e5e7eb; padding-bottom: 0.5rem; }
    h2 { color: #1e40af; margin-top: 2rem; }
    .conversation { border: 1px solid #e5e7eb; border-radius: 8px; padding: 1rem; margin: 1rem 0; page-break-inside: avoid; }
    .message { margin: 0.5rem 0; padding: 0.5rem; border-left: 3px solid #ddd; }
    .user { border-left-color: #2563eb; background: #eff6ff; }
    .assistant { border-left-color: #10b981; background: #f0fdf4; }
    .role { font-weight: bold; color: #64748b; }
    mark { background: #fef3c7; padding: 2px 4px; border-radius: 2px; }
    .meta { color: #64748b; font-size: 0.875rem; }
    .filters { background: #f3f4f6; padding: 0.5rem; border-radius: 4px; margin-bottom: 1rem; }
  </style>
</head>
<body>
  <h1>Conversation Export</h1>
  <div class="filters">Search filters: ${filterText || 'None'}</div>
  <p class="meta">Exported ${selected.length} conversations • ${escapeHTML(new Date().toLocaleString())}</p>
`;

  selected.forEach(conv => {
    html += `
  <div class="conversation">
    <h2>${highlightText(conv.title)}</h2>
    <p class="meta">Created: ${escapeHTML(new Date(conv.created_at).toLocaleString())}</p>
`;
    (conv.messages || []).forEach((msg, mi) => {
      const roleClass = msg.role === 'user' ? 'user' : 'assistant';
      const roleLabel = msg.role === 'user' ? 'You' : 'Assistant';
      html += `
    <div class="message ${roleClass}">
      <div class="role">${escapeHTML(roleLabel)} • #${mi + 1}</div>
      <div>${highlightText(msg.text)}</div>
    </div>
`;
    });
    html += `  </div>\n`;
  });

  html += `
</body>
</html>`;

  return html;
}

// ---- CSV Export (full conversations, one row per message) ----
// Columns: conversation_id,conversation_title,created_at,message_index,role,text
export function exportAsCSV() {
  const selected = getSelectedConversations();
  if (selected.length === 0) return null;

  const header = [
    'conversation_id',
    'conversation_title',
    'created_at',
    'message_index',
    'role',
    'text'
  ];

  const escapeCSV = (val) => {
    let s = String(val ?? '');
    // Excel/Sheets formula-injection guard
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    // normalize newlines
    s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    // Escape quotes + wrap always
    s = s.replace(/"/g, '""');
    return `"${s}"`;
  };

  const rows = [header.map(escapeCSV).join(',')];

  selected.forEach(conv => {
    const convTitle = conv.title || 'Untitled';
    const created = (conv.created_at ? new Date(conv.created_at) : new Date()).toISOString();
    (conv.messages || []).forEach((m, mi) => {
      rows.push([
        escapeCSV(conv.id),
        escapeCSV(convTitle),
        escapeCSV(created),
        escapeCSV(mi + 1),
        escapeCSV(m.role || ''),
        escapeCSV(m.text || '')
      ].join(','));
    });
  });

  // Prepend BOM for Excel compatibility
  return '\uFEFF' + rows.join('\n');
}

// More robust (works in Firefox/Safari), revokes URL after click
export function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}

// ============ Accessors ============

export function getResults() {
  return searchResults.slice();
}
