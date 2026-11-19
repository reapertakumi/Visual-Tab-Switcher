'use strict';

// First-time setup. Every choice is saved immediately (same storage as
// Settings), so closing the page at any point keeps what was picked.

const SETTINGS_KEY = 'tabSwitcherSettings';
const DEFAULTS = {
  maxTabs: 'auto',
  showPreviews: true,
  showHints: true,
  previewScale: 100,
  hideInternalPages: false,
  theme: 'system',
  highlightColor: '#3b82f6',
  tabTitleLayout: 'header',
  searchHotkey: 'F2',
  directSearch: true,
  bookmarksHotkey: 'F4',
  directBookmarks: true,
  translucent: false,
  panelOpacity: 75,
  dim: 'medium',
  corners: 'medium',
  animations: true,
  previewRefresh: 30
};
const HOTKEYS = ['F1', 'F2', 'F3', 'F4', 'F6', 'F7', 'F8', 'F9', 'F10', 'F12'];
const ACCENTS = [
  ['#3b82f6', 'Blue'], ['#0078d4', 'Windows blue'], ['#8b5cf6', 'Purple'], ['#ec4899', 'Pink'],
  ['#ef4444', 'Red'], ['#f59e0b', 'Orange'], ['#10b981', 'Green'], ['#14b8a6', 'Teal'], ['#e5e5e5', 'White']
];
const STEPS = ['welcome', 'switch', 'search', 'style', 'previews', 'done'];

const $ = id => document.getElementById(id);
let settings = { ...DEFAULTS };
let step = 0;

// ---------------------------------------------------------------- settings

async function load() {
  try {
    const stored = (await chrome.storage.sync.get(SETTINGS_KEY))[SETTINGS_KEY] || {};
    settings = { ...DEFAULTS, ...stored };
  } catch (_) { /* defaults */ }
}

function save(patch) {
  settings = { ...settings, ...patch };
  chrome.storage.sync.set({ [SETTINGS_KEY]: settings }).catch(() => {});
  render();
}

