// Visual Tab Switcher — service worker
// Keeps the most-recently-used (MRU) tab order, captures small preview
// thumbnails, and answers the content script.
//
// Performance notes:
//  * The switcher is opened with a tiny message (titles/urls only); it then
//    asks for the previews of the cards it shows, so it appears immediately.
//  * Each preview is stored under its own key ("s:<tabId>"), so a capture
//    writes ~20 KB instead of rewriting the whole cache.
//  * Waking the worker reads only the MRU list and a small preview index.

'use strict';

const SETTINGS_KEY = 'tabSwitcherSettings';
const MRU_KEY = 'mru';
const INDEX_KEY = 'shotIdx';          // { [tabId]: [timestamp, url] }
const SHOT_PREFIX = 's:';
const MAX_SHOTS = 200;     // ~25 KB each → ~5 MB, well inside storage.local's 10 MB
const THUMB_WIDTH = 480;
const CAPTURE_GAP_MS = 550; // Chrome allows at most 2 captureVisibleTab calls per second
const REFRESH_CHOICES = [10, 30, 60]; // Settings → "Refresh previews" (seconds); default 30
const MEM_SHOTS = 60;       // previews kept in memory; the rest are read from storage on demand
const MAX_MRU = 500;

const mem = {
  mru: [],
  index: {},              // tabId -> [ts, url]
  shots: new Map(),       // tabId -> dataUrl (memory cache)
  overlayTabs: new Set(), // tabs currently showing the switcher
  lastShow: new Map(),    // tabId -> when the switcher was last opened there
  bulk: null,             // running "capture all previews" job: { done, total, stop }
  settings: null
};

// ---------------------------------------------------------------------------
// Startup (kept small: this runs every time the worker wakes up)
// ---------------------------------------------------------------------------

const ready = (async () => {
  const [session, local, tabs] = await Promise.all([
    chrome.storage.session.get(MRU_KEY).catch(() => ({})),
    chrome.storage.local.get(INDEX_KEY).catch(() => ({})),
    chrome.tabs.query({}).catch(() => [])
  ]);
  const live = new Set(tabs.map(t => t.id));

  const saved = Array.isArray(session[MRU_KEY]) ? session[MRU_KEY].filter(id => live.has(id)) : [];
  const known = new Set(saved);
  const rest = tabs
    .filter(t => !known.has(t.id))
    .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))
    .map(t => t.id);
  mem.mru = [...saved, ...rest];
  mem.index = local[INDEX_KEY] && typeof local[INDEX_KEY] === 'object' ? local[INDEX_KEY] : {};

  // Tab ids change after a browser restart: re-link previews by URL (in the background).
  const orphans = Object.keys(mem.index).filter(id => !live.has(Number(id)));
  if (orphans.length) relinkOrphans(orphans, tabs);
})();

async function relinkOrphans(orphanIds, tabs) {
  const byUrl = new Map();
  for (const t of tabs) if (t.url && !mem.index[t.id] && !byUrl.has(t.url)) byUrl.set(t.url, t.id);
  const keys = orphanIds.map(id => SHOT_PREFIX + id);
  const data = await chrome.storage.local.get(keys).catch(() => ({}));
  const toSet = {};
  for (const id of orphanIds) {
    const entry = mem.index[id];
    const target = entry && byUrl.get(entry[1]);
    const shot = data[SHOT_PREFIX + id];
    delete mem.index[id];
    if (target !== undefined && shot) {
      byUrl.delete(entry[1]);
      mem.index[target] = entry;
      toSet[SHOT_PREFIX + target] = shot;
    }
  }
  toSet[INDEX_KEY] = mem.index;
  await chrome.storage.local.remove(keys).catch(() => {});
  await chrome.storage.local.set(toSet).catch(() => {});
}

// ---------------------------------------------------------------------------
// Settings (cached in memory)
// ---------------------------------------------------------------------------

async function getSettings() {
  if (mem.settings) return mem.settings;
  try {
    const r = await chrome.storage.sync.get(SETTINGS_KEY);
    mem.settings = r[SETTINGS_KEY] || {};
  } catch (_) {
    mem.settings = {};
  }
  return mem.settings;
}

// Only settings (sync) matter here; we don't need to hear about our own preview writes.
// A preview younger than this is not retaken when you return to a tab or
// window, or press Alt on it (unless the page's address changed).
function refreshMs() {
  if (!mem.settings) getSettings(); // loads in the background; default until then
  const sec = Number(mem.settings && mem.settings.previewRefresh);
  return (REFRESH_CHOICES.includes(sec) ? sec : 30) * 1000;
}

