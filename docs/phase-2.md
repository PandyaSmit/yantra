# Phase 2: Local board

Each project now has a working kanban board backed by SQLite: issues, labels, comments and attachments, with drag-and-drop by mouse or keyboard and an issue drawer for editing.

## Acceptance checks

| Check | Result |
| --- | --- |
| Create, edit, label, move, reorder and archive issues | ✅ Driven in the built app against a throwaway `YANTRA_HOME`, then confirmed with `board:list` / `issues:get`. Issues were created with `C`, the header button, the palette, and inline "Add issue" (Enter keeps the box open for the next one). In the drawer: edited the title, body (autosaved), priority and labels (created "export" inline), and posted a comment with Ctrl+Enter. Moved cards between columns, reordered within one, archived and unarchived. |
| Order survives a restart | ✅ Electron was killed and relaunched, and every column came back in the same order. A unit test does the same by reopening the DB file. |
| The whole flow works keyboard-only | ✅ Using real key events over the DevTools protocol: Tab to a card, Space to pick it up, arrows to move it, Space to drop it, Enter to open it. In the drawer: edit fields, Esc to close (focus returns to the card), Alt+← to go back, `/` to search, Ctrl+K and a key such as "YAN-5" to open an issue. A keyboard drop on In Progress opens the Start task dialog, and Esc puts the card back. |
| Unit tests for ordering math and column derivation | ✅ `src/shared/board.test.ts` covers `deriveColumn`, `positionBetween`, `needsRenormalize`, `checkMove` and `filterCards`. `src/main/board.test.ts` covers numbering (per project, numbers never reused), neighbour-based moves, renormalization (positions 1e-7 apart, and 60 inserts at the same spot), task locks, abandoned tasks, labels, comments, archive and attachments. 60 tests in total. |
| Every screen looks finished in light and dark, with an empty state | ✅ Checked in light and dark: board, drawer, New issue, Labels, palette. Empty states: a board with no issues, a filter with no matches, empty columns (each with its own hint), no comments, no attachments, no labels. |

## What's in place

- **Rules (`src/shared/board.ts`):** pure functions shared by main and renderer. Main uses them to enforce, the renderer to give instant feedback.
  - **`deriveColumn`:** a live task decides the column:
    - draft or active → In Progress
    - ready_to_ship or pushed → Review
    - done → Done
    - an abandoned task falls back to the stored column
  - **`positionBetween` and `needsRenormalize`:** fractional ordering. A column is renumbered 1..n once a gap falls below 1e-6.
  - **`checkMove`:** In Progress means "start a task". Cards with a task can only be reordered within their column.
  - **`filterCards`:** filters on search words, labels, priority, has-task and archived.
- **Store (`src/main/board.ts`):** issues numbered through `issue_seq`, labels unique per project (case-insensitive), comments, and attachments.
  - **Attachments** are copied to `<data>/issues/<project>/<KEY>/attachments/`, with a free name such as "note (2).txt" when one is taken.
  - **Moves** take `afterId` / `beforeId` and are resolved against the current column order in main, so a stale or filtered view still lands where you dropped it.
- **IPC:** `board:list`, `issues:get/index/create/update/move/archive/attach/detach/revealAttachments`, `labels:upsert/delete`, `comments:add`, `dialog:pickFiles`. Main pushes `board:changed` after every write, and open views refetch.
- **Board:**
  - Five columns with counts ("shown/total" while filtering).
  - dnd-kit with a drag overlay and screen-reader announcements.
  - A collision check that picks the column first, then the nearest card, so a tall, empty column still wins.
  - A keyboard coordinate getter: Left/Right jump to the next column, Up/Down reorder.
  - Options menu → Manage labels (rename, recolour, delete with confirm, usage counts).
  - A dismissable first-run tip, skeleton columns while loading.
