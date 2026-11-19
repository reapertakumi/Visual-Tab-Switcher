'use strict';

const SETTINGS_KEY = 'tabSwitcherSettings';
const DEFAULTS = {
  maxTabs: 'auto',
  showPreviews: true,
  showHints: true,
  previewScale: 100,
  translucent: false,
  panelOpacity: 75,
  blurBackground: false,
  dim: 'medium',
  corners: 'medium',
  animations: true,
  hideInternalPages: false,
  theme: 'system',
  highlightColor: '#3b82f6',
  tabTitleLayout: 'header',
  searchHotkey: 'F2',
  directSearch: true,
  bookmarksHotkey: 'F4',
  directBookmarks: true
};
const HOTKEYS = ['F1', 'F2', 'F3', 'F4', 'F6', 'F7', 'F8', 'F9', 'F10', 'F12'];

const $ = id => document.getElementById(id);
let settings = { ...DEFAULTS };
let statusTimer = null;

function fillHotkeySelect(select) {
  for (const key of HOTKEYS) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = key;
    select.append(opt);
  }
}

function applyLook() {
  const dark = settings.theme === 'dark' ||
    (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.body.classList.toggle('dark', dark);
  document.documentElement.style.setProperty('--accent', settings.highlightColor);
  updatePreview(dark);
}

// Live preview of the switcher's style settings.
function updatePreview(dark) {
  const p = $('stylePreview');
  if (!p) return;
  p.className = 'preview';
  p.classList.add(dark ? 'dark' : 'light', 'dim-' + settings.dim, 'corners-' + settings.corners);
  if (settings.translucent) p.classList.add('translucent');
  if (settings.blurBackground) p.classList.add('blur-bg');
  if (settings.animations) p.classList.add('anim');
  p.style.setProperty('--pv-alpha', settings.translucent ? String(settings.panelOpacity / 100) : '1');
  const row = $('opacityRow');
  if (row) row.classList.toggle('disabled', !settings.translucent); // opacity only matters when translucent
}

function render() {
  $('theme').value = settings.theme;
  $('highlightColor').value = settings.highlightColor;
  if (!$('highlightColor').value) $('highlightColor').value = DEFAULTS.highlightColor;
  $('tabTitleLayout').value = settings.tabTitleLayout;
  $('maxTabs').value = String(settings.maxTabs);
  if (!$('maxTabs').value) $('maxTabs').value = 'auto';
  $('showPreviews').checked = !!settings.showPreviews;
  $('showHints').checked = settings.showHints !== false;
  $('translucent').checked = !!settings.translucent;
  $('panelOpacity').value = settings.panelOpacity;
  $('panelOpacityValue').textContent = `${settings.panelOpacity}%`;
  $('blurBackground').checked = !!settings.blurBackground;
  $('dim').value = settings.dim;
  $('corners').value = settings.corners;
  $('animations').checked = settings.animations !== false;
  $('previewScale').value = settings.previewScale;
  $('previewScaleValue').textContent = `${settings.previewScale}%`;
  $('hideInternalPages').checked = !!settings.hideInternalPages;
  $('searchHotkey').value = settings.searchHotkey;
  $('directSearch').checked = !!settings.directSearch;
  $('bookmarksHotkey').value = settings.bookmarksHotkey;
  $('directBookmarks').checked = !!settings.directBookmarks;
  applyLook();
}

function flash(text) {
  $('status').textContent = text;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { $('status').textContent = ''; }, 1800);
}

async function save(patch) {
  settings = { ...settings, ...patch };
  applyLook();
  try {
    await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
    flash('Saved');
  } catch (err) {
    flash('Could not save');
    console.error(err);
  }
}

async function loadShortcuts() {
  try {
    const commands = await chrome.commands.getAll();
    const byName = Object.fromEntries(commands.map(c => [c.name, c.shortcut || '']));
    $('shortcutForward').textContent = byName['toggle-tab-switcher'] || 'Not set';
    $('shortcutBackward').textContent = byName['toggle-tab-switcher-reverse'] || 'Not set';
    $('shortcutSearch').textContent = byName['search-mode'] || 'Not set';
    $('shortcutBookmarks').textContent = byName['bookmarks-mode'] || 'Not set';
  } catch (_) { /* ignore */ }
}

function openShortcutsPage() {
  const isEdge = navigator.userAgent.includes('Edg/');
  chrome.tabs.create({ url: isEdge ? 'edge://extensions/shortcuts' : 'chrome://extensions/shortcuts' });
}