chrome.storage.sync.onChanged.addListener(changes => {
  if (changes[SETTINGS_KEY]) mem.settings = changes[SETTINGS_KEY].newValue || {};
});

function remember(tabId, dataUrl) {
  mem.shots.delete(tabId);
  mem.shots.set(tabId, dataUrl); // newest last
  while (mem.shots.size > MEM_SHOTS) mem.shots.delete(mem.shots.keys().next().value);
}

// ---------------------------------------------------------------------------
// MRU
// ---------------------------------------------------------------------------

let mruTimer = null;

function touch(tabId) {
  const i = mem.mru.indexOf(tabId);
  if (i === 0) return;
  if (i !== -1) mem.mru.splice(i, 1);
  mem.mru.unshift(tabId);
  if (mem.mru.length > MAX_MRU) mem.mru.length = MAX_MRU;
  persistMru();
}

function persistMru() {
  clearTimeout(mruTimer);
  mruTimer = setTimeout(() => chrome.storage.session.set({ [MRU_KEY]: mem.mru }).catch(() => {}), 300);
}

function sortByMru(tabs) {
  const rank = new Map();
  mem.mru.forEach((id, i) => rank.set(id, i));
  return tabs.sort((a, b) => {
    const ra = rank.has(a.id) ? rank.get(a.id) : Infinity;
    const rb = rank.has(b.id) ? rank.get(b.id) : Infinity;
    return ra !== rb ? ra - rb : (b.lastAccessed || 0) - (a.lastAccessed || 0);
  });
}

// ---------------------------------------------------------------------------
// Previews
// ---------------------------------------------------------------------------

const captureTimers = new Map();
let indexTimer = null;

function persistIndex() {
  clearTimeout(indexTimer);
  indexTimer = setTimeout(() => chrome.storage.local.set({ [INDEX_KEY]: mem.index }).catch(() => {}), 500);
}

// Pages the browser never lets an extension capture: don't bother retrying.
function isUncapturable(url = '') {
  return /^(chrome|edge|brave|vivaldi|opera|about|chrome-extension|devtools|view-source|chrome-search):/i.test(url) ||
    /^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com|microsoftedge\.microsoft\.com\/addons)/i.test(url);
}

// Debounced per window: only the tab you settle on gets captured.
function scheduleCapture(windowId, delay, opts = {}) {
  clearTimeout(captureTimers.get(windowId));
  captureTimers.set(windowId, setTimeout(() => {
    captureTimers.delete(windowId);
    capture(windowId, opts);
  }, delay));
}

// All captures go through one queue spaced CAPTURE_GAP_MS apart, so we never
// hit Chrome's 2-per-second limit (which used to silently drop previews).
let captureQueue = Promise.resolve();
let lastCaptureAt = 0;

function capture(windowId, opts = {}) {
  captureQueue = captureQueue.then(() => doCapture(windowId, opts)).catch(() => {});
  return captureQueue;
}

async function doCapture(windowId, { force = false, attempt = 0, onlyTabId = null, ifOlderThan = 0 } = {}) {
  let tab;
  try { [tab] = await chrome.tabs.query({ active: true, windowId }); } catch (_) { return; }
  if (!tab || tab.discarded || mem.overlayTabs.has(tab.id) || isUncapturable(tab.url)) return;
  if (onlyTabId !== null && tab.id !== onlyTabId) return;
  if (ifOlderThan) {
    const entry = mem.index[tab.id];
    if (entry && entry[1] === tab.url && Date.now() - entry[0] < ifOlderThan) return; // still fresh
  }

  // Still loading: try again shortly; after a few tries take what's there.
  if (tab.status !== 'complete' && !force && attempt < 3) {
    scheduleCapture(windowId, 1500, { attempt: attempt + 1 });
    return;
  }

  const win = await chrome.windows.get(windowId).catch(() => null);
  // Minimized or covered windows aren't painted, so their screenshots come out
  // blank: only capture the window you're actually looking at.
  if (!win || win.state === 'minimized' || !win.focused) return;

  const wait = lastCaptureAt + CAPTURE_GAP_MS - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  if (mem.overlayTabs.has(tab.id) || Date.now() - (mem.lastShow.get(tab.id) || 0) < 1500) return; // switcher is up

  let dataUrl;
  const startedAt = Date.now();
  try {
    lastCaptureAt = startedAt;
    dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 70 });
  } catch (_) {
    // Usually a transient failure (window busy, rate limit): retry a couple of times.
    if (attempt < 2) scheduleCapture(windowId, 1000, { force, attempt: attempt + 1 });
    return;
  }
  const finishedAt = Date.now();
  if (!dataUrl) return;

  // You may have switched tabs (or opened the switcher) while capturing:
  // never store a screenshot under the wrong tab.
  const [after] = await chrome.tabs.query({ active: true, windowId }).catch(() => []);
  if (!after || after.id !== tab.id || mem.overlayTabs.has(tab.id)) return;
  // The switcher was asked to open before this capture finished: it might be
  // in the picture. (A capture that finished first — e.g. the one taken when
  // Alt went down — is clean and kept.)
  const shownAt = mem.lastShow.get(tab.id) || 0;
  if (shownAt && shownAt <= finishedAt && finishedAt - shownAt < 1500) return;

  try { dataUrl = await shrink(dataUrl); } catch (_) { /* keep original */ }

  remember(tab.id, dataUrl);
  mem.index[tab.id] = [Date.now(), tab.url || ''];
  const removed = pruneShots();
  chrome.storage.local.set({ [SHOT_PREFIX + tab.id]: dataUrl, [INDEX_KEY]: mem.index }).catch(() => {});
  if (removed.length) chrome.storage.local.remove(removed.map(id => SHOT_PREFIX + id)).catch(() => {});
}