function isDark() {
  return settings.theme === 'dark' ||
    (settings.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
}

// ---------------------------------------------------------------- rendering

function render() {
  document.body.classList.toggle('dark', isDark());
  document.documentElement.style.setProperty('--accent', settings.highlightColor);

  // Keys shown throughout the page
  for (const id of ['searchKeyCap', 'searchKeyInline', 'sumSearch']) $(id).textContent = settings.searchHotkey;
  for (const id of ['bookmarksKeyCap', 'bookmarksKeyInline', 'sumBookmarks']) $(id).textContent = settings.bookmarksHotkey;
  $('searchHotkey').value = settings.searchHotkey;
  $('bookmarksHotkey').value = settings.bookmarksHotkey;
  $('directSearch').checked = !!settings.directSearch;
  $('directBookmarks').checked = !!settings.directBookmarks;
  $('translucent').checked = !!settings.translucent;
  $('showPreviews').checked = settings.showPreviews !== false;

  document.querySelectorAll('.tiles[data-setting]').forEach(group => {
    const value = String(settings[group.dataset.setting]);
    group.querySelectorAll('.tile').forEach(t => {
      const on = t.dataset.value === value;
      t.classList.toggle('on', on);
      t.setAttribute('aria-pressed', on);
    });
  });
  document.querySelectorAll('.swatch').forEach(s => s.classList.toggle('on', s.dataset.value === settings.highlightColor));
  renderPreview();
}

// Mini switcher that mirrors theme, accent, layout and translucency.
function renderPreview() {
  const rows = settings.maxTabs === 'auto3' ? 3 : settings.maxTabs === 'auto2' ? 2 : 1;
  const cols = rows === 1 ? 3 : 4;
  const colors = ['#94a3b8', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#0ea5e9', '#ec4899', '#14b8a6', '#eab308', '#6366f1', '#22c55e', '#f97316'];
  const grid = $('pvGrid');
  const cardW = rows === 1 ? 76 : rows === 2 ? 58 : 46;
  grid.style.gridTemplateColumns = `repeat(${cols}, ${cardW}px)`;
  grid.replaceChildren();
  for (let i = 0; i < rows * cols; i++) {
    const card = document.createElement('div');
    card.className = 'pv-card' + (i === 1 ? ' sel' : '');
    const thumb = document.createElement('i');
    thumb.style.background = `linear-gradient(160deg, rgba(255,255,255,.55) 0 28%, ${colors[i % colors.length]} 28%)`;
    thumb.style.height = (rows === 1 ? 42 : rows === 2 ? 30 : 22) + 'px';
    card.append(document.createElement('b'), thumb);
    grid.append(card);
  }
  const pv = $('pv');
  const dark = isDark();
  pv.style.setProperty('--pv-bg', dark ? '36,36,36' : '249,249,249');
  pv.style.setProperty('--pv-mute', dark ? 'rgba(255,255,255,.3)' : 'rgba(0,0,0,.2)');
  pv.style.setProperty('--pv-a', settings.translucent ? '0.72' : '1');
  pv.classList.toggle('translucent', !!settings.translucent);
}

function showStep(i) {
  step = Math.max(0, Math.min(STEPS.length - 1, i));
  document.querySelectorAll('.step').forEach(s => s.classList.toggle('on', s.dataset.step === STEPS[step]));
  const dots = $('dots');
  dots.replaceChildren(...STEPS.map((_, k) => {
    const d = document.createElement('i');
    if (k === step) d.className = 'on'; else if (k < step) d.className = 'done';
    return d;
  }));
  const last = step === STEPS.length - 1;
  $('back').hidden = step === 0;
  $('skip').hidden = last;
  $('openSettings').hidden = !last;
  $('next').textContent = step === 0 ? 'Get started' : last ? 'Start browsing' : 'Next';
  try { sessionStorage.setItem('setupStep', String(step)); } catch (_) {}
  $('next').focus({ preventScroll: true });
}

// ---------------------------------------------------------------- shortcuts

async function loadShortcuts() {
  try {
    const cmds = await chrome.commands.getAll();
    const sc = (cmds.find(c => c.name === 'toggle-tab-switcher') || {}).shortcut || '';
    const label = sc || 'Not set';
    for (const id of ['shortcutKey', 'shortcutInline', 'sumSwitch']) $(id).textContent = label;
    $('shortcutHint').innerHTML = sc
      ? 'Open the switcher / next tab'
      : '<span class="warn">No shortcut is set (another extension may use Alt+Q). Click Change to pick one.</span>';
    // Animate the real keys of the shortcut (e.g. "Alt" + "Q")
    const parts = sc ? sc.split('+') : ['Alt', 'Q'];
    const mod = parts.slice(0, -1).join('+') || 'Alt';
    $('capAlt').textContent = mod;
    $('capRel').textContent = mod;
    $('capQ').textContent = parts[parts.length - 1];
  } catch (_) { /* ignore */ }
}

function openShortcutsPage() {
  const isEdge = navigator.userAgent.includes('Edg/');
  chrome.tabs.create({ url: isEdge ? 'edge://extensions/shortcuts' : 'chrome://extensions/shortcuts' });
}

// Looping "Hold Alt → tap Q → release" animation.
function animateKeys() {
  const frames = [
    ['capAlt', 'seq1'], ['capAlt', 'capQ', 'seq2'], ['capAlt', 'seq2'], ['capAlt', 'capQ', 'seq2'], ['capAlt', 'seq2'], ['seq3'], []
  ];
  let f = 0;
  setInterval(() => {
    if (STEPS[step] !== 'switch') return;
    const on = new Set(frames[f]);
    ['capAlt', 'capQ'].forEach(id => $(id).classList.toggle('down', on.has(id)));
    $('capRel').classList.toggle('down', false);
    ['seq1', 'seq2', 'seq3'].forEach(id => $(id).classList.toggle('on', on.has(id)));
    f = (f + 1) % frames.length;
  }, 650);
}

// ---------------------------------------------------------------- "try it"

// The switcher is drawn right on this page: notice when it appears.
function watchOverlay() {
  const mark = (id, text) => {
    const box = $(id), status = $(id + 'Status');
    box.classList.add('ok');
    status.classList.add('ok');
    status.querySelector('span').textContent = text;
  };
  new MutationObserver(() => {
    if (!document.querySelector('vts-switcher-root')) return;
    if (STEPS[step] === 'switch') mark('trySwitch', 'You did it!');
    if (STEPS[step] === 'search') mark('trySearch', 'Nice!');
  }).observe(document.documentElement, { childList: true });
}

// ---------------------------------------------------------------- capture all

function setupCapture() {
  let lastTotal = 0;
  const show = ({ running, done, total }) => {
    $('capProgress').hidden = !running;
    $('capBar').style.width = total ? `${Math.round((done / total) * 100)}%` : '0';
    $('capBtn').textContent = running ? 'Stop' : 'Capture all';
    const t = $('capText');
    t.classList.toggle('ok', !running && done > 0);
    t.textContent = running ? `${done} / ${total}` : done ? `Done · ${done} tabs` : '';
  };
  $('capBtn').addEventListener('click', async () => {
    const s = await chrome.runtime.sendMessage({ action: 'captureAllStatus' }).catch(() => null);
    chrome.runtime.sendMessage({ action: s && s.running ? 'captureAllStop' : 'captureAll' }).catch(() => {});
  });
  chrome.runtime.onMessage.addListener(msg => {
    if (!msg || msg.action !== 'captureProgress') return;
    if (msg.running) lastTotal = msg.total;
    show(msg.running ? msg : { running: false, done: lastTotal, total: lastTotal });
  });
}

// ---------------------------------------------------------------- wiring

document.addEventListener('DOMContentLoaded', async () => {
  for (const sel of [$('searchHotkey'), $('bookmarksHotkey')]) {
    for (const k of HOTKEYS) sel.append(new Option(k, k));
  }
  for (const [value, name] of ACCENTS) {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.dataset.value = value;
    b.title = name;
    b.setAttribute('aria-label', name);
    b.style.background = value;
    b.style.color = value;
    b.addEventListener('click', () => save({ highlightColor: value }));
    $('swatches').append(b);
  }

  // Opened after an update from a version without this setup: say what's new.
  if (new URLSearchParams(location.search).has('updated')) {
    document.title = "What's new in Visual Tab Switcher";
    $('welcomeTitle').textContent = 'Visual Tab Switcher got a big update';
    $('welcomeLead').textContent = 'Live previews from every window, instant tab search, bookmark folders and a whole new look. ' +
      'Take a minute to try it out. Your existing settings are kept.';
  }

  await load();
  render();
  loadShortcuts();
  animateKeys();
  watchOverlay();
  setupCapture();

  let start = 0;
  try { start = Number(sessionStorage.getItem('setupStep')) || 0; } catch (_) {}
  showStep(start);

  $('next').addEventListener('click', () => {
    if (step === STEPS.length - 1) finish();
    else showStep(step + 1);
  });
  $('back').addEventListener('click', () => showStep(step - 1));
  $('skip').addEventListener('click', finish);
  $('openSettings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  document.querySelectorAll('[data-open-shortcuts]').forEach(b => b.addEventListener('click', openShortcutsPage));

  document.querySelectorAll('.tiles[data-setting]').forEach(group => {
    group.addEventListener('click', e => {
      const tile = e.target.closest('.tile');
      if (tile) save({ [group.dataset.setting]: tile.dataset.value });
    });
  });
  $('translucent').addEventListener('change', e => save({ translucent: e.target.checked }));
  $('showPreviews').addEventListener('change', e => save({ showPreviews: e.target.checked }));
  $('directSearch').addEventListener('change', e => save({ directSearch: e.target.checked }));
  $('directBookmarks').addEventListener('change', e => save({ directBookmarks: e.target.checked }));
  const hotkey = (field, other) => e => {
    if (e.target.value === settings[other]) { e.target.value = settings[field]; return; } // can't use the same key twice
    save({ [field]: e.target.value });
  };
  $('searchHotkey').addEventListener('change', hotkey('searchHotkey', 'bookmarksHotkey'));
  $('bookmarksHotkey').addEventListener('change', hotkey('bookmarksHotkey', 'searchHotkey'));

  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadShortcuts(); });
});

// Mark setup as seen and close this tab.
async function finish() {
  try { await chrome.storage.local.set({ setupDone: true }); } catch (_) {}
  try { sessionStorage.removeItem('setupStep'); } catch (_) {}
  chrome.tabs.getCurrent(tab => {
    if (tab) chrome.tabs.remove(tab.id);
    else window.close();
  });
}