- **Filter bar:** search (`/` focuses it, Esc clears it), labels, priority, task yes/no, Archived toggle, a count and Clear. Filters are kept per project for the session.
- **Issue drawer (520px, Esc or Back closes it):**
  - Top bar: key, created and updated times, and a menu with Copy key, Reveal attachments folder, Archive/Unarchive.
  - Title: click to edit, Enter saves, Esc cancels.
  - Column, priority and labels pills.
  - Task panel: Start task, plus the history of abandoned tasks.
  - Markdown body: Write/Preview tabs, GFM, autosave 600ms after typing stops, flushed on close.
  - Attachments: drop files or choose them, open, remove with confirm.
  - Comments.
  - Archived issues show a banner with Unarchive. Archiving shows a toast with Undo.
- **Palette:** an Issues group (search by key or title) and "New issue in <project>".

## Deviations from SPEC.md

1. **Rules live in `src/shared/board.ts`:** pure and shared, rather than inside main's `board.ts`.
2. **`issues:get` returns comments, attachments and task history in one call.** SPEC didn't name a channel for reading comments. Added channels:
   - `issues:detach`
   - `issues:revealAttachments`
   - `issues:index`, for the palette
   - `dialog:pickFiles`
   - `api.pathForFile`: Electron removed `File.path`, so preload uses `webUtils.getPathForFile`.
3. **The Start task dialog is a stand-in until Phase 3.** It explains what will happen, and its Start button is disabled. Cancel puts the dragged card back.
4. **Dropping a locked card in another column shows a toast** ("Column follows the task…") instead of a tooltip. dnd-kit has no hover target to anchor a tooltip to mid-drag.
5. **Comments can't be edited or deleted yet.** SPEC didn't ask for it; it's easy to add later.
6. **The New issue dialog only offers Backlog and Todo.** Review and Done are allowed through IPC, but a new issue rarely starts there.

## Bugs found while verifying (fixed)

- **CSS animations never ran, in any phase.** The keyframes live in `global.css`, but CSS modules renamed every `animation: rise-in …` to a hashed name that didn't exist. As a side effect, Radix popovers stayed on screen after Esc: Presence waited for an `animationend` that never fired. All 14 uses now say `global(name)`. Spinners, pulses and skeleton shimmer animate for the first time.
- **A keyboard drop on the empty In Progress column reordered the card in Todo instead.** dnd-kit's sortable keyboard getter runs `closestCorners` over everything to that side, so it could skip past an empty column. Fixed with a custom coordinate getter and the column-first collision check.
- **Pressing `C` typed a stray "c" into the New issue title.** The shortcut now swallows the key when it opens something.
- **Columns read "5/4" mid-drag.** The shown/total count now appears only while filtering.
- **The board overflowed at the default window width.** The column minimum is now 180px.
- **Smaller fixes:**
  - Closing the drawer left focus on `<body>`; it now returns to the card.
  - The palette input picked up the icon's faint colour and showed a second focus ring.
  - GFM task lists showed both bullets and checkboxes.
  - In the label picker, Enter on an exact match did nothing when other labels also matched.

## Skipped / not done

- **Dropping files from Explorer onto the drawer** wasn't automated. Drag sources from outside the window can't be scripted over the DevTools protocol, so attachments were added through the same `issues:attach` call the drop zone uses. The file picker is native and also untested. Try both once by hand.
- **"Reveal attachments folder" and opening an attachment** call `shell.openPath`, and weren't clicked.
- **The empty-board state** was checked in light only; dark uses the same tokens.
- **Esc sometimes needs one extra press:** when focus lands on an icon button its tooltip opens, and Esc closes the tooltip first. This is Radix's standard layering.
- **Only Windows 11 was tested.**
- **Not in Phase 2 by design:** starting tasks, the task tab, and card live indicators (Phases 3 to 5).

## How to try it

```text
npm run dev
C                      new issue
/                      filter
Space, arrows, Space   move the focused card
Enter                  open the focused card
Ctrl K, "YAN-3"        jump to an issue
```
