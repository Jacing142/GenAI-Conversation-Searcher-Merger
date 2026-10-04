# GenAI Conversation Searcher & Merger

Search, filter and merge your ChatGPT and Claude conversation history. Runs in your browser.

**[Open the tool](https://gen-ai-conversation-searcher-merger.vercel.app)**

<img width="593" height="767" alt="The tool showing sample data, filters and search results" src="https://github.com/user-attachments/assets/87a1721a-5bd7-4718-93bb-7839814e5721" />

## What it does

- Loads ChatGPT and Claude data exports (ZIP or conversations.json)
- Merges several exports, including from different accounts, and removes duplicates
- Searches titles and messages. Stack several keywords or phrases; all must match
- Filters by date (last 30, 90 or 365 days)
- Exports selected conversations as HTML, JSON or CSV
- Shows simple charts: activity over time, peak hour, conversation length, your messages vs AI replies

## Why it exists

Auto-generated titles make old conversations hard to find, and built-in search in ChatGPT and Claude is limited. If you use more than one assistant or account, your history is split across them. This tool puts it in one place.

## Privacy

- Your exports are read and processed in your browser. Conversation content, titles and file names are never sent anywhere.
- The site uses Mixpanel for anonymous usage analytics: page views and counts (files loaded, conversations loaded, export format and count). Mixpanel also records standard browser details and an approximate location (country and city) derived from your IP address.
- Libraries and fonts load from cdnjs and Google Fonts.

## How to use

1. Request a data export from ChatGPT and/or Claude settings:

<img width="475" height="297" alt="Where to find the data export option" src="https://github.com/user-attachments/assets/5ccedff1-5d93-426e-8f8a-3bd35807b313" />

<img width="461" height="410" alt="Where to find the data export option" src="https://github.com/user-attachments/assets/6eee07f9-1cb3-4bbf-bd84-e1626ef5185c" />

2. Open the tool and upload or drag in the ZIP files (or the conversations.json inside them).
3. Click Extract, then search, select and export.

## Tech

Static site, plain JavaScript, no build step and no backend. Parsing, search and charts run client-side. JSZip reads ZIP files, Chart.js draws charts, Toastify shows notifications. Hosted on Vercel.

## Licence

MIT. See [LICENSE](LICENSE).
