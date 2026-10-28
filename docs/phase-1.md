# Phase 1: Skeleton and design system

The real app now lives in `src/`; `spike/` stays as Phase 0's reference. `npm run dev` runs it with hot reload, and `npm run build` followed by `npm start` runs the production build.

## Acceptance checks

| Check | Result |
| --- | --- |
| Add a project through onboarding, restart, it's still there | ✅ The project was added, saved to `config.json`, renamed through Settings → Edit, then Electron was killed and relaunched. It opened straight onto the project's board. Runs used a throwaway `YANTRA_HOME`. The native folder picker can't be scripted, so the wizard's last step was replayed through the same `repo:inspect` and `projects:upsert` calls; the wizard screens themselves were checked by eye. |
| Pre-flight shows the logged-in email | ✅ It lists the CLI version, the email and plan from `claude auth status`, and first-run setup. It runs on launch, shows in onboarding step 1 and in the sidebar footer, and runs again from Settings → General → Test. |
| A wrong binary path shows a clear error | ✅ It shows "Not found at C:\nope\claude.exe", marks the other checks "Not checked", and suggests a fix. Onboarding also offers a path field. |
| `DevUi` looks finished in both themes | ✅ The UI gallery (Ctrl K → "UI gallery") shows every primitive and token in a light panel and a dark panel side by side. |
| Keyboard focus is visible everywhere | ✅ One `:focus-visible` ring (2px accent with offset) covers every control: buttons, tabs, inputs, selects, textareas, switches, swatches and menu items. Checked on each control type. |
| `npm run typecheck` / `npm test` | ✅ Strict, with `noUncheckedIndexedAccess`; 32 tests cover config, migrations, pre-flight parsing, git inspection and naming. |

## What's in place

- **IPC:** `src/shared/ipc.ts` is the single contract. Preload builds `window.api.invoke[channel]` from it, so a channel missing on either side is a type error. Main validates every payload with zod. Errors cross the bridge with a `YANTRA:` prefix, and the renderer strips it so toasts show clean messages.
- **Config:** `~/Yantra/config.json` is validated with zod and written atomically (temp file, then rename). If the file is broken the app shows a "config.json has problems" screen listing each issue, and never overwrites it.
- **SQLite:** `yantra.db` sits under the data folder with WAL and foreign keys on. It holds the full SPEC schema, including `one_live_task_per_issue`, migrated by `user_version`; a database newer than the app is refused.
- **Design system:** `tokens.css` (SPEC colours, 10-colour palette with `-bg`/`-fg` pairs, type, spacing, radius, motion, shadows) and bundled Inter and JetBrains Mono, so no network is needed.
  - **Theme:** light, dark or system, cycled with Ctrl Shift L. Main sets `nativeTheme.themeSource`, so the title-bar overlay buttons follow.
  - **Primitives:** Button, IconButton, Tooltip, Kbd, Badge, Pill, Tag, Tabs, Dialog, ConfirmDialog, Menu, Popover, Toast, EmptyState, Skeleton, Field, Input, Textarea, Select, Switch, ColorSwatches and ProjectMark.
- **Shell:**
  - **Sidebar:** collapsible with Ctrl B, with tooltips when collapsed. It lists projects, "Add project", the views and a Claude status footer.
  - **Top bar:** a pinned "<Project> board" tab plus the current view, search and theme.
  - **Status bar:** placeholder numbers.
  - **Command palette:** jump to projects and views, add a project, switch theme, open the shortcut sheet, open the UI gallery.
  - **Shortcuts:** `G` then `B/R/N/D/M/S`, and `?` for the shortcut sheet.
- **Screens:**
  - **Onboarding:** a welcome screen, then a 3-step wizard: Check Claude (skipped when it already passed), Repository (finds the repo root from any subfolder, default branch, remotes), Details.
  - **Details:** name, key with a uniqueness check and an example ("YAN-12"), colour, branch, remote, and an advanced section for setup commands, checks and shared folders. The suggested key and name come from the folder ("payments-api" gives Payments Api and PAY).
  - **Board placeholder:** the five columns, a "No issues yet" card and a dismissable tip.
  - **Running, Needs you, Done and Metrics:** each has an empty state.
  - **Settings:**
    - Projects: edit and remove, with a confirm.
    - General: Claude path with Test, sessions, trust switch, theme, data folder with a restart note.
    - Pricing: an editable table with validation.

## Deviations from SPEC.md

1. **`schema.ts` instead of `schema.sql`:** the SQL lives in a template string. Main is bundled, so a loose `.sql` file would need copying at build time.
2. **More form primitives than SPEC listed:** Field, Input, Textarea, Select, Switch, ColorSwatches and ProjectMark. Every form needed them.
3. **`YANTRA_HOME` env var** overrides `~/Yantra`, for testing without touching real data.
4. **TypeScript 7 (native `tsc`) and `.mts` Vite configs:** the configs are `.mts` because main is CommonJS (better-sqlite3 and node-pty are CJS).
5. **execa 10 is ESM-only:** main `require()`s it, which works through Node 24's `require(esm)` in Electron 45. If a later Electron or Node drops that, bundle execa into main.
6. **Pricing seed:** a single `claude-opus-*` row from the SPEC example. Add your real models in Settings → Pricing; Phase 7 matches by glob.
7. **Window:** the title bar is hidden and uses the native overlay buttons on Windows, so the top bar doubles as the drag region.

## Bugs found while verifying (fixed)

- `<main>` never scrolled. The shell grid's implicit row grew to fit the content, so long pages (General settings, the gallery) were cut off. Fixed with `grid-template-rows: minmax(0, 1fr)`.
- The edit-project dialog crashed with React #185 (an update loop). A store selector returned a new array on every call. All selectors now return stable references; the store's doc comment says why.
- At the default 1280px window the fifth board column was clipped. The column minimum is now 176px.

## Skipped / not done

- The native folder picker isn't automated, so the click-through of "Choose a folder" in onboarding wasn't scripted. Try it once by hand: `npm run dev`, then pick a real repo.
- macOS and Linux weren't run; only Windows 11 was tested.
- In the UI gallery, dialogs, menus and toasts render in the app's theme, not the panel's, because they portal to `<body>`. In the app they always match.
- Not in Phase 1 by design: issues, drag-and-drop, the issue drawer and `C` to create (Phase 2; `C` shows a "coming in Phase 2" toast). Also OS notifications, the terminal and the diff viewer.

## How to run

```text
npm install
npm run dev                      # hot reload
npm run typecheck; npm test
npm run build; npm start         # production build
set YANTRA_HOME=D:\tmp\yantra    # optional: a throwaway data folder
```
