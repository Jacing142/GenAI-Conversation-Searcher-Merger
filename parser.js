// parser.js – Enhanced with Claude support and multi-file handling (broadened detection & parsing)

// === File Loading (unchanged) ===
export async function loadExport(file) {
  console.log('📁 Loading file:', file.name, 'Size:', file.size);

  const name = (file.name || '').toLowerCase();

  if (name.endsWith('.zip')) {
    console.log('📦 Processing ZIP file...');
    const zip = await JSZip.loadAsync(file);
    const files = Object.keys(zip.files);
    console.log('📦 ZIP contents:', files);

    const entry = zip.file(/conversations\.json$/i)[0];
    if (!entry) {
      console.error('❌ No conversations.json found. Files in ZIP:', files);
      throw new Error('conversations.json not found in zip. Files found: ' + files.join(', '));
    }

    const content = await entry.async('string');
    console.log('📦 Extracted conversations.json, size:', content.length);
    return JSON.parse(content);
  }

  console.log('📄 Processing JSON file directly...');
  const text = await file.text();
  console.log('📄 File content length:', text.length);
  return JSON.parse(text);
}

// === Date Parser ===
function toDate(x) {
  if (!x) return new Date(0);
  if (x instanceof Date) return x;

  // Unix timestamp in seconds (ChatGPT typical format)
  if (typeof x === 'number') {
    if (x > 946684800 && x < 4102444800) {
      return new Date(x * 1000);
    }
    return new Date(x);
  }

  if (typeof x === 'string') {
    const parsed = new Date(x);
    if (!isNaN(parsed.getTime())) return parsed;
  }

  return new Date(0);
}

// === Generate Hash for Caching (Browser-compatible) ===
async function generateHash(data) {
  const str = JSON.stringify(data);

  // Use Web Crypto API if available (modern browsers)
  if (window.crypto && window.crypto.subtle) {
    try {
      const encoder = new TextEncoder();
      const dataBuffer = encoder.encode(str);
      const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      return hashHex.substring(0, 16);
    } catch (err) {
      console.warn('Web Crypto API failed, using fallback:', err);
    }
  }

  // Fallback: Simple hash function for older browsers
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(16, '0').substring(0, 16);
}


// === Extract Clean Message Text ===
function extractMessageText(content) {
  if (!content) return '';

  // Handle different content structures
  if (typeof content === 'string') {
    return content;
  }

  // ChatGPT often uses content.parts array
  if (content.parts && Array.isArray(content.parts)) {
    return content.parts
      .filter(part => typeof part === 'string')
      .join('\n')
      .trim();
  }

  // Claude & others: array of blocks { type: 'text', text: '...' }
  if (Array.isArray(content)) {
    return content
      .filter(item => (item && typeof item === 'object' && item.type === 'text' && item.text))
      .map(item => item.text)
      .join('\n')
      .trim();
  }

  // Sometimes content.text
  if (content.text) {
    return content.text;
  }

  // Fallback
  return JSON.stringify(content);
}

// === Detect Export Type (broadened) ===
function detectExportType(data) {
  // Helper checks
  const looksLikeChatGPTItem = (item) => !!(item && (item.mapping || item.messages));
  const looksLikeClaudeItem = (item) => {
    if (!item || typeof item !== 'object') return false;
    // Claude signals: chat_messages array OR messages array with {sender|role} in human/assistant/user/assistant
    if (Array.isArray(item.chat_messages)) return true;
    if (Array.isArray(item.messages)) {
      const anyMsg = item.messages.find(m => m && (m.sender || m.role));
      if (!anyMsg) return false;
      const r = (anyMsg.sender || anyMsg.role || '').toString().toLowerCase();
      return r === 'human' || r === 'assistant' || r === 'user';
    }
    return false;
  };

  // 1) Classic Claude object { version, conversations:[...] }
  if (data && typeof data === 'object' && Array.isArray(data.conversations)) {
    const any = data.conversations.find(c => looksLikeClaudeItem(c));
    if (any) return 'claude';
    const anyGpt = data.conversations.find(c => looksLikeChatGPTItem(c));
    if (anyGpt) return 'chatgpt';
  }

  // 2) Top-level array (common for both)
  if (Array.isArray(data)) {
    if (data.some(looksLikeClaudeItem)) return 'claude';
    if (data.some(looksLikeChatGPTItem)) return 'chatgpt';
  }

  // 3) Generic object whose first property is an array
  if (data && typeof data === 'object') {
    const keys = Object.keys(data);
    if (keys.length) {
      const first = data[keys[0]];
      if (Array.isArray(first)) {
        if (first.some(looksLikeClaudeItem)) return 'claude';
        if (first.some(looksLikeChatGPTItem)) return 'chatgpt';
      }
    }
  }

  return 'unknown';
}

