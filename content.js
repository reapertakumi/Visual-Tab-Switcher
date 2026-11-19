// Visual Tab Switcher — content script (tiny loader)
//
// Runs on every page, so it is kept as small as possible: it only tracks the
// modifier keys, catches the F2 / F4 hotkeys and answers the background.
// The switcher itself (ui.js) is imported the first time it's needed, or as
// soon as Alt is pressed so it's ready by the time Q is.

(() => {
  'use strict';

  // A previous copy (old extension version, or a re-injection) cleans up first.
  try { if (typeof window.__vtsDestroy === 'function') window.__vtsDestroy(); } catch (_) {}

  const SETTINGS_KEY = 'tabSwitcherSettings';
  const hot = { searchHotkey: 'F2', bookmarksHotkey: 'F4', directSearch: true, directBookmarks: true };
  const mods = { alt: false, ctrl: false, meta: false, lastUp: 0 };

  let settingsPromise = null;
  let ui = null;
  let uiPromise = null;
  let lastPrepare = 0;
  let ownTabId = null;

  // ------------------------------------------------------------------ plumbing

  function alive() {
    try { return !!chrome.runtime.id; } catch (_) { return false; }
  }

  function send(message) {
    if (!alive()) { destroy(); return Promise.resolve(null); }
    try { return chrome.runtime.sendMessage(message).catch(() => null); } catch (_) { return Promise.resolve(null); }
  }

  function applyHotkeys(raw) {
    const r = raw || {};
    // Start from the defaults, so a reset (settings removed) takes effect too.
    Object.assign(hot, { searchHotkey: 'F2', bookmarksHotkey: 'F4', directSearch: true, directBookmarks: true });
    for (const k of ['searchHotkey', 'bookmarksHotkey']) {
      if (typeof r[k] === 'string' && r[k] && r[k] !== 'custom') hot[k] = r[k];
    }
    if (typeof r.directSearch === 'boolean') hot.directSearch = r.directSearch;
    if (typeof r.directBookmarks === 'boolean') hot.directBookmarks = r.directBookmarks;
  }

  // Settings are read once, when the page is idle (not during page load).
  function loadSettings() {
    if (!settingsPromise) {
      settingsPromise = chrome.storage.sync.get(SETTINGS_KEY)
        .then(r => { const raw = r[SETTINGS_KEY] || null; applyHotkeys(raw); return raw; }, () => null);
    }
    return settingsPromise;
  }

  function loadUI() {
    if (!uiPromise) {
      uiPromise = import(chrome.runtime.getURL('ui.js'))
        .then(m => (ui = m.createUI({ mods, send, settingsReady: loadSettings() })));
      uiPromise.catch(() => { uiPromise = null; });
    }
    return uiPromise;
  }

  // Only settings changes matter here. (Listening to storage.local too would
  // deliver every saved preview to every tab.)
  function onSettingsChanged(changes) {
    if (!changes[SETTINGS_KEY]) return;
    const raw = changes[SETTINGS_KEY].newValue || null;
    applyHotkeys(raw);
    settingsPromise = Promise.resolve(raw);
    if (ui) ui.settingsChanged(raw);
  }

  // On the extension's own pages (setup, settings) this script is loaded
  // directly and receives runtime messages addressed to a tab: answer only
  // those meant for this tab. (In normal pages chrome.tabs doesn't exist.)
  try { if (chrome.tabs && chrome.tabs.getCurrent) chrome.tabs.getCurrent(t => { if (t) ownTabId = t.id; }); } catch (_) {}

  function onMessage(msg, sender, sendResponse) {
    if (!msg || sender.id !== chrome.runtime.id) return false;
    if (msg.forTab !== undefined && msg.forTab !== ownTabId) return false;
    switch (msg.action) {
      case 'ping':
        sendResponse({ ok: true });
        return false;
      case 'cycle':
        sendResponse({ handled: !!(ui && ui.cycle(msg.direction)) });
        return false;
      case 'show':
        // No answer on failure, so the background falls back to a quick switch.
        loadUI().then(u => u.openSwitcher(msg)).then(opened => sendResponse({ ok: true, opened }), () => sendResponse());
        return true;
      case 'shots':
        if (ui) ui.applyShots(msg.shots || {});
        sendResponse({ ok: true });
        return false;
      case 'openSearch':
      case 'openBookmarks':
        loadUI().then(u => u.openDirect(msg.action === 'openBookmarks' ? 'bookmarks' : 'search'))
          .then(() => sendResponse({ ok: true }), () => sendResponse());
        return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ keyboard

  const sameKey = (a, b) => a.length === b.length && a.toLowerCase() === b.toLowerCase();
  const isModifier = key => key === 'Alt' || key === 'Control' || key === 'Meta';

  function onKeyDown(e) {
    mods.alt = e.altKey; mods.ctrl = e.ctrlKey; mods.meta = e.metaKey;
    if (typeof e.key !== 'string') return; // e.g. autofill's synthetic keydown
    if (ui && ui.visible) { ui.onKeyDown(e); return; }

    if (e.key === 'Alt') {
      if (e.repeat || !e.isTrusted) return;
      if (!alive()) { destroy(); return; }
      loadUI(); // Alt is usually followed by Q: have the switcher ready
      // …and let the background take a fresh screenshot of this tab before it's covered.
      if (Date.now() - lastPrepare > 1500) { lastPrepare = Date.now(); send({ action: 'prepare' }); }
      return;
    }

    // Fast path for normal typing on the page.
    if (e.key.length === 1 || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
    const search = hot.directSearch && sameKey(e.key, hot.searchHotkey);
    const books = !search && hot.directBookmarks && sameKey(e.key, hot.bookmarksHotkey);
    if (!search && !books) return;
    if (!alive()) { destroy(); return; }
    e.preventDefault();
    e.stopImmediatePropagation();
    loadUI().then(u => u.openDirect(search ? 'search' : 'bookmarks'), () => {});
  }

  function onKeyUp(e) {
    mods.alt = e.altKey; mods.ctrl = e.ctrlKey; mods.meta = e.metaKey;
    if (isModifier(e.key)) mods.lastUp = Date.now();
    if (ui && ui.visible) ui.onKeyUp(e);
  }

  function onKeyPress(e) {
    if (ui && ui.visible) e.stopImmediatePropagation();
  }

  function onBlur(e) {
    if (e.target !== window) return;
    mods.alt = mods.ctrl = mods.meta = false;
    if (ui) ui.onBlur();
  }

  function onVisibility() {
    if (ui) ui.onVisibility();
  }

  function onResize() {
    if (ui) ui.onResize();
  }

  // ------------------------------------------------------------------ lifecycle

  const listeners = [
    [window, 'keydown', onKeyDown, true],
    [window, 'keyup', onKeyUp, true],
    [window, 'keypress', onKeyPress, true],
    [window, 'blur', onBlur, false],
    [window, 'resize', onResize, false],
    [document, 'visibilitychange', onVisibility, false]
  ];

  function destroy() {
    for (const [t, type, fn, capture] of listeners) t.removeEventListener(type, fn, capture);
    try { chrome.runtime.onMessage.removeListener(onMessage); } catch (_) {}
    try { chrome.storage.sync.onChanged.removeListener(onSettingsChanged); } catch (_) {}
    if (ui) ui.destroy();
    ui = null;
    if (window.__vtsDestroy === destroy) delete window.__vtsDestroy;
  }

  for (const [t, type, fn, capture] of listeners) t.addEventListener(type, fn, capture);
  chrome.runtime.onMessage.addListener(onMessage);
  chrome.storage.sync.onChanged.addListener(onSettingsChanged);
  window.__vtsDestroy = destroy;

  // Read settings once the page has finished its own work.
  (window.requestIdleCallback || setTimeout)(() => { if (alive()) loadSettings(); }, { timeout: 3000 });
})();