document.addEventListener('DOMContentLoaded', async () => {
  fillHotkeySelect($('searchHotkey'));
  fillHotkeySelect($('bookmarksHotkey'));

  // Sidebar navigation
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i === item));
      document.querySelectorAll('.section').forEach(s => s.classList.toggle('active', s.id === item.dataset.section));
    });
  });

  // The "Change" buttons and the shortcut keys themselves (Alt+Q, …) open the browser's shortcuts page.
  document.querySelectorAll('[data-open-shortcuts]').forEach(btn => {
    btn.addEventListener('click', openShortcutsPage);
    btn.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openShortcutsPage(); }
    });
  });

  // Load
  try {
    const stored = (await chrome.storage.sync.get(SETTINGS_KEY))[SETTINGS_KEY] || {};
    settings = { ...DEFAULTS, ...stored };
    delete settings.tabSwitcherHotkey; // obsolete key from v0.1
    if (!HOTKEYS.includes(settings.searchHotkey)) settings.searchHotkey = DEFAULTS.searchHotkey;
    if (!HOTKEYS.includes(settings.bookmarksHotkey)) settings.bookmarksHotkey = DEFAULTS.bookmarksHotkey;
  } catch (_) { /* defaults */ }
  render();
  loadShortcuts();

  // Auto-save on change
  $('theme').addEventListener('change', e => save({ theme: e.target.value }));
  $('highlightColor').addEventListener('change', e => save({ highlightColor: e.target.value }));
  $('tabTitleLayout').addEventListener('change', e => save({ tabTitleLayout: e.target.value }));
  $('maxTabs').addEventListener('change', e => save({ maxTabs: e.target.value }));
  $('showPreviews').addEventListener('change', e => save({ showPreviews: e.target.checked }));
  $('showHints').addEventListener('change', e => save({ showHints: e.target.checked }));
  // Style
  $('translucent').addEventListener('change', e => save({ translucent: e.target.checked }));
  $('panelOpacity').addEventListener('input', e => {
    $('panelOpacityValue').textContent = `${e.target.value}%`;
    settings.panelOpacity = Number(e.target.value);
    applyLook(); // live preview while dragging
  });
  $('panelOpacity').addEventListener('change', e => save({ panelOpacity: Number(e.target.value) }));
  $('blurBackground').addEventListener('change', e => save({ blurBackground: e.target.checked }));
  $('dim').addEventListener('change', e => save({ dim: e.target.value }));
  $('corners').addEventListener('change', e => save({ corners: e.target.value }));
  $('animations').addEventListener('change', e => save({ animations: e.target.checked }));
  $('hideInternalPages').addEventListener('change', e => save({ hideInternalPages: e.target.checked }));
  $('directSearch').addEventListener('change', e => save({ directSearch: e.target.checked }));
  $('directBookmarks').addEventListener('change', e => save({ directBookmarks: e.target.checked }));
  $('previewScale').addEventListener('input', e => { $('previewScaleValue').textContent = `${e.target.value}%`; });
  $('previewScale').addEventListener('change', e => save({ previewScale: Number(e.target.value) }));

  const hotkeyChange = (field, other) => e => {
    const value = e.target.value;
    if (value === settings[other]) {
      flash('That key is already used');
      e.target.value = settings[field];
      return;
    }
    save({ [field]: value });
  };
  $('searchHotkey').addEventListener('change', hotkeyChange('searchHotkey', 'bookmarksHotkey'));
  $('bookmarksHotkey').addEventListener('change', hotkeyChange('bookmarksHotkey', 'searchHotkey'));

  // "Capture all previews now"
  const showCapture = ({ running, done, total }) => {
    $('captureProgress').hidden = !running;
    $('captureBar').style.width = total ? `${Math.round((done / total) * 100)}%` : '0';
    $('captureAll').textContent = running ? 'Stop' : 'Capture all';
    $('captureText').textContent = running ? `${done} / ${total}` : (total && done ? `Done · ${done} tabs` : '');
  };
  let lastTotal = 0;
  $('captureAll').addEventListener('click', async () => {
    const status = await chrome.runtime.sendMessage({ action: 'captureAllStatus' }).catch(() => null);
    if (status && status.running) chrome.runtime.sendMessage({ action: 'captureAllStop' });
    else chrome.runtime.sendMessage({ action: 'captureAll' });
  });
  chrome.runtime.onMessage.addListener(msg => {
    if (!msg || msg.action !== 'captureProgress') return;
    if (msg.running) lastTotal = msg.total;
    showCapture(msg.running ? msg : { running: false, done: lastTotal, total: lastTotal });
  });
  chrome.runtime.sendMessage({ action: 'captureAllStatus' }).then(s => s && s.running && showCapture(s)).catch(() => {});

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyLook);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadShortcuts(); });
});