// === Filter Claude Conversation (now supports chat_messages OR messages) ===
function filterClaudeConversation(rawConvo, index) {
  try {
    const filtered = {
      id: `conv_${index}`,
      title: rawConvo.name || `Conversation ${index + 1}`,
      created_at: toDate(rawConvo.created_at),
      updated_at: null, // Match ChatGPT format
      messages: []
    };

    const pushMsg = (roleIn, textIn, createdAtIn) => {
      const role = (roleIn === 'human') ? 'user' :
                   (roleIn === 'claude' || roleIn === 'assistant') ? 'assistant' :
                   roleIn; // if already 'user'/'assistant'
      if (role !== 'user' && role !== 'assistant') return;
      const txt = (textIn || '').trim();
      if (!txt) return;
      filtered.messages.push({
        role,
        text: txt,
        created_at: toDate(createdAtIn || filtered.created_at)
      });
    };

    // Case A: Claude exports with chat_messages[]
    if (Array.isArray(rawConvo.chat_messages)) {
      rawConvo.chat_messages.forEach(msg => {
        // Prefer msg.text; else flatten msg.content (array of blocks)
        let text = msg.text || '';
        if (!text && Array.isArray(msg.content)) {
          text = msg.content
            .filter(c => c && c.type === 'text' && c.text)
            .map(c => c.text)
            .join('\n');
        }
        pushMsg(msg.sender, text, msg.created_at);
      });
    }

    // Case B: Claude exports with messages[] (role/user|assistant, content blocks)
    else if (Array.isArray(rawConvo.messages)) {
      rawConvo.messages.forEach(m => {
        // role: 'user'|'assistant' or 'human'|'assistant'
        const role = (m.role || m.sender || '').toLowerCase();
        // content might be string or array of {type:'text', text:'...'} or {text:'...'}
        let text = '';
        if (typeof m.content === 'string') {
          text = m.content;
        } else if (Array.isArray(m.content)) {
          text = m.content
            .map(part => {
              if (!part) return '';
              if (typeof part === 'string') return part;
              if (part.text) return part.text;
              if (part.type === 'text' && part.text) return part.text;
              return '';
            })
            .filter(Boolean)
            .join('\n');
        } else if (m.text) {
          text = m.text;
        }
        pushMsg(role, text, m.created_at || m.timestamp);
      });
    }

    // Set updated_at to last message time
    if (filtered.messages.length > 0) {
      filtered.messages.sort((a, b) => a.created_at - b.created_at);
      filtered.updated_at = filtered.messages[filtered.messages.length - 1].created_at;
    } else {
      filtered.updated_at = filtered.created_at;
    }

    // Calculate stats
    filtered.stats = {
      message_count: filtered.messages.length,
      user_message_count: filtered.messages.filter(m => m.role === 'user').length,
      assistant_message_count: filtered.messages.filter(m => m.role === 'assistant').length,
      total_words: filtered.messages.reduce((sum, m) =>
        sum + (m.text || '').split(/\s+/).filter(Boolean).length, 0
      ),
      duration_minutes: Math.round(
        (filtered.updated_at - filtered.created_at) / (1000 * 60)
      )
    };

    return filtered;
  } catch (err) {
    console.error(`❌ Error filtering Claude conversation ${index}:`, err);
    return null;
  }
}