function pruneShots() {
  const ids = Object.keys(mem.index);
  if (ids.length <= MAX_SHOTS) return [];
  ids.sort((a, b) => mem.index[a][0] - mem.index[b][0]);
  const removed = ids.slice(0, ids.length - MAX_SHOTS);
  for (const id of removed) { delete mem.index[id]; mem.shots.delete(Number(id)); }
  return removed;
}

function dropShot(tabId) {
  mem.shots.delete(tabId);
  if (mem.index[tabId]) {
    delete mem.index[tabId];
    persistIndex();
    chrome.storage.local.remove(SHOT_PREFIX + tabId).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// "Capture all previews now"
// ---------------------------------------------------------------------------
// The browser can only screenshot the tab that is on screen, so this briefly
// shows every tab once, captures it, and then puts everything back exactly as
// it was: the same tab in front in every window, the same window focused, the
// same most-recently-used order, and tabs that were unloaded ("discarded") to
// save memory are unloaded again. After that, each preview stays cached until
// you use the tab, and is re-captured every time you do.

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitForLoad(tabId, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (!t) return false;
    if (t.status === 'complete') return true;
    await sleep(200);
  }
  return true; // capture whatever is there
}

function reportBulk() {
  const b = mem.bulk;
  chrome.runtime.sendMessage({ action: 'captureProgress', done: b ? b.done : 0, total: b ? b.total : 0, running: !!b }).catch(() => {});
}

async function captureAllTabs() {
  if (mem.bulk) return;
  await ready;
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
  const focused = windows.find(w => w.focused) || windows[0];
  const restore = windows.map(w => ({ windowId: w.id, tabId: (w.tabs.find(t => t.active) || {}).id }));
  const mruBefore = mem.mru.slice();

  // Every capturable tab, starting with the focused window.
  const ordered = [...windows].sort((a, b) => (b === focused) - (a === focused));
  const todo = [];
  for (const w of ordered) for (const t of w.tabs) if (!isUncapturable(t.url || t.pendingUrl)) todo.push(t);

  const job = { done: 0, total: todo.length, stop: false };
  mem.bulk = job;
  reportBulk();
  const rediscard = [];
  try {
    for (const t of todo) {
      if (job.stop) break;
      const tab = await chrome.tabs.get(t.id).catch(() => null);
      if (tab) {
        if (tab.discarded) rediscard.push(tab.id);
        const win = await chrome.windows.get(tab.windowId).catch(() => null);
        if (win && (!win.focused || win.state === 'minimized')) {
          await chrome.windows.update(tab.windowId, { focused: true, ...(win.state === 'minimized' ? { state: 'normal' } : {}) }).catch(() => {});
        }
        await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
        await waitForLoad(tab.id);
        await sleep(300); // let the page paint
        await capture(tab.windowId, { force: true, onlyTabId: tab.id });
      }
      job.done++;
      reportBulk();
    }
  } finally {
    // Put everything back.
    for (const r of restore) {
      if (r.tabId !== undefined) await chrome.tabs.update(r.tabId, { active: true }).catch(() => {});
    }
    if (focused) await chrome.windows.update(focused.id, { focused: true }).catch(() => {});
    for (const id of rediscard) await chrome.tabs.discard(id).catch(() => {});
    await sleep(300); // let the activation events from restoring arrive (ignored while bulk is set)
    const live = new Set((await chrome.tabs.query({}).catch(() => [])).map(t => t.id));
    const before = new Set(mruBefore);
    // Same recent-tabs order as before; tabs opened meanwhile go first, closed ones are dropped.
    mem.mru = [...mem.mru.filter(id => !before.has(id) && live.has(id)), ...mruBefore.filter(id => live.has(id))];
    persistMru();
    mem.bulk = null;
    reportBulk();
  }
}

async function shrink(dataUrl) {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const scale = Math.min(1, THUMB_WIDTH / bitmap.width);
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.72 });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return 'data:image/jpeg;base64,' + btoa(bin);
}

