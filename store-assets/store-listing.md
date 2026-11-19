# Chrome Web Store listing

## Name (manifest "name", max 75 characters)
Visual Tab Switcher: Tab Previews, Search & Bookmarks

## Summary (manifest "description", max 132 characters)
Press Alt+Q to switch tabs with live previews, F2 to search every open tab and F4 to browse bookmarks. All from the keyboard.

## Category
Workflow & Planning (alternative: Tools)

## Description

Paste the text below into the store's Description field as plain text. The store doesn't render markdown, so the bullets and capital headings are part of the text.

```text
Tired of hunting for the right tab? See every tab. Switch in a keystroke.

Visual Tab Switcher shows your open tabs as live previews, so you can see exactly what's on each one before you switch. No more squinting at a row of tiny tab titles, no more guesswork, no more wasted clicks.

Hold Alt, tap Q, let go. You're there.


🗂 SWITCH TABS VISUALLY: ALT+Q
• Live previews of your most recently used tabs, newest first
• Tabs from all your windows in one place, clearly labelled "Window 2", "Window 3"…
• Keep holding Alt and tap Q to move, release Alt to switch
• A quick Alt+Q tap jumps straight back to your previous tab
• Hover a card to see its ✕ and close tabs without leaving the switcher
• One, two or three rows: you always see as many tabs as fit your screen

🔍 FIND ANY TAB INSTANTLY: F2
• Press F2 and type a few letters: titles and addresses are both searched
• Searches every window at once, with your matches highlighted
• From the switcher, F2 searches just the current window
• Results fill your screen in a grid. Scroll for more.

⭐ BOOKMARKS, FOLDER BY FOLDER: F4
Stop clicking through 100 folders. Press F4, type a few letters and open any bookmark.
• Bookmarks appear in the same order as your bookmark bar
• Folders show as cards: press Enter to open one
• Type the start of a folder name and press Tab to complete it: /wo → /Work/
• Search inside a folder: /Work/report

🎨 MAKE IT YOURS
• Light, dark or system theme and nine accent colors
• Frosted-glass translucent panel with adjustable opacity
• Corner style, background dim, card size and layout
• Live preview of every change in Settings
• A short guided setup when you install: try every shortcut right away

⚡ FAST AND PRIVATE
• Opens instantly and stays light on every page
• Previews are small thumbnails kept only on your computer
• No account, no tracking, no ads. Nothing ever leaves your browser.


⌨ SHORTCUTS
Alt+Q · Open the switcher / next tab
Alt+Shift+Q · Previous tab
F2 · Search tabs
F4 · Search bookmarks
Arrow keys · Move    Enter · Open    Delete · Close tab    Esc · Cancel
All shortcuts can be changed.

💡 Tip: Settings → "Capture all previews now" grabs a fresh preview of every open tab in one go.

Found a bug or have an idea? Open an issue on GitHub: github.com/reapertakumi/Visual-Tab-Switcher
```

## Single purpose (Privacy practices tab)
Lets users switch between, search and close their open browser tabs, and search their bookmarks, using a keyboard-driven visual switcher.

## Permission justifications (Privacy practices tab)
- tabs: read tab titles, addresses and icons to list, switch to and close tabs in the switcher.
- scripting: show the switcher on pages that were already open when the extension was installed or updated.
- storage: save your settings, the recent-tabs order and the preview thumbnails locally.
- bookmarks: read your bookmarks for bookmark search (read-only; bookmarks are never changed).
- favicon: show site icons on bookmark and tab cards.
- Host permission (<all_urls>): needed to draw the switcher on the page you're viewing and to capture the visible tab as a preview thumbnail. Page content is never read, stored or sent anywhere.

## Data usage
Does not collect or transmit any user data. All settings and thumbnails stay in the browser's local storage.