// === Filter ChatGPT Conversation (existing) ===
function filterChatGPTConversation(rawConvo, index) {
  try {
    // Extract essential fields only
    const filtered = {
      id: `conv_${index}`,
      title: rawConvo.title || `Conversation ${index + 1}`,
      created_at: toDate(rawConvo.create_time || rawConvo.created_at || rawConvo.timestamp),
      updated_at: null,
      messages: []
    };

    // Process messages from mapping structure (most common)
    if (rawConvo.mapping) {
      const messages = [];

      Object.values(rawConvo.mapping).forEach(node => {
        // Skip non-message nodes
        if (!node?.message?.author?.role || !node.message.content) return;

        const role = node.message.author.role;

        // Only keep user and assistant messages
        if (role !== 'user' && role !== 'assistant') return;

        const text = extractMessageText(node.message.content);

        // Skip empty messages
        if (!text || text.trim().length === 0) return;

        messages.push({
          role: role,
          text: text.trim(),
          created_at: toDate(node.message.create_time || filtered.created_at)
        });
      });

      // Sort by timestamp
      messages.sort((a, b) => a.created_at.getTime() - b.created_at.getTime());

      // Deduplicate rapid retries (same role within 30 seconds)
      const deduped = [];
      messages.forEach(msg => {
        const last = deduped[deduped.length - 1];
        if (last &&
            last.role === msg.role &&
            (msg.created_at - last.created_at) < 30000) {
          // Keep the newer message (likely the final version)
          deduped[deduped.length - 1] = msg;
        } else {
          deduped.push(msg);
        }
      });

      filtered.messages = deduped;
    }
    // Alternative structure: direct messages array
    else if (rawConvo.messages && Array.isArray(rawConvo.messages)) {
      rawConvo.messages.forEach(m => {
        if (m.role && (m.content || m.text)) {
          const text = extractMessageText(m.content ?? m.text);
          if (text) {
            filtered.messages.push({
              role: m.role,
              text: text.trim(),
              created_at: toDate(m.created_at || m.timestamp || filtered.created_at)
            });
          }
        }
      });
    }

    // Set updated_at to last message time
    if (filtered.messages.length > 0) {
      filtered.updated_at = filtered.messages[filtered.messages.length - 1].created_at;
    } else {
      filtered.updated_at = filtered.created_at;
    }

    // Calculate stats
    filtered.stats = {
      message_count: filtered.messages.length,
      user_message_count: filtered.messages.filter(m => m.role === 'user').length,
      assistant_message_count: filtered.messages.filter(m => m.role === 'assistant').length,
      total_words: filtered.messages.reduce((sum, m) =>
        sum + (m.text || '').split(/\s+/).filter(Boolean).length, 0
      ),
      duration_minutes: Math.round(
        (filtered.updated_at - filtered.created_at) / (1000 * 60)
      )
    };

    return filtered;

  } catch (err) {
    console.error(`❌ Error filtering ChatGPT conversation ${index}:`, err);
    return null;
  }
}