async function getShots(tabIds) {
  const out = {};
  const missing = [];
  for (const id of tabIds) {
    if (mem.shots.has(id)) out[id] = mem.shots.get(id);
    else if (mem.index[id]) missing.push(id);
  }
  if (missing.length) {
    const data = await chrome.storage.local.get(missing.map(id => SHOT_PREFIX + id)).catch(() => ({}));
    for (const id of missing) {
      const d = data[SHOT_PREFIX + id];
      if (d) { remember(id, d); out[id] = d; }
    }
  }
  return out;
}


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isInternalPage(url = '') {
  return /^(chrome|brave|edge|vivaldi|opera|helium|about|chrome-extension|devtools|view-source):/i.test(url);
}

// Most recently used tabs from every normal browser window. Incognito and
// regular tabs are never mixed. Each tab gets its window's number (1, 2, …)
// so the switcher can show which window it lives in.
async function buildTabList(currentTab) {
  const currentTabId = currentTab ? currentTab.id : null;
  const [settings, tabs, windows] = await Promise.all([
    getSettings(),
    chrome.tabs.query({}),
    chrome.windows.getAll({ windowTypes: ['normal'] }).catch(() => [])
  ]);
  const incognito = currentTab ? !!currentTab.incognito : false;
  const windowNo = new Map(
    windows.filter(w => !!w.incognito === incognito).sort((a, b) => a.id - b.id).map((w, i) => [w.id, i + 1])
  );
  if (currentTab && !windowNo.has(currentTab.windowId)) windowNo.set(currentTab.windowId, windowNo.size + 1);

  let list = sortByMru(tabs.filter(t => windowNo.has(t.windowId) && !!t.incognito === incognito));
  const ci = list.findIndex(t => t.id === currentTabId);
  if (ci > 0) list.unshift(list.splice(ci, 1)[0]);
  if (settings.hideInternalPages) {
    list = list.filter(t => t.id === currentTabId || !isInternalPage(t.url || t.pendingUrl));
  }
  const max = parseInt(settings.maxTabs, 10);
  if (max > 0) list = list.slice(0, max);
  return list.map(t => ({
    id: t.id,
    windowId: t.windowId,
    win: windowNo.get(t.windowId),
    title: t.title || '',
    url: t.url || t.pendingUrl || '',
    favIconUrl: t.favIconUrl || '',
    pinned: t.pinned,
    audible: t.audible && !(t.mutedInfo && t.mutedInfo.muted)
  }));
}

async function sendToTab(tabId, message) {
  try { return (await chrome.tabs.sendMessage(tabId, message)) ?? null; } catch (_) { return null; }
}

// The extension's own pages (setup, settings) load content.js themselves,
// since Chrome doesn't run content scripts there. They're reached with
// runtime messages addressed to their tab instead of tabs.sendMessage.
const OWN_PAGES = chrome.runtime.getURL('');
const isOwnPage = url => !!url && url.startsWith(OWN_PAGES);

async function deliver(tab, message) {
  if (!isOwnPage(tab.url)) return sendToTab(tab.id, message);
  try { return (await chrome.runtime.sendMessage({ ...message, forTab: tab.id })) ?? null; } catch (_) { return null; }
}

async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    return true;
  } catch (_) {
    return false;
  }
}

async function resolveTab(tab) {
  if (tab && tab.id >= 0) return tab;
  const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return t || null;
}

