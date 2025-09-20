// pii.js — lightweight PII scrubber (opt-in)
const EMAIL  = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE  = /\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{4}\b/g;
const URL    = /\bhttps?:\/\/[^\s]+/gi;
const HANDLE = /(^|\s)@[a-z0-9_\.]{2,32}\b/gi;

export function scrubText(s){
  if (!s) return s;
  return s
    .replace(EMAIL,  '[email]')
    .replace(PHONE,  '[phone]')
    .replace(URL,    '[url]')
    .replace(HANDLE, '$1[handle]');
}

export function scrubThread(thread){
  const t = structuredClone(thread);
  if (t.title) t.title = scrubText(t.title);
  t.messages = (t.messages||[]).map(m => ({
    ...m,
    text: scrubText(m.text)
  }));
  return t;
}
