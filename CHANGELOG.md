# Changelog

All notable changes to Visual Tab Switcher are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/).

## [0.2.0] - Unreleased

A complete rewrite. Every part of the extension was rebuilt for speed, reliability and a modern look, and a lot of new features were added.

> [!IMPORTANT]
> **Updating from 0.1?** A short "What's new" setup opens once after the update. Your settings are kept. If *Previous tab* (<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>Q</kbd>) isn't assigned afterwards, set it at `chrome://extensions/shortcuts`. Tab counts that no longer exist (5, 7, 9, 11, 16 and 20) switch to **Auto**.

### Added

#### Switcher (<kbd>Alt</kbd>+<kbd>Q</kbd>)
- **Tabs from all windows** in one most-recently-used list. Tabs in another window get a **Window 2** badge, and the caption says *"In window 2"*. Switching to one brings its window to the front.
- **Hover feedback** like the Windows task switcher: hovering a card brightens it and reveals its ✕ without changing the selection.
- **Previous tab** shortcut: <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>Q</kbd>.
- **Quick tap**: tapping <kbd>Alt</kbd>+<kbd>Q</kbd> and releasing immediately jumps straight back to the previous tab.
- **Close tabs** from the switcher: click ✕, middle-click a card, or press <kbd>Delete</kbd>.
- **Caption** under the cards with the selected tab's full title, its address and its position (*"2 / 12"*), plus *"8 more, press F2 to search"* when not every tab fits.
- **Badges** on cards: *Current* (the tab you're on), pinned and playing-audio icons.
- **Layouts**: *Auto* (one row), *Auto · 2 rows* and *Auto · 3 rows*, with <kbd>↑</kbd> <kbd>↓</kbd> to move between rows.
- **Typing starts a search** once <kbd>Alt</kbd> is released.
- <kbd>Home</kbd>, <kbd>End</kbd>, <kbd>PageUp</kbd> and <kbd>PageDown</kbd> navigation.

#### Tab search (<kbd>F2</kbd>)
- Results in a **grid that fills the screen** and **scrolls** for more (mouse wheel, <kbd>↑</kbd> <kbd>↓</kbd>, <kbd>PageUp</kbd> <kbd>PageDown</kbd>), up to 150 results.
- Matches **titles and addresses**; every word must match. Matches are highlighted and ranked (title start, then word start, then anywhere, then address).
- <kbd>F2</kbd> **from the switcher searches the current window**, and works while still holding <kbd>Alt</kbd>. <kbd>F2</kbd> on a page searches all windows.
- Search box with a result count and a scope label (*This window* / *All windows* / *Bookmarks*).

#### Bookmark search (<kbd>F4</kbd>)
- Bookmarks shown **in bookmark-bar order**, followed by *Other bookmarks* and *Mobile bookmarks*.
- **Folder cards** with a folder icon, their name, bookmark count and location. <kbd>Enter</kbd> opens a folder.
- **Folder completion**: type the start of a folder name, see the rest in grey, press <kbd>Tab</kbd> (or <kbd>Enter</kbd>) to complete it (`/wo` → `/Work/`).
- **Folder syntax**: `/Work/` browses a folder, `/Work/report` searches inside it, `/Work/Reports/` goes into subfolders.

#### Previews
- **Capture all previews now** (Settings and setup): shows each open tab once to take its picture, then restores every window's tab, the focused window, the recent-tabs order and unloaded tabs. Includes a progress bar and Stop.
- Preview captured **when <kbd>Alt</kbd> is pressed**, so the tab you're leaving is always up to date.
- Previews refreshed when a single-page app changes its address and when a window regains focus.

#### Look and settings
- **Windows 11-inspired design** for the switcher, settings and setup, in light and dark.
- **Style** section with a **live preview**: theme, accent color (9 colors), keyboard hints on/off, title position, **translucent panel** (frosted glass) with opacity, background dim and corner style.
- **Guided first-time setup** (`welcome.html`): try <kbd>Alt</kbd>+<kbd>Q</kbd>, <kbd>F2</kbd> and <kbd>F4</kbd> on the page, choose keys, theme, accent and layout, and capture previews. Opens on install, once after updating from 0.1, and from Settings → *Run setup again*.
- Settings **save automatically**. Clicking a shortcut opens the browser's shortcuts page.
- **Reset extension** button in Settings: after a confirmation, restores all defaults, deletes saved previews and opens the setup as on first install.
- **Animations** setting: turn it off and the switcher appears instantly, with no fade, pop, hover transition or smooth scrolling.
- **Refresh previews** setting: every 10 seconds, 30 seconds (default) or minute.
- Optional **global shortcuts** for tab search and bookmark search (set at `chrome://extensions/shortcuts`), which also work while the address bar has focus.
- The switcher, <kbd>F2</kbd> and <kbd>F4</kbd> also work **on the extension's own pages** (Settings and setup).
- When a page can't show the switcher (`chrome://` pages, the Web Store), <kbd>Alt</kbd>+<kbd>Q</kbd> **jumps to the previous tab** instead of doing nothing.

### Changed
- **Selection only moves with the keyboard.** The mouse no longer changes the selection on hover.
- **Fixed card size**: a window with 2 tabs no longer gets huge cards, and the switcher shows only as many tabs as fit, so nothing is cut off.
- **Much faster opening**: the switcher opens with titles only and loads previews for the visible cards afterwards, instead of sending every screenshot at once.
- **Lighter on every page**: only a ~7 KB loader runs on each page (down from 64 KB). The switcher (`ui.js`) is loaded the first time you press <kbd>Alt</kbd>, <kbd>F2</kbd> or <kbd>F4</kbd> on that page, and settings are read once the page is idle.
- **Saved previews are no longer broadcast to every tab.** Pages now only listen for settings changes, so each capture is no longer copied into every open tab.
- **Less memory per tab**: previews shown in the switcher are freed 30 seconds after it closes, and at most 40 are kept per tab. The background keeps at most 60 in memory and reads the rest from storage when needed.
- **Fewer screenshots**: switching back to a tab or window, or pressing Alt on it, only takes a new preview if the page's address changed or the preview is older than the new **Refresh previews** setting.
- **Previews are stored one per tab** instead of as one big blob, so each capture writes about 20 KB instead of rewriting megabytes. Thumbnails are scaled to 480 px wide.
- Up to **200 previews** cached instead of 25, so large tab collections keep their previews.
- The background service worker wakes up faster: it only loads the recent-tabs order and a small preview index.
- Search typing is smoother: cards are reused and search text is prepared once per tab.
- *Tabs in the switcher* options are now **Auto, Auto · 2 rows, Auto · 3 rows, 4, 6, 8, 10 and 12**.
- Hotkey options are <kbd>F1</kbd> to <kbd>F12</kbd>; the non-working *Custom* option was removed.
- New store name: *Visual Tab Switcher: Tab Previews, Search & Bookmarks*, with a new description.

### Fixed
- **Previews were often missing.** Captures are now queued under Chrome's 2-per-second limit, retried when they fail, taken for pages that are still loading, and no longer dropped when switching tabs quickly.
- **A screenshot could be saved under the wrong tab** when switching during a capture.
- **The switcher could appear in its own previews.**
- **The preview cache could exceed the storage limit**, losing all previews.
- **The switcher could get stuck open** after a quick <kbd>Alt</kbd>+<kbd>Q</kbd> tap.
- **Keys reached the page while the switcher was open**, which could trigger shortcuts on sites like YouTube or Google Docs. The old fix also broke on pages with a strict Content Security Policy.
- **Bookmark favicons didn't load.** The old fallback also sent your bookmark domains to Google's favicon service; icons now come from the browser itself.
- **Switching to a tab in another window didn't bring that window to the front.**
- **Errors when the script was injected twice** (for example after an extension update).
- **The recent-tabs order could be lost** when the background service worker restarted.
- Fallback icons and text overflowed small cards in the 2- and 3-row layouts and search grids.
- An empty tab search in a new window was aligned to the left instead of centred.
- A synthetic keyboard event from browser autofill could cause an error.
- **Settings page**: it showed the wrong default shortcut (*Ctrl+Shift+Q* instead of *Alt+Q*), the *Custom* hotkey option did nothing, and it wrongly said changes needed a browser restart.

### Removed
- `tab-switcher.js`: an unused script that sent a message nothing listened to.
- `styles.css`: the switcher's styles are now built into `ui.js`.
- The `activeTab` permission (already covered by the existing site access). The new `favicon` permission is used for bookmark icons.
- Old preview and recent-tabs caches from 0.1 are deleted automatically on update.

## [0.1] - 2026-05-14

### Added
- First public version.
- Visual tab switcher with screenshot previews, opened with <kbd>Alt</kbd>+<kbd>Q</kbd>.
- Tab search and bookmark search with <kbd>F2</kbd> and <kbd>F4</kbd>.
- Settings page with theme, highlight color, number of tabs and preview options.

[0.2.0]: https://github.com/reapertakumi/Visual-Tab-Switcher/compare/40a337b...HEAD
[0.1]: https://github.com/reapertakumi/Visual-Tab-Switcher/tree/40a337b
