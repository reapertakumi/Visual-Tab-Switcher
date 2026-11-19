// Visual Tab Switcher — switcher UI (ES module, loaded on demand by content.js)
// The overlay, tab search and bookmark search, drawn in a closed shadow root.
//
//  * Selection moves only with the keyboard; hovering only brightens a card and shows its ✕.
//  * Holding the modifier and releasing it switches to the selected tab.
//  * F2 (even while still holding Alt) searches this window's tabs; F4 searches bookmarks.
//
// content.js stays tiny on every page and imports this file the first time
// the switcher is needed (or as soon as Alt is pressed, to be ready in time).

export function createUI(env) {
  'use strict';

  const SETTINGS_KEY = 'tabSwitcherSettings';
  const DEFAULTS = {
    showPreviews: true,
    showHints: true,
    maxTabs: 'auto',        // 'auto' | 'auto2' | 'auto3' (rows) | a number
    previewScale: 100,
    // Style
    translucent: false,     // see-through blurred panel (acrylic / vibrancy)
    panelOpacity: 75,       // % when translucent
    dim: 'medium',          // 'none' | 'light' | 'medium' | 'strong'
    corners: 'medium',      // 'square' | 'medium' | 'round'
    animations: true,       // false = no fade, no pop, no transitions, no smooth scrolling
    theme: 'system',
    highlightColor: '#3b82f6',
    tabTitleLayout: 'header',
    searchHotkey: 'F2',
    directSearch: true,
    bookmarksHotkey: 'F4',
    directBookmarks: true
  };
  const ACCENT_NAMES = {
    blue: '#3b82f6', purple: '#8b5cf6', pink: '#ec4899', red: '#ef4444',
    orange: '#f97316', green: '#22c55e', teal: '#14b8a6'
  };
  const RENDER_LIMIT = 150; // most results the search / bookmark grid renders (it scrolls)
  const TAP_WINDOW_MS = 400;
  const GLOBE_ICON = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="#8a8a8a" stroke-width="1.2">' +
    '<circle cx="8" cy="8" r="6.4"/><path d="M1.6 8h12.8M8 1.6c2 2.2 2 10.6 0 12.8M8 1.6c-2 2.2-2 10.6 0 12.8"/></svg>'
  );

  // Layout constants (px). Keep in sync with the CSS below.
  const L = {
    gap: 12,          // space between cards
    panelPad: 16,     // panel inner padding
    border: 1,        // panel border
    cardPad: 8,       // card inner padding
    headH: 24,        // favicon + title row
    headGap: 8,       // between title row and thumbnail
    searchH: 54,      // search box + spacing
    captionH: 54,     // selected-tab caption
    hintsH: 45,       // keyboard hints row
    fade: 36          // edge fade (only if the window is resized while open)
  };
  const CARD_SIZE = 220; // card width at 100% "Card size"
  const MAX_CARDS = 9;   // never more than this many per row
  const MAX_ROWS = 6;    // rows in the search / bookmarks grid

  let settings = { ...DEFAULTS };

  const S = {
    visible: false,
    mode: 'tabs',      // 'tabs' | 'search' | 'bookmarks'
    entry: 'tabs',
    scope: 'window',   // 'window' | 'all'
    held: false,
    tabs: [],
    bookmarks: null,
    currentTabId: null,
    query: '',
    items: [],
    total: 0,
    selected: 0,
    savedSelection: 0,
    busy: false
  };
  const mods = env.mods; // modifier state, tracked by content.js
  const shotCache = new Map();
  const shotRequested = new Set();
  let cards = new Map();
  let ui = null;
  let prevFocus = null;

  // -------------------------------------------------------------------------
  // Plumbing
  // -------------------------------------------------------------------------

  const send = env.send;

  function applySettings(raw) {
    const s = { ...DEFAULTS, ...(raw || {}) };
    if (raw && raw.accentColor && ACCENT_NAMES[raw.accentColor]) s.highlightColor = ACCENT_NAMES[raw.accentColor];
    if (!/^#[0-9a-f]{6}$/i.test(s.highlightColor)) s.highlightColor = DEFAULTS.highlightColor;
    s.previewScale = Math.min(160, Math.max(60, Number(s.previewScale) || 100));
    s.panelOpacity = Math.min(100, Math.max(30, Number(s.panelOpacity) || 75));
    if (!['none', 'light', 'medium', 'strong'].includes(s.dim)) s.dim = 'medium';
    if (!['square', 'medium', 'round'].includes(s.corners)) s.corners = 'medium';
    if (typeof s.searchHotkey !== 'string' || !s.searchHotkey || s.searchHotkey === 'custom') s.searchHotkey = DEFAULTS.searchHotkey;
    if (typeof s.bookmarksHotkey !== 'string' || !s.bookmarksHotkey || s.bookmarksHotkey === 'custom') s.bookmarksHotkey = DEFAULTS.bookmarksHotkey;
    settings = s;
  }

  const settingsReady = env.settingsReady.then(applySettings);

  // -------------------------------------------------------------------------
  // Opening / closing
  // -------------------------------------------------------------------------

  async function openSwitcher({ tabs, currentTabId, currentWindowId, direction }) {
    await settingsReady;
    const back = direction === 'backward';
    if (S.visible) { move(back ? -1 : 1); return false; }

    tabs = Array.isArray(tabs) ? tabs : [];
    const held = mods.alt || mods.ctrl || mods.meta;

    // Tapped and released before we could draw: switch straight away (quick Alt+Q tap).
    if (!held && Date.now() - mods.lastUp < TAP_WINDOW_MS && tabs.length > 1) {
      const target = back ? tabs[tabs.length - 1] : tabs[1];
      send({ action: 'activateTab', tabId: target.id, windowId: target.windowId });
      return false;
    }

    S.tabs = tabs;
    S.currentTabId = currentTabId;
    S.currentWindowId = currentWindowId;
    S.scope = 'recent';
    S.bookmarks = null;
    S.selected = tabs.length > 1 ? (back ? tabs.length - 1 : 1) : 0;
    show('tabs', held);
    return true;
  }

  async function openDirect(kind) {
    if (S.visible || S.busy) return;
    S.busy = true;
    try {
      await settingsReady;
      const [t, b] = await Promise.all([
        send({ action: 'getTabs' }),
        kind === 'bookmarks' ? send({ action: 'getBookmarks' }) : null
      ]);
      if (S.visible || !t || !t.tabs) return;
      if (kind === 'bookmarks' && !(b && b.bookmarks)) return;
      S.tabs = t.tabs;
      S.currentTabId = t.currentTabId;
      S.currentWindowId = t.currentWindowId;
      S.bookmarks = b ? b.bookmarks : null;
      if (b) { S.barId = b.barId; S.rootId = b.rootId; folderNames = null; }
      S.scope = 'all';
      S.selected = 0;
      show(kind, false);
    } finally {
      S.busy = false;
    }
  }

  // Previews are kept briefly after closing (instant re-open), then freed so
  // tabs that aren't using the switcher don't hold on to images.
  let releaseTimer = 0;

  function show(mode, held) {
    if (!document.documentElement) return;
    clearTimeout(releaseTimer);
    cards = new Map();
    shotRequested.clear();
    S.multiWindow = S.tabs.some(t => t.windowId !== S.currentWindowId);
    buildUI();
    S.visible = true;
    S.held = held;
    S.entry = mode;
    S.savedSelection = S.selected;
    prevFocus = deepActiveElement();
    setMode(mode, { initial: true });
    send({ action: 'overlayState', visible: true });
  }

  function hide({ restoreFocus = true } = {}) {
    if (!S.visible) return;
    S.visible = false;
    S.held = false;
    S.mode = 'tabs';
    S.items = [];
    S.bookmarks = null;
    cards = new Map();
    if (ui) ui.host.remove();
    ui = null;
    if (restoreFocus && prevFocus && prevFocus.isConnected && prevFocus.focus) {
      try { prevFocus.focus({ preventScroll: true }); } catch (_) {}
    }
    prevFocus = null;
    S.tabs = [];
    clearTimeout(releaseTimer);
    releaseTimer = setTimeout(() => shotCache.clear(), 30000);
    send({ action: 'overlayState', visible: false });
  }

  function deepActiveElement() {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    return el;
  }

  // -------------------------------------------------------------------------
  // Modes
  // -------------------------------------------------------------------------

  function setMode(mode, { initial = false, text = '' } = {}) {
    if (!ui) return;
    if (!initial && S.mode === 'tabs' && mode !== 'tabs') S.savedSelection = S.selected;
    // Searching is a deliberate action: releasing Alt must not switch tabs any more.
    if (mode !== 'tabs') S.held = false;

    S.mode = mode;
    S.query = text;
    ui.input.value = text;
    ui.panel.classList.toggle('searching', mode !== 'tabs');
    ui.input.placeholder = mode === 'bookmarks'
      ? 'Search bookmarks   ·   type a folder name, Tab to open it'
      : (S.scope === 'all' ? 'Search tabs in all windows' : 'Search tabs in this window');

    if (mode === 'tabs') {
      if (!initial) S.selected = S.savedSelection;
      ui.overlay.focus({ preventScroll: true });
    } else {
      S.selected = 0;
      ui.input.focus({ preventScroll: true });
      ui.input.setSelectionRange(text.length, text.length);
    }
    if (mode === 'bookmarks' && !S.bookmarks) loadBookmarks();
    ui.strip.scrollLeft = 0;
    ui.strip.scrollTop = 0;
    refresh();
  }

  function toggleMode(mode) {
    if (S.mode !== mode) setMode(mode);
    else if (S.entry === 'tabs') setMode('tabs');
    else hide();
  }

  async function loadBookmarks() {
    S.bookmarks = [];
    const r = await send({ action: 'getBookmarks' });
    if (!S.visible) return;
    if (r && r.bookmarks) { S.bookmarks = r.bookmarks; S.barId = r.barId; S.rootId = r.rootId; folderNames = null; }
    if (S.mode === 'bookmarks') refresh();
  }

  // -------------------------------------------------------------------------
  // Filtering (search keys computed once per item)
  // -------------------------------------------------------------------------

  function prettyUrl(url) {
    if (!url) return '';
    const m = /^https?:\/\/(?:www\.)?([^/?#]+)([^?#]*)/i.exec(url);
    if (!m) return url;
    return m[1] + (m[2] === '/' ? '' : m[2]);
  }

  function hostOf(url) {
    const m = /^[a-z][\w+.-]*:\/\/(?:www\.)?([^/?#:]+)/i.exec(url || '');
    return m ? m[1] : (url || '').split(':')[0];
  }

  function termsOf(query) {
    return query.toLowerCase().split(/\s+/).filter(Boolean);
  }

  function keysOf(item) {
    if (item._t === undefined) {
      item._t = (item.title || '').toLowerCase();
      item._u = prettyUrl(item.url).toLowerCase();
    }
    return item;
  }

  const BOUNDARY = /[\s\-_.|:/(\[]/;

  function score(item, terms) {
    const { _t: t, _u: u } = keysOf(item);
    let total = 0;
    for (const term of terms) {
      const i = t.indexOf(term);
      if (i === 0) total += 30;
      else if (i > 0) total += BOUNDARY.test(t[i - 1]) ? 20 : 10;
      else if (u.includes(term)) total += 4;
      else return -1;
    }
    return total;
  }

  function rank(list, terms) {
    if (!terms.length) return list;
    const scored = [];
    for (const item of list) {
      const s = score(item, terms);
      if (s >= 0) scored.push([s, item]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    return scored.map(x => x[1]);
  }

  // Bookmark query syntax:
  //   report               → bookmarks/folders named "report"
  //   /Work/report         → "report" inside a folder matching "Work"
  //   /Work/Sub/report     → nested folders, matched in order
  //   /Work/               → browse the Work folder
  //   /Work report         → same as /Work/report (older syntax)
  // Folder names match partially and ignore case ("/wo/" finds "Work").
  //
  // `partial` is the folder name currently being typed (for Tab completion),
  // `parents` the folders typed before it.
  function bookmarkQuery() {
    const raw = S.query.replace(/^\s+/, '');
    if (!raw.startsWith('/')) {
      const word = raw.trim();
      return { slash: false, folders: [], labels: [], terms: termsOf(raw), browsing: false,
        partial: word && !/\s/.test(word) ? word : '', parents: [] };
    }
    const rest = raw.slice(1);
    let segs;
    let text;
    let partial = '';
    let parents = [];
    if (rest.includes('/')) {
      segs = rest.split('/');
      text = segs.pop();
      if (text && !/\s/.test(text)) { partial = text; parents = segs; }
    } else {
      const sp = rest.indexOf(' ');
      segs = [sp === -1 ? rest : rest.slice(0, sp)];
      text = sp === -1 ? '' : rest.slice(sp + 1);
      if (sp === -1 && rest) partial = rest;
    }
    const labels = segs.map(s => s.trim()).filter(Boolean);
    return {
      slash: true,
      folders: labels.map(s => s.toLowerCase()),
      labels,
      terms: termsOf(text),
      // "/Work" (still typing the name) also lists the Work folder itself;
      // "/Work/" lists what's inside it.
      browsing: raw.endsWith('/') || !!text.trim(),
      partial,
      parents: parents.map(s => s.trim().toLowerCase()).filter(Boolean)
    };
  }

  function chainOf(item) {
    if (!item._s) item._s = (item.segs || []).map(s => s.toLowerCase());
    return item._s;
  }

  // A typed folder name matches exactly when a folder with that exact name
  // exists ("/Work/" ≠ "Workouts"), otherwise partially ("/wo" → "Work").
  let folderNames = null;
  function segMatch(seg, typed) {
    if (!folderNames) {
      folderNames = new Set();
      for (const b of S.bookmarks || []) if (b.folder) folderNames.add(b.title.toLowerCase());
    }
    return folderNames.has(typed) ? seg === typed : seg.includes(typed);
  }

  // Index in `chain` where the last of `folders` matched (in order), or -1.
  function matchChain(chain, folders) {
    if (!folders.length) return Math.max(0, chain.length - 1); // nothing to match: always matches
    let i = 0;
    let at = -1;
    for (let k = 0; k < chain.length && i < folders.length; k++) {
      if (segMatch(chain[k], folders[i])) { i++; at = k; }
    }
    return i === folders.length ? at : -1;
  }

  function inFolders(item, folders, browsing) {
    const chain = item.folder && !browsing ? [...chainOf(item), item.title.toLowerCase()] : chainOf(item);
    return matchChain(chain, folders) !== -1;
  }

  // Bookmark bar view (empty search): the bar's items in their real order,
  // then the other top-level folders ("Other bookmarks", "Mobile bookmarks"),
  // just like the bar itself.
  function barView(all) {
    const onBar = all.filter(b => b.parent === S.barId);
    const others = all.filter(b => b.folder && b.parent === S.rootId && b.id !== 'f' + S.barId && b.count > 0);
    return onBar.concat(others);
  }

  // Tab / Enter completion: the first folder (in bookmark order) whose name
  // starts with what you're typing.
  function folderCompletion() {
    if (S.mode !== 'bookmarks' || !ui || !S.bookmarks) return null;
    if (ui.input.selectionStart !== ui.input.value.length) return null;
    const q = bookmarkQuery();
    if (!q.partial) return null;
    const p = q.partial.toLowerCase();
    const folder = S.bookmarks.find(b =>
      b.folder && b.title.toLowerCase().startsWith(p) &&
      (!q.parents.length || matchChain(chainOf(b), q.parents) !== -1));
    if (!folder) return null;
    const raw = S.query;
    const value = q.slash
      ? raw.slice(0, raw.length - q.partial.length) + folder.title + '/'
      : '/' + [...folder.segs, folder.title].join('/') + '/';
    return { folder, value, ghost: folder.title.slice(q.partial.length) + '/' };
  }

  function acceptCompletion(c) {
    S.query = c.value;
    S.selected = 0;
    ui.strip.scrollTop = 0;
    ui.input.value = c.value;
    ui.input.setSelectionRange(c.value.length, c.value.length);
    refresh();
  }

  function updateGhost() {
    if (!ui) return;
    const c = S.mode === 'bookmarks' ? folderCompletion() : null;
    S.completion = c;
    if (!c || ui.input.scrollWidth > ui.input.clientWidth) {
      ui.ghost.hidden = true;
      return;
    }
    ui.ghostTyped.textContent = ui.input.value;
    ui.ghostRest.textContent = c.ghost;
    ui.ghost.hidden = false;
  }

  function computeItems() {
    if (S.mode === 'bookmarks') {
      const q = bookmarkQuery();
      const all = S.bookmarks || [];
      if (!q.slash && !q.terms.length) return barView(all);
      if (q.folders.length && q.browsing && !q.terms.length) {
        // Inside a folder: its direct contents, in bookmark order.
        const last = q.folders[q.folders.length - 1];
        const before = q.folders.slice(0, -1);
        return all.filter(b => {
          const ch = chainOf(b);
          return ch.length && segMatch(ch[ch.length - 1], last) && matchChain(ch.slice(0, -1), before) !== -1;
        });
      }
      const pool = q.folders.length ? all.filter(b => inFolders(b, q.folders, q.browsing)) : all;
      return rank(pool, q.terms); // ties keep bookmark order
    }
    if (S.mode === 'search') {
      // From Alt+Q, F2 searches this window only; direct search covers all windows.
      const pool = S.scope === 'recent' ? S.tabs.filter(t => t.windowId === S.currentWindowId) : S.tabs;
      return rank(pool, termsOf(S.query));
    }
    return S.tabs;
  }

  function highlightTerms() {
    if (S.mode === 'tabs') return [];
    return S.mode === 'bookmarks' ? bookmarkQuery().terms : termsOf(S.query);
  }

  // -------------------------------------------------------------------------
  // Layout: how many cards fit on this screen, in one row
  // -------------------------------------------------------------------------
  //
  // The card size never depends on how many tabs there are, so a window with
  // 2 tabs gets the same card size as one with 30.
  // 1. Thumbnails use the shape of this browser window (clamped 2:1 … 4:3).
  // 2. Card width = the "Card size" setting, shrunk only if the screen is too
  //    short (or too narrow for even 2 cards).
  // 3. Capacity = how many whole cards fit across the screen. Only that many
  //    tabs are shown — nothing is ever cut off or hidden off-screen.
  // 4. The panel is as wide as the cards it shows (min. 3 card slots, so the
  //    title caption below always has room).
  // 5. Search (F2) and bookmarks (F4) use a grid instead: as many rows of
  //    the same cards as fit the screen height.
  // 6. "Auto · 2 rows" / "Auto · 3 rows" (Settings → Tabs in the switcher):
  //    the Alt+Q switcher becomes a 2- or 3-row grid. Cards shrink so that
  //    many rows fit the screen height; each row holds as many as fit across.

  // Rows for the Alt+Q switcher, from the "Tabs in the switcher" setting.
  function tabRows() {
    return settings.maxTabs === 'auto3' ? 3 : settings.maxTabs === 'auto2' ? 2 : 1;
  }

  function measure() {
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.innerHeight;
    const scale = settings.previewScale / 100;
    const margin = Math.round(Math.max(16, Math.min(64, vw * 0.04)));
    const availW = vw - 2 * margin - 2 * (L.panelPad + L.border);
    // Reserve room for the search box even when it's hidden, so cards keep
    // the same size when you start searching.
    const chromeH = 2 * (L.panelPad + L.border) + L.captionH + (settings.showHints ? L.hintsH : 0) + L.searchH;
    const availH = vh - 2 * margin - chromeH;
    const aspect = Math.min(0.75, Math.max(0.5, vh / Math.max(1, vw)));
    const cardChromeH = 2 * L.cardPad + L.headH + L.headGap;

    // Same card size in every mode, so switching to search doesn't resize cards.
    const wantRows = tabRows();
    const rowH = (availH - (wantRows - 1) * L.gap) / wantRows;

    let w = CARD_SIZE * scale;
    w = Math.min(w, (rowH - cardChromeH) / aspect + 2 * L.cardPad); // fit the height (all rows)
    w = Math.min(w, (availW - L.gap) / 2);                              // at least 2 per row
    w = Math.floor(Math.max(110, Math.min(w, availW)));

    const capacity = Math.max(1, Math.min(MAX_CARDS, Math.floor((availW + L.gap) / (w + L.gap))));
    const thumbH = Math.round((w - 2 * L.cardPad) * aspect);
    const cardH = cardChromeH + thumbH;
    const rows = Math.max(1, Math.min(MAX_ROWS, Math.floor((availH + L.gap) / (cardH + L.gap))));
    return { w, thumbH, cardH, capacity, rows, availW };
  }

  // How many items to render. The Alt+Q switcher shows only what fits (1–3
  // rows); the search / bookmark grid renders more and scrolls.
  function maxItems(m) {
    return S.mode === 'tabs' ? m.capacity * Math.min(tabRows(), m.rows) : RENDER_LIMIT;
  }

  function layout() {
    if (!ui) return;
    const m = measure();
    const rows = S.mode === 'tabs' ? Math.min(tabRows(), m.rows) : m.rows;
    S.capacity = m.capacity;
    S.rows = rows;
    S.cardH = m.cardH;
    const grid = S.mode !== 'tabs' || rows > 1;
    ui.strip.classList.toggle('grid', grid);
    // Fewer results than one full row: only that many columns, centred.
    const cols = grid ? Math.min(m.capacity, Math.max(1, S.items.length)) : m.capacity;
    ui.overlay.style.setProperty('--cols', String(cols));
    // Visible grid height = whole rows (+ the strip's 8px padding).
    ui.overlay.style.setProperty('--grid-h', (rows * m.cardH + (rows - 1) * L.gap + 16) + 'px');
    S.cols = grid ? cols : S.items.length || 1;
    const slots = S.mode === 'tabs'
      ? Math.max(Math.min(3, m.capacity), Math.min(S.items.length, m.capacity))
      : m.capacity; // searching: full width, so the panel doesn't jump while typing
    const rowW = Math.min(m.availW, slots * m.w + (slots - 1) * L.gap);
    const st = ui.overlay.style;
    st.setProperty('--w', m.w + 'px');
    st.setProperty('--th', m.thumbH + 'px');
    st.setProperty('--card-h', m.cardH + 'px');
    st.setProperty('--panel-w', rowW + 2 * (L.panelPad + L.border) + 'px');
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function svg(d, size, strokeWidth = 1.3) {
    const NS = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('width', size);
    s.setAttribute('height', size);
    s.setAttribute('viewBox', '0 0 16 16');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', strokeWidth);
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    s.appendChild(p);
    return s;
  }

  const ICON_CLOSE = 'M4.5 4.5l7 7M11.5 4.5l-7 7';
  const ICON_SEARCH = 'M7 12.2A5.2 5.2 0 1 0 7 1.8a5.2 5.2 0 0 0 0 10.4zM10.8 10.8 14.4 14.4';
  const ICON_SPEAKER = 'M2.5 6h2.5l3.5-3v10L5 10H2.5zM11 5.5a3.5 3.5 0 0 1 0 5';
  const ICON_PIN = 'M6 2h4l-.6 4 2.6 2.4H4L6.6 6zM8 8.4V14';
  const ICON_FOLDER = 'M1.5 4.5a1 1 0 0 1 1-1h3.5l1.5 1.5h6a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z';
  const ICON_WINDOW = 'M2 3.5h12v9H2zM2 6h12';
  const ICON_EMPTY = 'M7 12.2A5.2 5.2 0 1 0 7 1.8a5.2 5.2 0 0 0 0 10.4zM10.8 10.8 14.4 14.4M5 7h4';

  function extensionFavicon(pageUrl, size) {
    return chrome.runtime.getURL('/_favicon/') + '?pageUrl=' + encodeURIComponent(pageUrl || '') + '&size=' + size;
  }

  function favicon(pageUrl, favIconUrl, className, size) {
    const img = el('img', className);
    img.alt = '';
    img.draggable = false;
    img.decoding = 'async';
    const direct = favIconUrl && /^(https?:|data:)/i.test(favIconUrl) ? favIconUrl : '';
    img.src = direct || extensionFavicon(pageUrl, size);
    img.onerror = () => {
      if (direct && img.src === direct) img.src = extensionFavicon(pageUrl, size);
      else { img.onerror = null; img.src = GLOBE_ICON; }
    };
    return img;
  }

  function setHighlighted(node, text, terms) {
    const lower = text.toLowerCase();
    if (!terms.length || lower.length !== text.length) { node.textContent = text; return; }
    const marks = new Uint8Array(text.length);
    let any = false;
    for (const term of terms) {
      for (let i = lower.indexOf(term); i !== -1; i = lower.indexOf(term, i + term.length)) {
        marks.fill(1, i, i + term.length);
        any = true;
      }
    }
    if (!any) { node.textContent = text; return; }
    const frag = document.createDocumentFragment();
    for (let i = 0; i < text.length;) {
      let j = i;
      while (j < text.length && marks[j] === marks[i]) j++;
      const part = text.slice(i, j);
      frag.append(marks[i] ? el('mark', '', part) : part);
      i = j;
    }
    node.replaceChildren(frag);
  }

  function placeholder(url, favIconUrl, extra) {
    const ph = el('div', 'ph');
    const tile = el('div', 'ph-tile');
    tile.append(favicon(url, favIconUrl, 'ph-icon', 64));
    ph.append(tile, el('span', 'ph-text', hostOf(url)));
    if (extra) ph.append(el('span', 'ph-text sub', extra));
    return ph;
  }

  function setShot(card, dataUrl) {
    if (!card || card._shot === dataUrl) return;
    card._shot = dataUrl;
    const img = el('img', 'shot');
    img.alt = '';
    img.draggable = false;
    img.decoding = 'async';
    img.src = dataUrl;
    card._thumb.replaceChildren(img);
    if (card._badge) card._thumb.append(card._badge);
  }

  function buildCard(item, isBookmark) {
    const card = el('div', isBookmark ? 'card bookmark' : 'card');
    card.setAttribute('role', 'option');
    if (settings.tabTitleLayout === 'footer') card.classList.add('bottom');
    if (item.folder) card.classList.add('folder');

    const head = el('div', 'head');
    const title = el('span', 'title');
    if (item.folder) {
      const icon = el('span', 'fav folder-icon');
      icon.append(svg(ICON_FOLDER, 16, 1.2));
      head.append(icon, title);
    } else {
      head.append(favicon(item.url, isBookmark ? '' : item.favIconUrl, 'fav', 32), title);
    }

    const thumb = el('div', 'thumb');
    card._thumb = thumb;
    card._titleEl = title;
    card._titleText = item.title || prettyUrl(item.url) || 'Untitled';
    card._terms = null;

    if (item.folder) {
      const ph = el('div', 'ph');
      const tile = el('div', 'ph-tile folder-tile');
      tile.append(svg(ICON_FOLDER, 30, 1.1));
      const n = item.count || 0;
      ph.append(tile, el('span', 'ph-text', `${n} bookmark${n === 1 ? '' : 's'}`));
      if (item.path) ph.append(el('span', 'ph-text sub', item.path));
      thumb.append(ph);
    } else if (isBookmark) {
      thumb.append(placeholder(item.url, '', item.path));
    } else {
      if (item.pinned) { const f = el('span', 'flag'); f.title = 'Pinned'; f.append(svg(ICON_PIN, 12)); head.append(f); }
      if (item.audible) { const f = el('span', 'flag'); f.title = 'Playing audio'; f.append(svg(ICON_SPEAKER, 13)); head.append(f); }
      const close = el('button', 'close');
      close.type = 'button';
      close.tabIndex = -1;
      close.title = 'Close tab';
      close.setAttribute('aria-label', 'Close tab');
      close.append(svg(ICON_CLOSE, 12, 1.4));
      head.append(close);

      thumb.append(placeholder(item.url, item.favIconUrl, ''));
      if (item.id === S.currentTabId) {
        card.classList.add('current');
        card._badge = el('span', 'badge', 'Current');
      } else if (S.multiWindow && item.windowId !== S.currentWindowId) {
        // Lives in another browser window: say so, so you know where it is.
        card.classList.add('other-window');
        card._badge = el('span', 'badge win');
        card._badge.append(svg(ICON_WINDOW, 11, 1.4), item.win ? `Window ${item.win}` : 'Other window');
        card._badge.title = 'This tab is in another browser window';
      }
      if (card._badge) thumb.append(card._badge);
      const shot = settings.showPreviews && shotCache.get(item.id);
      if (shot) setShot(card, shot);
    }
    card.append(head, thumb);
    return card;
  }

  function cardFor(item) {
    const key = (S.mode === 'bookmarks' ? 'b' : 't') + item.id;
    let card = cards.get(key);
    if (!card) {
      card = buildCard(item, S.mode === 'bookmarks');
      cards.set(key, card);
    }
    return card;
  }

  function applyShots(shots) {
    for (const id in shots) {
      shotCache.set(Number(id), shots[id]);
      if (S.visible && settings.showPreviews) setShot(cards.get('t' + id), shots[id]);
    }
    while (shotCache.size > 40) shotCache.delete(shotCache.keys().next().value);
  }

  function refresh() {
    if (!ui) return;
    const all = computeItems();
    S.total = all.length;
    // Show only what fits on screen in one row (search narrows the rest down).
    const limit = Math.min(RENDER_LIMIT, maxItems(measure()));
    S.items = all.length > limit ? all.slice(0, limit) : all;
    S.selected = Math.min(Math.max(0, S.selected), Math.max(0, S.items.length - 1));
    render();
  }

  function render() {
    const terms = highlightTerms();
    const termKey = terms.join(' ');
    const list = new Array(S.items.length);
    for (let i = 0; i < S.items.length; i++) {
      const card = cardFor(S.items[i]);
      card._idx = i;
      if (card._terms !== termKey) {
        card._terms = termKey;
        setHighlighted(card._titleEl, card._titleText, terms);
      }
      list[i] = card;
    }
    ui.strip.replaceChildren(...list);
    layout();

    const empty = !S.items.length;
    ui.empty.hidden = !empty;
    ui.strip.hidden = empty;
    if (empty) {
      const noun = S.mode === 'bookmarks' ? 'bookmarks' : 'tabs';
      ui.emptyText.textContent = S.query.trim() ? `No ${noun} match “${S.query.trim()}”` : `No ${noun}`;
    }

    if (S.mode !== 'tabs') {
      const noun = S.mode === 'bookmarks' ? 'result' : 'tab';
      const shown = S.total > S.items.length ? `${S.items.length} of ${S.total}` : String(S.total);
      ui.count.textContent = `${shown} ${noun}${S.total === 1 ? '' : 's'}`;
      let chip = S.mode === 'bookmarks' ? 'Bookmarks' : (S.scope === 'all' ? 'All windows' : 'This window');
      if (S.mode === 'bookmarks') {
        const { labels } = bookmarkQuery();
        if (labels.length) chip = (labels.length > 2 ? '… › ' : '') + labels.slice(-2).join(' › ');
      }
      ui.chip.textContent = chip;
    }

    updateHints();
    if (ui.selectedCard) ui.selectedCard.classList.remove('sel');
    ui.selectedCard = null;
    updateSelection(false);
    updateFades();
    updateGhost();
    updateHints();
    requestShots();
  }

  // Ask for previews of the cards on screen (plus one row ahead) that we
  // don't have yet. Called on render and while the grid scrolls.
  function requestShots() {
    if (!ui || S.mode === 'bookmarks' || !settings.showPreviews) return;
    let from = 0;
    let to = S.items.length;
    if (ui.strip.classList.contains('grid') && S.cardH) {
      const rowH = S.cardH + L.gap;
      const firstRow = Math.floor(ui.strip.scrollTop / rowH);
      from = firstRow * S.cols;
      to = Math.min(S.items.length, (firstRow + (S.rows || 1) + 1) * S.cols);
    }
    const ids = [];
    for (let i = from; i < to; i++) {
      const t = S.items[i];
      if (!shotCache.has(t.id) && !shotRequested.has(t.id)) { shotRequested.add(t.id); ids.push(t.id); }
    }
    if (!ids.length) return;
    send({ action: 'getShots', ids }).then(r => { if (r && r.shots) applyShots(r.shots); });
  }

  let hintsKey = '';
  function updateHints() {
    if (!ui || !settings.showHints) return;
    const hints = S.mode === 'tabs'
      ? [S.held ? ['Release', 'switch'] : ['Enter', 'switch'],
         ['Tab', 'next'],
         [ui.strip.classList.contains('grid') ? '← ↑ → ↓' : '← →', 'move'],
         [settings.searchHotkey, 'search'],
         ['Del', 'close'],
         ['Esc', 'cancel']]
      : [[ui.strip.classList.contains('grid') ? '← ↑ → ↓' : '← →', 'move'],
         S.completion ? ['Tab', `open “${S.completion.folder.title}”`] : ['Enter', 'open'],
         S.mode === 'search' ? [settings.bookmarksHotkey, 'bookmarks'] : [settings.searchHotkey, 'tabs'],
         ['Esc', S.entry === 'tabs' ? 'back' : 'close']];
    const key = JSON.stringify(hints);
    if (key === hintsKey && ui.hints.firstChild) return;
    hintsKey = key;
    const frag = document.createDocumentFragment();
    for (const [k, label] of hints) {
      const h = el('span', 'hint');
      h.append(el('kbd', '', k), label);
      frag.append(h);
    }
    ui.hints.replaceChildren(frag);
  }

  function updateCaption() {
    const item = S.items[S.selected];
    if (!item) {
      ui.capTitle.textContent = '';
      ui.capSub.textContent = '';
      ui.capPos.textContent = '';
      return;
    }
    ui.capTitle.textContent = item.title || prettyUrl(item.url) || 'Untitled';
    let sub = prettyUrl(item.url);
    if (item.folder) {
      const n = item.count || 0;
      sub = `Folder  ·  ${n} bookmark${n === 1 ? '' : 's'}${item.path ? `  ·  ${item.path}` : ''}  ·  Enter to open`;
    } else if (S.mode === 'bookmarks') {
      if (item.path) sub = `${item.path}  ·  ${hostOf(item.url)}`;
    } else if (item.id === S.currentTabId) {
      sub = `Current tab  ·  ${hostOf(item.url)}`;
    } else if (S.multiWindow && item.windowId !== S.currentWindowId) {
      sub = `In ${item.win ? `window ${item.win}` : 'another window'}  ·  ${hostOf(item.url)}`;
    }
    ui.capSub.textContent = sub;
    const more = S.total - S.items.length;
    let pos = S.items.length > 1 ? `${S.selected + 1} / ${S.items.length}` : '';
    // Alt+Q: letters typed while holding Alt don't reach the search, so name the key.
    if (more > 0) pos += S.mode === 'tabs'
      ? `  ·  ${more} more, press ${settings.searchHotkey} to search`
      : `  ·  ${more} more, type to narrow down`;
    ui.capPos.textContent = pos;
  }

  function updateSelection(smooth = true) {
    if (!ui) return;
    const card = ui.strip.children[S.selected] || null;
    if (ui.selectedCard !== card) {
      if (ui.selectedCard) { ui.selectedCard.classList.remove('sel'); ui.selectedCard.setAttribute('aria-selected', 'false'); }
      ui.selectedCard = card;
      if (card) { card.classList.add('sel'); card.setAttribute('aria-selected', 'true'); }
    }
    updateCaption();
    if (card) ensureVisible(card, smooth);
  }

  function ensureVisible(card, smooth) {
    const s = ui.strip;
    smooth = smooth && settings.animations !== false;
    if (s.classList.contains('grid')) {
      // Grid: keep the selected row in view, scrolling a whole row at a time.
      if (s.scrollHeight <= s.clientHeight) return;
      const top = card.offsetTop - 8;
      const bottom = card.offsetTop + card.offsetHeight + 8;
      let y = null;
      if (top < s.scrollTop) y = top;
      else if (bottom > s.scrollTop + s.clientHeight) y = bottom - s.clientHeight;
      if (y !== null) s.scrollTo({ top: Math.max(0, y), behavior: smooth ? 'smooth' : 'auto' });
      return;
    }
    if (s.scrollWidth <= s.clientWidth) return;
    const left = card.offsetLeft;
    const right = left + card.offsetWidth;
    const pad = L.fade + 8;
    let target = null;
    if (left - pad < s.scrollLeft) target = left - pad;
    else if (right + pad > s.scrollLeft + s.clientWidth) target = right + pad - s.clientWidth;
    if (target !== null) s.scrollTo({ left: Math.max(0, target), behavior: smooth ? 'smooth' : 'auto' });
  }

  function updateFades() {
    if (!ui) return;
    const s = ui.strip;
    const grid = s.classList.contains('grid');
    const maxX = grid ? 0 : s.scrollWidth - s.clientWidth;
    const maxY = grid ? s.scrollHeight - s.clientHeight : 0;
    s.classList.toggle('fade-l', maxX > 1 && s.scrollLeft > 1);
    s.classList.toggle('fade-r', maxX > 1 && s.scrollLeft < maxX - 1);
    s.classList.toggle('fade-t', maxY > 1 && s.scrollTop > 1);
    s.classList.toggle('fade-b', maxY > 1 && s.scrollTop < maxY - 1);
  }

  let scrollRaf = 0;
  function onStripScroll() {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      updateFades();
      requestShots();
    });
  }

  // -------------------------------------------------------------------------
  // Navigation & actions
  // -------------------------------------------------------------------------

  function move(delta) {
    const n = S.items.length;
    if (!n) return;
    S.selected = ((S.selected + delta) % n + n) % n;
    updateSelection();
  }

  // ↑ / ↓: one row up or down in the grid; in the single row, same as ← / →.
  function moveRow(dir) {
    if (!ui || !ui.strip.classList.contains('grid')) { move(dir); return; }
    const n = S.items.length;
    const cols = S.cols || 1;
    if (!n) return;
    let target = S.selected + dir * cols;
    if (target >= n) {
      if (Math.floor(S.selected / cols) === Math.floor((n - 1) / cols)) return; // already on the last row
      target = n - 1;
    }
    if (target < 0) {
      if (S.selected < cols) return; // already on the first row
      target = S.selected % cols;
    }
    S.selected = target;
    updateSelection();
  }

  function moveTo(index) {
    if (!S.items.length) return;
    S.selected = Math.min(Math.max(0, index), S.items.length - 1);
    updateSelection();
  }

  function activate(item) {
    if (!item) return;
    if (item.folder) {
      // Open the folder: the search becomes "/Bookmarks bar/Work/".
      const q = '/' + [...(item.segs || []), item.title].join('/') + '/';
      S.query = q;
      S.selected = 0;
      ui.input.value = q;
      ui.input.focus({ preventScroll: true });
      ui.input.setSelectionRange(q.length, q.length);
      refresh();
      return;
    }
    if (S.mode === 'bookmarks') {
      hide({ restoreFocus: false });
      send({ action: 'openUrl', url: item.url });
    } else if (item.id === S.currentTabId) {
      hide();
    } else {
      hide({ restoreFocus: false });
      send({ action: 'activateTab', tabId: item.id, windowId: item.windowId });
    }
  }

  async function closeTabAt(index) {
    if (S.mode === 'bookmarks') return;
    const tab = S.items[index];
    if (!tab) return;
    const card = cards.get('t' + tab.id);
    if (card) card.classList.add('closing');

    const res = await send({ action: 'closeTab', tabId: tab.id });
    if (!S.visible) return;
    if (!res || !res.ok) { if (card) card.classList.remove('closing'); return; }

    S.tabs = S.tabs.filter(t => t.id !== tab.id);
    cards.delete('t' + tab.id);
    shotCache.delete(tab.id);
    const pos = S.items.indexOf(tab);
    if (pos !== -1 && pos < S.selected) S.selected -= 1;
    if (S.mode === 'tabs' && S.savedSelection > pos) S.savedSelection -= 1;
    if (!S.tabs.length) { hide(); return; }
    refresh();
  }

  // -------------------------------------------------------------------------
  // DOM
  // -------------------------------------------------------------------------

  function currentTheme() {
    if (settings.theme === 'light' || settings.theme === 'dark') return settings.theme;
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function buildUI() {
    if (ui) ui.host.remove();

    const host = document.createElement('vts-switcher-root');
    host.setAttribute('style', 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;display:block!important');
    const root = host.attachShadow({ mode: 'closed' });

    const style = el('style');
    style.textContent = CSS;

    const overlay = el('div', 'overlay ' + currentTheme());
    overlay.tabIndex = -1;
    // Style settings
    overlay.classList.add('dim-' + settings.dim, 'corners-' + settings.corners);
    if (settings.animations === false) overlay.classList.add('no-anim'); // appears instantly, nothing moves
    if (settings.translucent) {
      overlay.classList.add('translucent');
      overlay.style.setProperty('--alpha', String(settings.panelOpacity / 100));
    }
    overlay.style.setProperty('--accent', settings.highlightColor);
    overlay.style.setProperty('--gap', L.gap + 'px');
    overlay.style.setProperty('--fade', L.fade + 'px');

    const panel = el('div', 'panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Tab switcher');

    const search = el('div', 'search');
    const input = el('input', 'input');
    input.type = 'text';
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.setAttribute('aria-label', 'Search');
    const count = el('span', 'count');
    const chip = el('span', 'chip');
    const searchIcon = el('span', 'search-icon');
    searchIcon.append(svg(ICON_SEARCH, 16, 1.4));
    // Grey inline completion behind the text box ("/wo" + "rk/").
    const field = el('div', 'field');
    const ghost = el('div', 'ghost');
    ghost.hidden = true;
    const ghostTyped = el('span', 'ghost-typed');
    const ghostRest = el('span', 'ghost-rest');
    const ghostKey = el('kbd', 'ghost-key', 'Tab');
    ghost.append(ghostTyped, ghostRest, ghostKey);
    field.append(ghost, input);
    search.append(searchIcon, field, count, chip);

    const strip = el('div', 'strip');
    strip.setAttribute('role', 'listbox');

    const empty = el('div', 'empty');
    empty.hidden = true;
    const emptyIcon = el('span', 'empty-icon');
    emptyIcon.append(svg(ICON_EMPTY, 28, 1.2));
    const emptyText = el('span', 'empty-text');
    empty.append(emptyIcon, emptyText);

    const caption = el('div', 'caption');
    const capTitle = el('div', 'cap-title');
    const capSubRow = el('div', 'cap-sub-row');
    const capSub = el('span', 'cap-sub');
    const capPos = el('span', 'cap-pos');
    capSubRow.append(capSub, capPos);
    caption.append(capTitle, capSubRow);

    const hints = el('div', 'hints');
    hints.hidden = !settings.showHints; // "Show keyboard hints" setting
    hintsKey = '';

    panel.append(search, strip, empty, caption, hints);
    overlay.append(panel);
    root.append(style, overlay);

    const cardOf = target => {
      const c = target.closest('.card');
      return c && c._idx !== undefined ? c : null;
    };

    // Hover is pure CSS. Selection never follows the mouse.
    overlay.addEventListener('mousedown', e => {
      if (e.target === overlay) { e.preventDefault(); hide(); return; }
      if (e.target !== input) e.preventDefault(); // keep focus in the search box, no autoscroll
    });
    strip.addEventListener('click', e => {
      const card = cardOf(e.target);
      if (!card) return;
      if (e.target.closest('.close')) closeTabAt(card._idx);
      else activate(S.items[card._idx]);
    });
    strip.addEventListener('auxclick', e => {
      const card = e.button === 1 && cardOf(e.target);
      if (card) { e.preventDefault(); closeTabAt(card._idx); }
    });
    // Mouse wheel: the grid scrolls normally (down); the single row scrolls sideways.
    strip.addEventListener('wheel', e => {
      if (strip.classList.contains('grid') || strip.scrollWidth <= strip.clientWidth) return;
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        strip.scrollLeft += e.deltaY;
      }
    }, { passive: false });
    strip.addEventListener('scroll', onStripScroll, { passive: true });
    overlay.addEventListener('mousemove', e => {
      // Missed the modifier's keyup (focus was elsewhere): stay open instead.
      if (S.held && !e.altKey && !e.ctrlKey && !e.metaKey) { S.held = false; updateHints(); }
    }, { passive: true });
    overlay.addEventListener('wheel', e => { if (!strip.contains(e.target)) e.preventDefault(); }, { passive: false });
    overlay.addEventListener('contextmenu', e => e.preventDefault());
    input.addEventListener('input', () => {
      S.query = input.value;
      S.selected = 0;
      strip.scrollLeft = 0;
      strip.scrollTop = 0;
      refresh();
    });

    const stop = e => e.stopPropagation();
    for (const type of ['click', 'dblclick', 'auxclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup',
      'contextmenu', 'wheel', 'input', 'beforeinput', 'focusin', 'focusout', 'paste', 'copy', 'cut']) {
      host.addEventListener(type, stop);
    }

    document.documentElement.appendChild(host);
    ui = { host, root, overlay, panel, input, strip, empty, emptyText, hints, count, chip, capTitle, capSub, capPos,
      ghost, ghostTyped, ghostRest, selectedCard: null };
  }

  // -------------------------------------------------------------------------
  // Keyboard
  // -------------------------------------------------------------------------

  const isPrimaryModifier = key => key === 'Alt' || key === 'Control' || key === 'Meta';
  const sameKey = (a, b) => a.length === b.length && a.toLowerCase() === b.toLowerCase();

  // Called by content.js only while the overlay is open: the page never sees
  // the keyboard. Stopping propagation doesn't cancel the default action, so
  // typing in our search box still works.
  function onKeyDown(e) {
    e.stopImmediatePropagation();
    handleOverlayKey(e);
  }

  function handleOverlayKey(e) {
    const key = e.key;
    const searching = S.mode !== 'tabs';
    const altGr = e.getModifierState && e.getModifierState('AltGraph');
    const plain = !e.metaKey && ((!e.ctrlKey && !e.altKey) || altGr);
    // Function-key hotkeys work while Alt is still held (Alt+Q, then F2).
    const hotkeyOk = !e.ctrlKey && !e.metaKey;

    if (key === 'Escape') {
      e.preventDefault();
      if (searching && S.entry === 'tabs') setMode('tabs');
      else hide();
      return;
    }
    if (hotkeyOk && sameKey(key, settings.searchHotkey)) { e.preventDefault(); toggleMode('search'); return; }
    if (hotkeyOk && sameKey(key, settings.bookmarksHotkey)) { e.preventDefault(); toggleMode('bookmarks'); return; }

    switch (key) {
      case 'Tab':
        e.preventDefault();
        if (!e.shiftKey && S.completion) acceptCompletion(S.completion); // fill in the folder name
        else move(e.shiftKey ? -1 : 1);
        return;
      case 'ArrowRight': e.preventDefault(); move(1); return;
      case 'ArrowLeft': e.preventDefault(); move(-1); return;
      case 'ArrowDown': e.preventDefault(); moveRow(1); return;
      case 'ArrowUp': e.preventDefault(); moveRow(-1); return;
      case 'PageDown':
        e.preventDefault();
        if (searching) moveRow(S.rows || 1); else moveTo(S.items.length - 1); // grid: one screen down
        return;
      case 'PageUp':
        e.preventDefault();
        if (searching) moveRow(-(S.rows || 1)); else moveTo(0);
        return;
      case 'End': case 'Home':
        if (searching) break; // move the text cursor in the search box
        e.preventDefault();
        moveTo(key === 'End' ? S.items.length - 1 : 0);
        return;
      case 'Enter':
        e.preventDefault();
        if (e.repeat || e.isComposing) return;
        // Typing "/wo" + Enter fills in the folder. Without a leading "/",
        // Enter still opens the selected bookmark unless the folder is selected.
        if (S.completion && (bookmarkQuery().slash || S.items[S.selected] === S.completion.folder)) {
          acceptCompletion(S.completion);
        } else {
          activate(S.items[S.selected]);
        }
        return;
    }

    if (!searching) {
      if (key === 'Delete' && plain) { e.preventDefault(); closeTabAt(S.selected); return; }
      if (key === 'Home') { e.preventDefault(); moveTo(0); return; }
      if (key === 'End') { e.preventDefault(); moveTo(S.items.length - 1); return; }
      if (plain && key.length === 1 && key !== ' ' && !e.isComposing) {
        e.preventDefault();
        setMode('search', { text: key });
        return;
      }
      if (!isPrimaryModifier(key) && key !== 'Shift') e.preventDefault();
      return;
    }

    if (ui && ui.root.activeElement !== ui.input) ui.input.focus({ preventScroll: true });
  }

  function onKeyUp(e) {
    const primary = isPrimaryModifier(e.key);
    e.stopImmediatePropagation();
    if (primary) e.preventDefault(); // don't let Alt focus the browser menu
    if (S.held && primary && !e.altKey && !e.ctrlKey && !e.metaKey) {
      S.held = false;
      if (S.mode === 'tabs') activate(S.items[S.selected]);
      else updateHints();
    }
  }

  function onKeyPress(e) {
    if (S.visible) e.stopImmediatePropagation();
  }

  function onBlur() {
    hide({ restoreFocus: false });
  }

  function onVisibility() {
    if (document.hidden) hide({ restoreFocus: false });
  }

  let resizeTimer = 0;
  function onResize() {
    if (!S.visible) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(refresh, 80); // capacity may change with the window size
  }

  // -------------------------------------------------------------------------
  // Styles — Windows 11 / macOS inspired. Inlined: nothing fetched per page.
  // -------------------------------------------------------------------------

  const CSS = `
:host{all:initial}
*,*::before,*::after{box-sizing:border-box}
[hidden]{display:none!important}

.overlay{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
  background:var(--scrim);color:var(--text);outline:none;cursor:default;user-select:none;
  font:400 13px/1.4 "Segoe UI Variable Text","Segoe UI",-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",system-ui,sans-serif;
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;animation:vts-fade .12s ease-out}

.dark{--scrim:rgba(0,0,0,.42);--surface:32,32,32;--surface-hi:42,42,42;--layer:rgba(255,255,255,.045);
  --stroke:rgba(255,255,255,.075);--stroke-hi:rgba(255,255,255,.13);--edge:rgba(255,255,255,.06);
  --text:#fff;--text-2:rgba(255,255,255,.76);--text-3:rgba(255,255,255,.52);
  --hover:rgba(255,255,255,.06);--thumb:#2c2c2c;--glow:rgba(255,255,255,.09);
  --shadow:0 40px 90px rgba(0,0,0,.55),0 10px 28px rgba(0,0,0,.4)}
.light{--scrim:rgba(0,0,0,.2);--surface:249,249,249;--surface-hi:255,255,255;--layer:rgba(0,0,0,.028);
  --stroke:rgba(0,0,0,.075);--stroke-hi:rgba(0,0,0,.14);--edge:rgba(255,255,255,.9);
  --text:#1a1a1a;--text-2:rgba(0,0,0,.7);--text-3:rgba(0,0,0,.5);
  --hover:rgba(0,0,0,.045);--thumb:#ebebeb;--glow:rgba(255,255,255,.28);
  --shadow:0 40px 90px rgba(0,0,0,.24),0 10px 28px rgba(0,0,0,.12)}

/* ---- Style settings ---- */
/* Background dim */
.dim-none{--scrim:transparent}
.dark.dim-light{--scrim:rgba(0,0,0,.2)}  .light.dim-light{--scrim:rgba(0,0,0,.08)}
.dark.dim-strong{--scrim:rgba(0,0,0,.66)} .light.dim-strong{--scrim:rgba(0,0,0,.42)}
/* Corner style */
.overlay{--r-panel:16px;--r-card:12px;--r-thumb:8px;--r-ctl:8px}
.corners-square{--r-panel:6px;--r-card:4px;--r-thumb:2px;--r-ctl:4px}
.corners-round{--r-panel:24px;--r-card:18px;--r-thumb:12px;--r-ctl:12px}

.panel{display:flex;flex-direction:column;width:var(--panel-w);max-width:calc(100vw - 32px);padding:16px;
  border-radius:var(--r-panel);
  background:linear-gradient(180deg,rgba(var(--surface-hi),var(--alpha,1)),rgba(var(--surface),var(--alpha,1)) 64px);
  border:1px solid var(--stroke);box-shadow:var(--shadow),inset 0 1px 0 var(--edge);
  animation:vts-pop .18s cubic-bezier(.16,1,.3,1)}
/* Translucent (acrylic / vibrancy): see-through, blurred panel */
.translucent .panel{-webkit-backdrop-filter:blur(30px) saturate(160%);backdrop-filter:blur(30px) saturate(160%)}
.translucent .thumb{background:rgba(128,128,128,.14)}
.translucent .search{background:rgba(128,128,128,.12)}

/* Search box (Windows 11 text field) */
.search{display:none;align-items:center;gap:10px;height:40px;margin-bottom:14px;padding:0 6px 0 12px;
  border-radius:var(--r-ctl);background:var(--layer);border:1px solid var(--stroke);box-shadow:inset 0 -2px 0 var(--accent);color:var(--text-3)}
.searching .search{display:flex}
.search-icon{display:inline-flex;color:var(--text-2)}
.input{all:unset;position:relative;z-index:1;flex:1;min-width:0;height:100%;font:inherit;font-size:14px;color:var(--text);caret-color:var(--accent);user-select:text}
.input::placeholder{color:var(--text-3)}
.field{position:relative;flex:1;min-width:0;height:100%;display:flex;align-items:center}
.ghost{position:absolute;inset:0;display:flex;align-items:center;gap:0;font-size:14px;white-space:pre;overflow:hidden;pointer-events:none}
.ghost-typed{visibility:hidden}
.ghost-rest{color:var(--text-3)}
.ghost-key{margin-left:8px;height:18px;min-width:0;font-size:10px}
.count{font-size:12px;color:var(--text-3);white-space:nowrap;font-variant-numeric:tabular-nums}
.chip{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border-radius:6px;font-size:12px;font-weight:500;
  color:var(--text-2);background:var(--hover);border:1px solid var(--stroke);white-space:nowrap;max-width:240px;overflow:hidden;text-overflow:ellipsis}
.chip::before{content:"";flex:none;width:6px;height:6px;border-radius:50%;background:var(--accent)}

/* One-row strip */
.strip{position:relative;display:flex;gap:var(--gap);justify-content:safe center;margin:-8px;padding:8px;
  overflow-x:auto;overflow-y:hidden;overscroll-behavior:contain;scrollbar-width:none}
.strip::-webkit-scrollbar{display:none}
.strip.grid{display:grid;grid-template-columns:repeat(var(--cols),var(--w));justify-content:center;align-content:start;
  max-height:var(--grid-h);overflow:hidden auto;-webkit-mask-image:none;mask-image:none}
.strip.grid.fade-t{-webkit-mask-image:linear-gradient(180deg,transparent,#000 var(--fade));mask-image:linear-gradient(180deg,transparent,#000 var(--fade))}
.strip.grid.fade-b{-webkit-mask-image:linear-gradient(0deg,transparent,#000 var(--fade));mask-image:linear-gradient(0deg,transparent,#000 var(--fade))}
.strip.grid.fade-t.fade-b{-webkit-mask-image:linear-gradient(180deg,transparent,#000 var(--fade),#000 calc(100% - var(--fade)),transparent);
  mask-image:linear-gradient(180deg,transparent,#000 var(--fade),#000 calc(100% - var(--fade)),transparent)}
.strip.fade-l{-webkit-mask-image:linear-gradient(90deg,transparent,#000 var(--fade));mask-image:linear-gradient(90deg,transparent,#000 var(--fade))}
.strip.fade-r{-webkit-mask-image:linear-gradient(270deg,transparent,#000 var(--fade));mask-image:linear-gradient(270deg,transparent,#000 var(--fade))}
.strip.fade-l.fade-r{-webkit-mask-image:linear-gradient(90deg,transparent,#000 var(--fade),#000 calc(100% - var(--fade)),transparent);
  mask-image:linear-gradient(90deg,transparent,#000 var(--fade),#000 calc(100% - var(--fade)),transparent)}

/* Cards */
.card{position:relative;flex:none;display:flex;flex-direction:column;gap:8px;width:var(--w);padding:8px;border-radius:var(--r-card);
  transition:background-color .12s ease,opacity .15s ease}
.card.bottom{flex-direction:column-reverse}
.card:hover{background:var(--hover)}
.card:hover .thumb::after{opacity:1}
.card:hover .close{opacity:1;pointer-events:auto}
.card.sel{background:var(--hover);box-shadow:0 0 0 2px var(--accent),0 0 0 5px color-mix(in srgb,var(--accent) 24%,transparent)}
.card.closing{opacity:.3;pointer-events:none}

.head{display:flex;align-items:center;gap:8px;height:24px;padding-left:4px}
.fav{flex:none;width:16px;height:16px;border-radius:3px;object-fit:contain}
.title{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:12.5px;color:var(--text)}
.flag{flex:none;display:inline-flex;color:var(--text-3)}
.close{all:unset;flex:none;display:grid;place-items:center;width:24px;height:24px;border-radius:6px;color:var(--text-2);
  opacity:0;pointer-events:none;transition:opacity .1s ease,background-color .1s ease,color .1s ease}
.close:hover{background:#c42b1c;color:#fff}
.close:active{background:#a32315;color:#fff}

.thumb{position:relative;height:var(--th);border-radius:var(--r-thumb);overflow:hidden;background:var(--thumb);box-shadow:inset 0 0 0 1px var(--stroke)}
.thumb::after{content:"";position:absolute;inset:0;border-radius:inherit;background:var(--glow);opacity:0;transition:opacity .12s ease;pointer-events:none}
.shot{display:block;width:100%;height:100%;object-fit:cover;object-position:top}
.ph{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:12px;text-align:center;color:var(--text-3)}
.ph-tile{display:grid;place-items:center;width:48px;height:48px;border-radius:12px;background:var(--layer);border:1px solid var(--stroke)}
.ph-icon{width:28px;height:28px;object-fit:contain}
.ph-text{max-width:100%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:11.5px}
.ph-text.sub{font-size:10.5px;opacity:.85}
/* Small cards (2–3 rows, search grid): shrink the placeholder so nothing gets clipped */
.thumb{container-type:size}
@container (max-height:120px){.ph{gap:5px;padding:6px}.ph-tile{width:34px;height:34px;border-radius:9px}.ph-icon{width:20px;height:20px}.ph-text.sub{display:none}}
@container (max-height:70px){.ph-text{display:none}}
.badge{position:absolute;left:8px;top:8px;z-index:1;padding:2px 8px;border-radius:99px;font-size:10.5px;font-weight:600;
  color:#fff;background:rgba(20,20,20,.72);border:1px solid rgba(255,255,255,.14)}
.folder-icon{display:inline-flex;align-items:center;justify-content:center;color:#e8b339}
.folder-tile{color:#e8b339;background:color-mix(in srgb,#e8b339 14%,transparent);border-color:color-mix(in srgb,#e8b339 30%,transparent)}
.badge.win{display:inline-flex;align-items:center;gap:5px;background:color-mix(in srgb,var(--accent) 78%,#000);border-color:rgba(255,255,255,.22)}
mark{color:inherit;background:color-mix(in srgb,var(--accent) 42%,transparent);border-radius:3px;padding:0 1px}

/* Empty state */
.empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;height:var(--card-h);color:var(--text-3)}
.empty-icon{display:inline-flex;opacity:.7}

/* Caption: full title of the selected tab, like macOS */
.caption{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;height:42px;margin-top:12px;text-align:center;min-width:0}
.cap-title{max-width:100%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:14px;font-weight:600;letter-spacing:-.005em}
.cap-sub-row{display:flex;gap:10px;max-width:100%;font-size:12px;color:var(--text-3)}
.cap-sub{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.cap-pos{flex:none;font-variant-numeric:tabular-nums}
.cap-pos:empty{display:none}

/* Keyboard hints */
.hints{display:flex;flex-wrap:wrap;justify-content:center;gap:6px 18px;margin-top:12px;padding-top:12px;border-top:1px solid var(--stroke);
  font-size:11.5px;color:var(--text-3)}
.hint{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
kbd{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:20px;padding:0 6px;border-radius:5px;
  font:500 11px/1 inherit;color:var(--text-2);background:var(--layer);border:1px solid var(--stroke-hi);border-bottom-width:2px}

@keyframes vts-fade{from{opacity:0}}
@keyframes vts-pop{from{opacity:0;transform:scale(.97)}}
/* Animations off: absolutely nothing animates or transitions */
.no-anim,.no-anim *,.no-anim *::before,.no-anim *::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}
@media (prefers-reduced-motion:reduce){.overlay,.panel{animation:none}.card,.close,.thumb::after{transition:none}}
`;

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  function cycle(direction) {
    if (!S.visible) return false;
    move(direction === 'backward' ? -1 : 1);
    return true;
  }

  function destroy() {
    if (ui) ui.host.remove();
    ui = null;
    S.visible = false;
  }

  return {
    get visible() { return S.visible; },
    openSwitcher, openDirect, cycle, applyShots,
    settingsChanged: applySettings,
    onKeyDown, onKeyUp, onKeyPress, onBlur, onVisibility, onResize,
    destroy
  };
}