function activateTab(tabId, windowId) {
  chrome.tabs.update(tabId, { active: true }).catch(() => {});
  if (windowId !== undefined) chrome.windows.update(windowId, { focused: true }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function openSwitcher(direction, fromTab) {
  const tab = await resolveTab(fromTab);
  if (!tab) return;

  // Already open: just move the selection (no tab list needed).
  if (mem.overlayTabs.has(tab.id)) {
    const r = await deliver(tab, { action: 'cycle', direction });
    if (r && r.handled) return;
  }

  await ready;
  mem.lastShow.set(tab.id, Date.now()); // a capture running right now could include the overlay
  const tabs = await buildTabList(tab);
  const msg = { action: 'show', tabs, currentTabId: tab.id, currentWindowId: tab.windowId, direction };
  let shown = await deliver(tab, msg);
  if (!shown && !isOwnPage(tab.url) && (await injectContentScript(tab.id))) shown = await sendToTab(tab.id, msg);
  if (!shown) return quickSwitch(tab, tabs, direction); // page can't host the overlay (chrome://, Web Store…)
}

function quickSwitch(tab, tabs, direction) {
  if (tabs.length < 2) return;
  const target = direction === 'backward' ? tabs[tabs.length - 1] : tabs.find(t => t.id !== tab.id);
  if (target) activateTab(target.id, target.windowId);
}

async function openDirect(kind, fromTab) {
  const tab = await resolveTab(fromTab);
  if (!tab) return;
  const action = kind === 'bookmarks' ? 'openBookmarks' : 'openSearch';
  const r = await deliver(tab, { action });
  if (!r && !isOwnPage(tab.url) && (await injectContentScript(tab.id))) sendToTab(tab.id, { action });
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (mem.bulk) { mem.bulk.stop = true; return; } // any shortcut stops "capture all"
  if (command === 'toggle-tab-switcher') openSwitcher('forward', tab);
  else if (command === 'toggle-tab-switcher-reverse') openSwitcher('backward', tab);
  else if (command === 'search-mode') openDirect('search', tab);
  else if (command === 'bookmarks-mode') openDirect('bookmarks', tab);
});

// ---------------------------------------------------------------------------
// Messages from the content script
// ---------------------------------------------------------------------------

// Flattens the bookmark tree in its real order (exactly as on the bookmark
// bar: folders and bookmarks interleaved, each folder followed by its
// contents). `parent` is the parent folder's id, `segs` the folder chain,
// e.g. ["Bookmarks bar", "Work"]. `barId` is the bookmark bar's folder id.
function flattenBookmarks(tree) {
  const out = [];
  const root = tree && tree[0];
  const walk = (node, segs) => {
    let count = 0;
    for (const c of node.children || []) {
      if (c.url) {
        if (/^javascript:/i.test(c.url)) continue; // bookmarklets can't be opened from here
        out.push({ id: c.id, parent: node.id, title: c.title || c.url, url: c.url, segs, path: segs.join(' / ') });
        count++;
      } else {
        const title = c.title || 'Folder';
        const entry = { id: 'f' + c.id, folder: true, parent: node.id, title, url: '', segs, path: segs.join(' / '), count: 0 };
        out.push(entry);
        entry.count = walk(c, [...segs, title]);
        count += entry.count;
      }
    }
    return count;
  };
  if (root) walk(root, []);
  const bar = root && root.children && root.children[0];
  return { bookmarks: out, barId: bar ? bar.id : null, rootId: root ? root.id : null };
}

const handlers = {
  async getTabs(msg, sender) {
    await ready;
    const tab = sender.tab || null;
    const tabs = await buildTabList(tab);
    return { tabs, currentTabId: tab ? tab.id : null, currentWindowId: tab ? tab.windowId : null };
  },
  // The overlay asks only for the previews of the cards it is showing.
  async getShots(msg) {
    await ready;
    const settings = await getSettings();
    if (settings.showPreviews === false || !Array.isArray(msg.ids)) return { shots: {} };
    return { shots: await getShots(msg.ids.slice(0, 40)) };
  },
  async getBookmarks() {
    return flattenBookmarks(await chrome.bookmarks.getTree());
  },
  activateTab(msg) {
    activateTab(msg.tabId, msg.windowId);
    return { ok: true };
  },
  async closeTab(msg) {
    await chrome.tabs.remove(msg.tabId);
    return { ok: true };
  },
  async openUrl(msg, sender) {
    const props = { url: msg.url, active: true };
    if (sender.tab) { props.windowId = sender.tab.windowId; props.index = sender.tab.index + 1; }
    await chrome.tabs.create(props);
    return { ok: true };
  },
  // Settings → "Reset extension" has just deleted the stored data: drop the
  // in-memory copies too, so old previews and settings aren't used any more.
  async resetState() {
    await ready;
    if (mem.bulk) mem.bulk.stop = true;
    mem.settings = null;
    mem.index = {};
    mem.shots.clear();
    mem.lastShow.clear();
    return { ok: true };
  },
  // Settings → "Capture all previews now".
  captureAll() {
    captureAllTabs(); // runs in the background; progress arrives as captureProgress messages
    return { ok: true };
  },
  captureAllStop() {
    if (mem.bulk) mem.bulk.stop = true;
    return { ok: true };
  },
  captureAllStatus() {
    return { running: !!mem.bulk, done: mem.bulk ? mem.bulk.done : 0, total: mem.bulk ? mem.bulk.total : 0 };
  },
  // Alt was just pressed (probably about to press Q): grab a fresh screenshot
  // of the tab you're leaving while the page is still clean.
  prepare(msg, sender) {
    if (sender.tab && sender.tab.active) {
      capture(sender.tab.windowId, { force: true, onlyTabId: sender.tab.id, ifOlderThan: refreshMs() });
    }
    return { ok: true };
  },
  overlayState(msg, sender) {
    if (!sender.tab) return { ok: true };
    if (msg.visible) {
      mem.overlayTabs.add(sender.tab.id);
    } else {
      mem.overlayTabs.delete(sender.tab.id);
      mem.lastShow.delete(sender.tab.id); // overlay is gone: the page is clean again
      if (sender.tab.active) scheduleCapture(sender.tab.windowId, 300);
    }
    return { ok: true };
  }
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  const handler = msg && handlers[msg.action];
  if (!handler) return false;
  Promise.resolve()
    .then(() => handler(msg, sender))
    .then(res => sendResponse(res ?? { ok: true }), err => sendResponse({ ok: false, error: String(err && err.message || err) }));
  return true;
});

