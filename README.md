<div align="center">
    <img src="icons/icon128.png"/>
    <h1>Visual Tab Switcher</h1>
    <p>
       Switch tabs like Alt+Tab on Windows: visual previews, instant search and bookmark search
    </p>
</div>

## Downloads
> [!NOTE]
> Extension is still under Development, please report any Bugs
> [Chrome Webstore](SOON)
> [Edge Addons](SOON)

## Install (developer mode)
1. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder.
3. Optional: change shortcuts at `chrome://extensions/shortcuts`.

## How it works
| Action | Keys / mouse |
| --- | --- |
| Open switcher, next tab | `Alt+Q` (keep holding `Alt`, press `Q` again to move) |
| Previous tab | `Alt+Shift+Q` |
| Switch to selected tab | Release `Alt`, or `Enter`, or click a tab |
| Move selection | `Tab` / `Shift+Tab`, `←` / `→`, mouse wheel scrolls the row |
| Close tab | Hover and click ✕, middle-click, or `Delete` on the selected tab |
| Search tabs in this window | `Alt+Q` then `F2` (you can still be holding `Alt`), or just start typing |
| Search tabs in all windows | `F2` on any page |
| Search / bookmark grid | `F2` and `F4` fill the screen with rows of cards and scroll for more (mouse wheel, `↑` `↓`, `PageUp` `PageDown`) |
| Search bookmarks | `F4` shows your bookmark bar in its own order; folders are cards (Enter opens them) |
| Bookmark folders | Type the start of a folder name, `Tab` or `Enter` completes it (`/wo` → `/Work/`); `/Work/report` searches inside a folder |
| Cancel | `Esc` or click outside |

Hovering a tab only highlights it and reveals its ✕; the selection moves only with the keyboard, just like the Windows task switcher.
A quick tap of `Alt+Q` jumps straight back to the previous tab.

> On Windows, `Alt+Tab` itself is reserved by the OS, so while holding `Alt` use `Q` to move forward. `Tab` works once the modifier is released (or with a non-Alt shortcut).

## Make it yours
Settings → Tab Switcher → **Style** has a live preview and lets you choose a translucent (frosted glass) panel with adjustable opacity, blur the page behind, background dim, corner style (square / rounded / extra round) and animations. Theme, accent color, card size and keyboard hints are under Appearance and Display.

## Bookmark Search
Search bookmarks with ease instead of clicking through 100 folders manually. Press a single hotkey, type a few letters, and instantly open any saved bookmark.