// === Main Parse Function with Multi-Source Support ===
export async function parseExport(file, existingConversations = []) {
  try {
    console.group('🚀 Starting parseExport for:', file.name);

    // Load raw data
    const raw = await loadExport(file);

    // Detect export type
    const exportType = detectExportType(raw);
    console.log(`🔍 Detected export type: ${exportType}`);

    let conversations = [];
    let filterFunction = null;

    if (exportType === 'claude') {
      // Claude export structure: can be object with conversations[], or top-level array
      if (Array.isArray(raw)) {
        conversations = raw;
      } else if (Array.isArray(raw?.conversations)) {
        conversations = raw.conversations;
      } else {
        // fallback: if first property is an array
        const keys = Object.keys(raw || {});
        if (keys.length && Array.isArray(raw[keys[0]])) {
          conversations = raw[keys[0]];
        }
      }
      filterFunction = filterClaudeConversation;
    } else if (exportType === 'chatgpt') {
      // ChatGPT export structure
      if (Array.isArray(raw)) {
        conversations = raw;
      } else if (raw?.conversations && Array.isArray(raw.conversations)) {
        conversations = raw.conversations;
      } else if (raw && typeof raw === 'object') {
        const keys = Object.keys(raw);
        if (keys.length > 0 && raw[keys[0]]?.mapping) {
          conversations = Object.values(raw);
        } else if (keys.length && Array.isArray(raw[keys[0]])) {
          conversations = raw[keys[0]];
        }
      }
      filterFunction = filterChatGPTConversation;
    } else {
      throw new Error('Unknown export format. Please use ChatGPT or Claude exports.');
    }

    console.log(`📊 Found ${conversations.length} raw conversations`);

    // Measure size before filtering
    const rawSize = JSON.stringify(conversations).length;
    console.log(`📦 Raw data size: ${(rawSize / 1024 / 1024).toFixed(2)} MB`);

    // Calculate offset for IDs when merging
    const idOffset = existingConversations.length;

    // Filter conversations
    const filtered = conversations
      .map((conv, idx) => filterFunction(conv, idx + idOffset))
      .filter(Boolean); // Remove nulls

    // Merge with existing conversations
    let allConversations = [...existingConversations, ...filtered];

    // ✅ De-duplicate across merged files
    // Signature uses: title + created_at/updated_at + message_count + first/last message text anchors
    const seen = new Map();
    for (const c of allConversations) {
      const msgLen = (c.messages?.length || 0);
      const firstMsg = msgLen ? (c.messages[0]?.text || '') : '';
      const lastMsg  = msgLen ? (c.messages[msgLen - 1]?.text || '') : '';
      const sig = [
        (c.title || '').toLowerCase(),
        c.created_at?.getTime?.() || '',
        c.updated_at?.getTime?.() || '',
        c.stats?.message_count ?? msgLen,
        firstMsg.slice(0, 64),
        lastMsg.slice(-64)
      ].join('|');

      if (!seen.has(sig)) seen.set(sig, c);
    }
    const beforeCount = allConversations.length;
    allConversations = Array.from(seen.values());
    const duplicatesRemoved = beforeCount - allConversations.length;
    if (duplicatesRemoved > 0) {
      console.log(`🧹 De-duplicated conversations: removed ${duplicatesRemoved} duplicate(s)`);
    }
    
    // Measure size after filtering
    const filteredSize = JSON.stringify(allConversations).length;
    console.log(`✨ Total data size: ${(filteredSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`📉 Size reduction: ${((1 - filteredSize/rawSize) * 100).toFixed(1)}%`);

    // Generate hash for caching
    const dataHash = await generateHash(allConversations);
    console.log('🔑 Data hash:', dataHash);

    // Calculate global stats
    const globalStats = {
      total_conversations: allConversations.length,
      total_messages: allConversations.reduce((sum, c) => sum + c.stats.message_count, 0),
      total_words: allConversations.reduce((sum, c) => sum + c.stats.total_words, 0),
      date_range: {
        earliest: new Date(Math.min(...allConversations.map(c => c.created_at))),
        latest: new Date(Math.max(...allConversations.map(c => c.updated_at)))
      },
      conversations_per_month: {},
      message_length_distribution: {
        'very_short': 0,  // 1-10 words
        'short': 0,       // 11-50 words
        'medium': 0,      // 51-200 words
        'long': 0,        // 201-500 words
        'very_long': 0    // 500+ words
      },
      upload_hash: dataHash,
      sources: {
        chatgpt: allConversations.filter(c => c.id.startsWith('conv_') && idOffset > 0 && parseInt(c.id.split('_')[1]) < idOffset).length,
        claude: filtered.length
      }
    };

    // Calculate monthly distribution
    allConversations.forEach(conv => {
      const monthKey = `${conv.created_at.getFullYear()}-${String(conv.created_at.getMonth() + 1).padStart(2, '0')}`;
      globalStats.conversations_per_month[monthKey] =
        (globalStats.conversations_per_month[monthKey] || 0) + 1;

      // Message length distribution
      conv.messages.forEach(msg => {
        const words = (msg.text || '').split(/\s+/).filter(Boolean).length;
        if (words <= 10) globalStats.message_length_distribution.very_short++;
        else if (words <= 50) globalStats.message_length_distribution.short++;
        else if (words <= 200) globalStats.message_length_distribution.medium++;
        else if (words <= 500) globalStats.message_length_distribution.long++;
        else globalStats.message_length_distribution.very_long++;
      });
    });

    console.log('✅ Parsing complete:', globalStats);
    console.groupEnd();

    return {
      conversations: allConversations,
      stats: globalStats,
      hash: dataHash
    };

  } catch (err) {
    console.groupEnd();
    console.error('💥 parseExport failed:', err);
    throw err;
  }
}

// === Export for Q&A Detection (Free Tier) ===
export function detectQAConversations(conversations) {
  const qa = [];
  const nonQA = [];

  conversations.forEach((conv, index) => {
    // Q&A heuristics (no LLM needed)
    const isQA = (
      conv.stats.message_count <= 6 &&
      conv.stats.duration_minutes < 60 &&
      (
        conv.title.toLowerCase().includes('?') ||
        conv.title.toLowerCase().match(/^(how|what|why|when|where|can|should|is|does)/) ||
        conv.title === 'New conversation' && conv.stats.message_count <= 4
      )
    );

    if (isQA) {
      qa.push({
        id: conv.id,
        title: conv.title,
        question: conv.messages.find(m => m.role === 'user')?.text?.slice(0, 200) || conv.title,
        answer: conv.messages.find(m => m.role === 'assistant')?.text?.slice(0, 300) || 'No answer',
        created_at: conv.created_at
      });
    } else {
      nonQA.push(conv);
    }
  });

  console.log(`📝 Detected ${qa.length} Q&A conversations (free tier)`);

  return { qa, nonQA };
}

// === Minimal export for LLM consumption ===
export function toLLMInput(conversations, perMessageCharLimit = 1200) {
  return conversations.map(c => ({
    id: c.id,
    title: c.title,
    created_at: (c.created_at instanceof Date) ? c.created_at.toISOString() : String(c.created_at || ''),
    messages: (c.messages || []).map(m => ({
      role: m.role,
      text: String(m.text || '').slice(0, perMessageCharLimit)
    }))
  }));
}