// ---------------------------------------------------------------------------
// Tab / window events
// ---------------------------------------------------------------------------

chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  await ready;
  if (mem.bulk) return; // "capture all" is flipping through tabs: not real use
  touch(tabId);
  scheduleCapture(windowId, 250, { ifOlderThan: refreshMs() });
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'loading') mem.overlayTabs.delete(tabId);
  if (!tab.active || mem.bulk) return;
  if (info.status === 'complete') scheduleCapture(tab.windowId, 500);
  // Single-page apps (YouTube, Gmail…) change the URL without reloading.
  else if (info.url && tab.status === 'complete') scheduleCapture(tab.windowId, 1000);
});

chrome.tabs.onRemoved.addListener(async tabId => {
  await ready;
  const i = mem.mru.indexOf(tabId);
  if (i !== -1) { mem.mru.splice(i, 1); persistMru(); }
  mem.overlayTabs.delete(tabId);
  mem.lastShow.delete(tabId);
  dropShot(tabId);
});

chrome.tabs.onReplaced.addListener(async (added, removed) => {
  await ready;
  const i = mem.mru.indexOf(removed);
  if (i !== -1) { mem.mru[i] = added; persistMru(); }
  dropShot(removed);
});

chrome.windows.onFocusChanged.addListener(async windowId => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  await ready;
  if (mem.bulk) return;
  const [tab] = await chrome.tabs.query({ active: true, windowId }).catch(() => []);
  if (tab) touch(tab.id);
  scheduleCapture(windowId, 400, { ifOlderThan: refreshMs() });
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

// "1.10.0" vs "1.9" → compares number by number.
function versionLess(a, b) {
  const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0);
  }
  return false;
}

// Versions before this one had no guided setup.
const SETUP_SINCE = '0.2.0';

chrome.runtime.onInstalled.addListener(async details => {
  if (details.reason === 'install') {
    // First install: open the guided setup instead of Settings.
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
  } else if (details.reason === 'update' && versionLess(details.previousVersion, SETUP_SINCE)) {
    // Updating from a version that never had the setup: show it once, as "what's new".
    const { setupDone } = await chrome.storage.local.get('setupDone').catch(() => ({}));
    if (!setupDone) chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html?updated=1') });
  }
  // Drop the old single-blob caches from previous versions.
  chrome.storage.local.remove(['tabScreenshotCacheV2', 'tabScreenshotCacheV3']).catch(() => {});
  chrome.storage.session.remove(['mruTabOrderV1', 'mruTabOrderV2']).catch(() => {});
  // Make the switcher work in tabs that were already open.
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*', 'file:///*'] }).catch(() => []);
  for (const tab of tabs) if (!tab.discarded) injectContentScript(tab.id);
});
