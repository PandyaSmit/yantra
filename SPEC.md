# YANTRA: Build Spec for Claude Code

Oct 28, 2026 · @Smit Pandya · rev 2 (local board, no forge, designed UI)

## How to use this spec

This is a build prompt for Claude Code: it lives in the repo as `SPEC.md`. Start `claude` here and say "Read SPEC.md and do Phase 0 only, then stop for my review." Go one phase at a time and review before moving on, because each phase leans on the last.

**Product in one paragraph.** YANTRA (Sanskrit for machine or instrument) is a personal Electron desktop app for issue-driven work with Claude Code. Each project has its own local kanban board of issues. Starting work on an issue creates a task: a tab, a git worktree, and a task folder outside the repo holding my brief, an issue snapshot, my resources and every stage's artifact. Stages (research, plan, code, review) come from a YAML template chosen per task. Each stage runs as a live interactive Claude session I can steer, and never advances without my approval. Tokens, minutes and tool calls are logged per stage. When I'm happy, one click pushes the branch and the app hands me a ready-made PR description. I open the PR and merge it myself, always.

**What changed in rev 2:** no GitLab/GitHub integration for now. Issues live on a local board in SQLite. Ship ends at "push branch + PR description". The UI is designed, not a skeleton: a small design system, a proper board, onboarding, command palette and keyboard shortcuts are part of the MVP.

**Hard rules for the builder (Claude Code, read these twice):**

1. TypeScript everywhere, `strict: true`. No Rust, no Tauri, no Go sidecar.
2. No separate backend server and no HTTP listener in MVP. The Electron main process is the backend. Renderer talks to it only through typed IPC exposed by a preload script (`contextIsolation: true`, `nodeIntegration: false`).
3. The app never merges anything. No merge button, no `git merge` or `git rebase` into the default branch, no forge API calls of any kind in MVP. Agents never push; only the app pushes, and only after I click.
4. SQLite is the single source of truth for state, including the board. Task folders hold content (Markdown, resources, logs), not state. Don't invent a second state file.
5. Shell out to the real `claude` binary. Don't use the Agent SDK in MVP. Don't reimplement a terminal; use xterm.js + node-pty.
6. Verify every Claude Code CLI flag and hook payload against `claude --help` and a real run during Phase 0. This spec names the flags I expect; if one differs, adapt and note it in `docs/cli-notes.md`.
7. Keep it boring: no state library beyond React state + a tiny store, no ORM, no microservices, no plugin system, no CSS framework. The only UI libraries allowed are the ones listed under **Design system**. Readable code beats clever code, because I will review it.
8. Each phase ends with its acceptance checks passing and a short `docs/phase-N.md` saying what was built and what was skipped.
9. UI work is not "later". Every screen built in a phase uses the design tokens and primitives, has an empty state, and looks finished in both light and dark mode before the phase is done.

## Stack and architecture

The Electron main process is the whole backend: it owns SQLite, spawns `claude` in PTYs, runs git, and tails hook logs from disk. No server, no ports, no Docker, no network calls.

| Concern | Choice | Why |
| --- | --- | --- |
| Shell | Electron (latest stable, pinned) + electron-vite | Fast dev loop, TS for main/preload/renderer |
| UI | React 18 + Vite, CSS modules + one `tokens.css` | Nothing exotic to review |
| UI primitives | Radix (`dialog`, `dropdown-menu`, `tooltip`, `popover`), unstyled | Accessible focus/keyboard handling for free |
| Board drag and drop | `@dnd-kit/core` + `@dnd-kit/sortable` | Accessible, keyboard-draggable, small |
| Icons / fonts | `lucide-react`, `@fontsource-variable/inter`, `@fontsource/jetbrains-mono` | Bundled, no network |
| Markdown | `react-markdown` + `remark-gfm` | Issue bodies and artifacts |
| Command palette | `cmdk` | Ctrl+K jump-to-anything |
| Terminal | `@xterm/xterm` + `@xterm/addon-fit` in renderer, `node-pty` in main | Real interactive `claude`, not a fake |
| DB | `better-sqlite3` (sync, main process only) | Simple, fast, one file |
| Config/templates | JSON for app config, YAML (`yaml` package) for stage templates | Hand-editable |
| Validation | `zod` for config, templates, IPC payloads, hook events | Fail loudly on bad input |
| Git | `execa` calling the `git` binary | No libgit wrappers to debug |
| Diff UI | `react-diff-view` + `gitdiff-parser` | Line comments are easy to hang on it |
| File watching | `chokidar` | Hook log + artifact watching |
| Native modules | `node-pty@1.1.0`, `better-sqlite3@13.0.3`, exact versions pinned | Both ship N-API prebuilds: no `@electron/rebuild`, no Visual Studio (verified in Phase 0) |

**Install notes (from Phase 0):** npm gates install scripts behind `allowScripts` in `package.json`. Allow `node-pty` (its script only checks the prebuild) and set `better-sqlite3` to `false` (npm otherwise adds an implicit `node-gyp rebuild` that fails without Visual Studio). Electron downloads its binary lazily on first `require('electron')`. Node's built-in `node:sqlite` also works in Electron 45, as a fallback if better-sqlite3 prebuilds ever lag.

How hooks reach the app without a server: each stage launch gets a generated `settings.json` whose hooks run `hook.cjs` (shipped with the app) through `ELECTRON_RUN_AS_NODE=1 <electron binary>`, so no separate Node install is needed. The hook script appends one JSON line per event to `<taskDir>/log/hooks.jsonl` and, for `PreToolUse`, exits 2 to block forbidden commands. Main tails that file with chokidar.

```text
yantra/
  SPEC.md
  docs/                      # cli-notes.md, phase-N.md
  resources/
    hook.cjs                 # hook runner, plain CommonJS, zero deps
    templates/standard.yaml
    templates/quickfix.yaml
    prompts/research.md plan.md code.md review.md
  src/
    main/
      index.ts               # app lifecycle, window
      ipc.ts                 # all ipcMain.handle registrations
      db/schema.sql, db.ts   # better-sqlite3, migrations by user_version
      config.ts              # JSON config
      board.ts               # issues, labels, comments, ordering, column derivation
      templates.ts           # load + zod-validate YAML templates
      taskfs.ts              # task folder create/snapshot/hash
      git.ts                 # worktree, branch, diff, commit list, push
      preflight.ts           # claude binary, auth status, onboarding check
      sessions.ts            # node-pty manager, launch/resume/kill, queue
      hooks.ts               # tail hooks.jsonl, dispatch events
      metrics.ts             # transcript parsing, time accounting
      machine.ts             # task + stage state machine (pure functions)
      checks.ts              # run template pre-commands, capture output
      ship.ts                # PR description builder, push
    preload/index.ts         # contextBridge: typed window.api
    shared/types.ts          # types + IPC contract shared by main + renderer
    renderer/
      App.tsx, store.ts
      styles/tokens.css, global.css
      ui/        Button, IconButton, Badge, Pill, Dialog, Menu, Tooltip, Toast, Kbd, EmptyState, Skeleton, Tabs
      shell/     Sidebar.tsx, TopBar.tsx, CommandPalette.tsx, StatusBar.tsx
      board/     Board.tsx, Column.tsx, IssueCard.tsx, IssueDrawer.tsx, FilterBar.tsx, StartTaskDialog.tsx
      task/      TaskWorkspace.tsx, StageRail.tsx, Terminal.tsx, Files.tsx, Diff.tsx, ShipPanel.tsx, Metrics.tsx
      views/     Running.tsx, Done.tsx, MetricsView.tsx, Settings.tsx, Onboarding.tsx, DevUi.tsx
```

## Storage

Three stores, one job each: SQLite owns state (board, tasks, stages, metrics), the task folder owns content, JSON/YAML own configuration. If you find yourself writing state into the task folder, stop.

**App data root:** `~/Yantra/` (configurable). DB at `~/Yantra/yantra.db`, worktrees at `~/Yantra/worktrees/<project-slug>/<issue-key>/`, task folders at `~/Yantra/tasks/<project-slug>/<issue-key>/`, issue attachments at `~/Yantra/issues/<project-slug>/<issue-key>/attachments/`. `issue-key` is the project key plus number, e.g. `PAY-12`.

**Task folder layout** (each one is its own local git repo, `git init` on creation, never pushed, committed automatically on every approval so artifact history is free):

```text
tasks/<project>/<issue-key>/
  brief.md            # mine: goal, constraints, links, acceptance criteria
  issue.md            # app-written snapshot of the local issue (refreshable from the board)
  resources/          # mine: specs, screenshots, API docs, notes (issue attachments copied here)
  research.md         # Research stage output
  plan.md             # Plan stage output
  implementation.md   # Code stage summary of what it did and deviations from plan
  checks.txt          # output of template pre-commands (tests/lint/typecheck)
  review.md           # Review stage output
  pr.md               # generated PR description, written by the Ship panel
  feedback/           # my reject/send-back comments, one file per round
  log/hooks.jsonl     # hook events (append only)
  log/<session-id>.jsonl  # copy of the Claude transcript, made on session end
  .stage/settings-<stage>.json  # generated Claude settings for that launch
```

`brief.md` starts from this template, with **Goal** prefilled from the issue body:

```markdown
# <issue-key>: <issue title>

## Goal
<issue body>
## Must / must not
## Acceptance criteria
## Pointers (files, modules, people, links)
## Notes
```

`issue.md` contains title, key, priority, labels, created date, the body, and comments with dates. **Refresh from board** rewrites it; it is never edited by hand.

**Config** at `~/Yantra/config.json` (zod-validated, no secrets in it):

```json
{
  "claudeBinary": "C:/Users/me/.local/bin/claude.exe",
  "maxConcurrentSessions": 3,
  "defaultTemplate": "standard",
  "theme": "system",
  "priceTable": { "claude-opus-*": { "in": 15, "out": 75, "cacheRead": 1.5, "cacheWrite": 18.75 } },
  "projects": [
    {
      "slug": "payments-api",
      "name": "Payments API",
      "key": "PAY",
      "color": "indigo",
      "repoPath": "D:/code/payments-api",
      "defaultBranch": "main",
      "remote": "origin",
      "sharedDirs": ["D:/notes/payments"],
      "worktreeSetup": ["copy ..\\.env .env", "npm ci"],
      "pre": ["npm test", "npm run lint", "npx tsc --noEmit"]
    }
  ]
}
```

`claudeBinary` defaults to `claude` if it is on PATH, otherwise to `%USERPROFILE%\.local\bin\claude.exe` (where `claude install` puts it without touching PATH). Never default to the copy bundled inside the Claude desktop app: its path changes with every update. `key` is 2–5 uppercase letters, unique across projects, and cannot change once the project has issues. `color` is one of the eight project palette names. The price table is a placeholder, prices per million tokens in USD. Fill it from Anthropic's pricing page, and treat every cost figure as an estimate.

**SQLite schema** (`src/main/db/schema.sql`, migrations via `PRAGMA user_version`, `PRAGMA journal_mode=WAL`, `foreign_keys=ON`):

```sql
-- Board -------------------------------------------------------------------
CREATE TABLE issue_seq (
  project_slug TEXT PRIMARY KEY,
  next_number  INTEGER NOT NULL
);

CREATE TABLE issue (
  id           INTEGER PRIMARY KEY,
  project_slug TEXT NOT NULL,
  number       INTEGER NOT NULL,           -- shown as <KEY>-<number>
  title        TEXT NOT NULL,
  body_md      TEXT NOT NULL DEFAULT '',
  column_key   TEXT NOT NULL,              -- backlog|todo|in_progress|review|done; ignored once a task exists
  priority     INTEGER NOT NULL DEFAULT 0, -- 0 none, 1 low, 2 medium, 3 high, 4 urgent
  position     REAL NOT NULL,              -- fractional index within its column
  archived     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  UNIQUE(project_slug, number)
);

CREATE TABLE label (
  id           INTEGER PRIMARY KEY,
  project_slug TEXT NOT NULL,
  name         TEXT NOT NULL,
  color        TEXT NOT NULL,              -- palette name, not hex
  UNIQUE(project_slug, name)
);

CREATE TABLE issue_label (
  issue_id INTEGER NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  label_id INTEGER NOT NULL REFERENCES label(id) ON DELETE CASCADE,
  PRIMARY KEY(issue_id, label_id)
);

CREATE TABLE issue_comment (
  id         INTEGER PRIMARY KEY,
  issue_id   INTEGER NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  body_md    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE issue_attachment (
  id         INTEGER PRIMARY KEY,
  issue_id   INTEGER NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  file_name  TEXT NOT NULL,                -- stored under issues/<project>/<key>/attachments/
  size       INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- Tasks and stages --------------------------------------------------------
CREATE TABLE task (
  id            INTEGER PRIMARY KEY,
  issue_id      INTEGER NOT NULL REFERENCES issue(id),  -- one live task per issue, see index below
  project_slug  TEXT NOT NULL,
  issue_key     TEXT NOT NULL,            -- denormalized, e.g. PAY-12
  title         TEXT NOT NULL,
  template      TEXT NOT NULL,            -- template name, frozen at task start
  template_yaml TEXT NOT NULL,            -- full template snapshot, so edits don't break running tasks
  status        TEXT NOT NULL,            -- draft|active|ready_to_ship|pushed|done|abandoned
  branch        TEXT NOT NULL,
  base_sha      TEXT,
  worktree_path TEXT NOT NULL,
  task_dir      TEXT NOT NULL,
  pushed_at     INTEGER,
  created_at    INTEGER NOT NULL,
  closed_at     INTEGER,
  setup_done_at INTEGER                   -- migration 2: creation steps all finished; NULL = setup unfinished
);
-- abandoned tasks stay as history; a new task can then be started on the same issue
CREATE UNIQUE INDEX one_live_task_per_issue ON task(issue_id) WHERE status <> 'abandoned';

CREATE TABLE stage (
  id             INTEGER PRIMARY KEY,
  task_id        INTEGER NOT NULL REFERENCES task(id),
  stage_key      TEXT NOT NULL,           -- research|plan|code|review|custom
  position       INTEGER NOT NULL,
  status         TEXT NOT NULL,           -- pending|queued|running|idle|awaiting_approval|approved|skipped|interrupted
  session_id     TEXT,                    -- current Claude session UUID
  round          INTEGER NOT NULL DEFAULT 1,  -- increments on reject/send-back
  approved_hash  TEXT,                    -- sha256 of artifact at approval
  approved_at    INTEGER,
  awaiting_since INTEGER,                 -- for 'waiting on me' time
  UNIQUE(task_id, stage_key)
);

CREATE TABLE run (                        -- one PTY lifetime
  id             INTEGER PRIMARY KEY,
  stage_id       INTEGER NOT NULL REFERENCES stage(id),
  session_id     TEXT NOT NULL,
  kind           TEXT NOT NULL,           -- start|resume|feedback
  started_at     INTEGER NOT NULL,
  ended_at       INTEGER,
  exit_code      INTEGER,
  transcript     TEXT,                    -- path to copied transcript
  claude_version TEXT
);

CREATE TABLE usage (                      -- one row per deduped assistant message
  message_id    TEXT PRIMARY KEY,
  run_id        INTEGER NOT NULL REFERENCES run(id),
  model         TEXT,
  input_tokens  INTEGER, output_tokens INTEGER,
  cache_read    INTEGER, cache_write   INTEGER,
  is_sidechain  INTEGER NOT NULL DEFAULT 0,
  ts            INTEGER
);

CREATE TABLE event (                      -- from hooks.jsonl
  id         INTEGER PRIMARY KEY,
  run_id     INTEGER REFERENCES run(id),
  ts         INTEGER NOT NULL,
  hook       TEXT NOT NULL,               -- PreToolUse, PostToolUse, Stop, UserPromptSubmit, SessionStart, SessionEnd
  tool       TEXT,
  summary    TEXT,                        -- e.g. bash command, file path
  blocked    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE review_comment (
  id         INTEGER PRIMARY KEY,
  task_id    INTEGER NOT NULL REFERENCES task(id),
  file       TEXT NOT NULL,
  line       INTEGER,
  side       TEXT,                        -- old|new
  body       TEXT NOT NULL,
  state      TEXT NOT NULL,               -- draft|sent_to_agent|resolved
  round      INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
```

## Board

Each project has one board. The board is where work starts: I write issues, triage them into columns, and start a task from a card.

**Columns (fixed in MVP):** Backlog, Todo, In Progress, Review, Done.

**The one rule that keeps state single-sourced:** once an issue has a task, its column is **derived from the task**, and `issue.column_key` is ignored:

| Task status | Board column |
| --- | --- |
| `draft`, `active` | In Progress |
| `ready_to_ship`, `pushed` | Review |
| `done` | Done |
| `abandoned` | Todo (task link kept in the drawer's history; a new task can be started) |

`deriveColumn(issue, liveTask | null)` lives in `board.ts` as a pure function with unit tests. "Live task" means the issue's task whose status is not `abandoned` (the partial unique index guarantees at most one). Abandoning a task sets `issue.column_key = 'todo'`; the abandoned task row stays and shows under **History** in the issue drawer.

**Drag and drop rules:**

- Issues without a task move freely between columns and reorder within them.
- Dropping a task-less card into **In Progress** opens the **Start task** dialog. Cancel puts the card back where it was.
- Cards with a task can only be reordered within their derived column. Trying to drag one elsewhere snaps back with a tooltip saying why ("Column follows the task. Open it to approve or ship.").
- Dropping a task-less card into **Done** is allowed (closing an issue without code).
- Ordering uses fractional indexes: `move({issueId, toColumn, beforeId?, afterId?})` puts the card at the midpoint of its neighbours; main renormalizes a column (1, 2, 3, …) when the gap gets below `1e-6`. Unit-test the math.

**Card anatomy:**

```text
+----------------------------------+
| PAY-12            ▲▲ high   ● run |   key (mono, muted) · priority icon · live dot
| Fix webhook retry storm          |   title, 2 lines max, ellipsis
| [bug] [webhooks]                 |   label chips
| ●●◐○  Code · round 2      38m    |   stage dots (only with a task) · current stage · agent time
+----------------------------------+
```

- A pulsing blue dot while a stage is `running`.
- Amber left border and a **Needs you** badge while a stage is `awaiting_approval`.
- Red dot with tooltip when the last run was `interrupted`.
- Hover lifts the card (shadow sm → md); focus shows a 2 px accent ring; keyboard users can pick up a card with Space and move it with arrows (dnd-kit keyboard sensor).

**Issue drawer** (slides in from the right, 520 px, Esc closes, URL-like state so Back works):

- Editable title (click to edit, Enter saves), key and created date.
- Priority and labels as pill dropdowns; labels can be created inline with a colour.
- Body: Markdown with **Write / Preview** tabs, autosaved after 600 ms idle.
- Attachments: drop zone and file list; files go to `issues/<project>/<key>/attachments/`.
- Comments: a simple list with a composer at the bottom (Ctrl+Enter posts).
- Task panel: no task → primary **Start task** button with a template dropdown. With a task → status pill, stage stepper, **Open task** button.
- Footer actions in an overflow menu: Archive, Copy key, Reveal attachments folder.

**Filter bar** above the board: text search (title, body, key), label multi-select, priority, "has task" toggle, and "Show archived". Filters are per project and held in renderer state for the session; persisting them is not needed in MVP.

**IPC (board):** `board:list(projectSlug)` returns columns with ordered cards (issue + labels + derived column + task summary), `issues:create`, `issues:update`, `issues:move`, `issues:archive`, `issues:attach`, `labels:list/upsert/delete`, `comments:list/add`. Main pushes `board:changed` events when a task's status changes so cards update live.

## Design system

The UI should feel like a calm, modern dev tool (think Linear or Raycast density), not a debug panel. Everything below lives in `src/renderer/styles/tokens.css` and `src/renderer/ui/`; components never hard-code colours or spacing.

**Theme:** light, dark, or system (`theme` in config, toggle in top bar and command palette). Implemented as CSS variables on `:root` and `:root[data-theme="dark"]`.

| Token | Light | Dark |
| --- | --- | --- |
| `--bg` | `#FAFAF9` | `#0E0F11` |
| `--surface` (sidebar, columns) | `#F4F4F2` | `#131518` |
| `--card` / `--elevated` | `#FFFFFF` | `#1B1E23` |
| `--border` | `#E7E5E4` | `#2A2E35` |
| `--text` | `#1C1917` | `#E7E9EC` |
| `--text-muted` | `#78716C` | `#8B929C` |
| `--accent` | `#5B5BD6` | `#7C7CF0` |
| `--running` | `#3B82F6` | `#60A5FA` |
| `--needs-you` | `#F59E0B` | `#FBBF24` |
| `--ok` | `#16A34A` | `#4ADE80` |
| `--danger` | `#DC2626` | `#F87171` |

- **Palette names** for projects and labels: slate, red, orange, amber, green, teal, blue, indigo, violet, pink. Each has a `-bg` (12% tint) and `-fg` variant per theme, so label chips stay readable in both modes.
- **Type:** Inter Variable, 13 px base, 12 px meta, 15/18/22 px headings, weights 400/500/600. JetBrains Mono 12 px for keys, paths, hashes, terminal and diffs.
- **Spacing:** 4 px scale (`--s1`…`--s8` = 4, 8, 12, 16, 20, 24, 32, 48). **Radius:** 6 (inputs, chips), 10 (cards, menus), 14 (dialogs, drawer). **Shadows:** sm/md/lg, softer in dark mode.
- **Motion:** CSS transitions only, 120 ms for hover/focus, 200 ms for drawer/dialog/toast, `ease-out`. Everything respects `prefers-reduced-motion`.
- **Focus:** visible 2 px `--accent` ring on every interactive element; never remove outlines without a replacement.

**Primitives (`ui/`):** Button (primary / secondary / ghost / danger, sm/md, loading state), IconButton (with required tooltip), Badge, Pill (status), Kbd, Tabs, Dialog, Menu, Tooltip, Popover, Toast (stacked bottom-right, auto-dismiss 5 s, actions allowed), EmptyState (icon, one-line title, one-line hint, optional action), Skeleton. A `DevUi` view (reachable via command palette in dev builds) renders every primitive in every state, in both themes.

**Status language, used everywhere (cards, rail, sidebar, status bar):**

| Stage status | Colour | Icon | Label |
| --- | --- | --- | --- |
| pending | muted | circle | Not started |
| queued | muted | clock | Queued |
| running | running | pulsing dot | Running |
| idle | slate | pause | Idle |
| awaiting_approval | needs-you | bell | Needs you |
| approved | ok | check | Approved |
| skipped | muted | skip | Skipped |
| interrupted | danger | alert | Interrupted |

## UI layout

One window: a left sidebar, a top bar with tabs (the project board is always the first, pinned tab; each open task is a tab after it), the main area, and a status bar.

```text
+---------------+--------------------------------------------------------------------+
| [Y] YANTRA    | [▦ Payments board] [PAY-12 Fix retry ×] [PAY-11 Export ×]  Ctrl K ◐ |
|               +--------------------------------------------------------------------+
| PROJECTS      | Payments API                 [ Search…  ] [Labels ▾] [Priority ▾]  |
|  ■ Payments 2 |                                                     [+ New issue]  |
|  ■ Infra      |  Backlog 4     Todo 3        In Progress 2      Review 1    Done 9 |
|  + Add        |  +---------+  +---------+   +-------------+    +---------+         |
|               |  | PAY-14  |  | PAY-11 ▲|   | PAY-12  ●   |    | PAY-9   |         |
| VIEWS         |  | Retry … |  | Export …|   | Fix retry … |    | Rate li…|         |
|  ▦ Board      |  | [bug]   |  | [feat]  |   | ●●◐○ Code r2|    |Needs you|         |
|  ▶ Running  2 |  +---------+  +---------+   +-------------+    +---------+         |
|  🔔 Needs you 1|  + Add       + Add                                                 |
|  ✓ Done       |                                                                    |
|  ∑ Metrics    |                                                                    |
|  ⚙ Settings   +--------------------------------------------------------------------+
|               | ● 2/3 sessions live · 412k tokens today (est. $4.10) · 38m agent   |
+---------------+--------------------------------------------------------------------+
```

- **Sidebar:** projects with a colour square and a count of tasks needing me; views below. Collapsible to icons (Ctrl+B).
- **Running** lists every live/queued/idle stage across projects; **Needs you** lists every `awaiting_approval` stage. Both are the fastest way back to what matters.
- **Status bar:** live sessions, today's tokens and estimated cost, today's agent-active time. Clicking it opens Metrics.

**Task workspace (a tab):**

```text
+------------------------------------------------------------------------------------+
| ← Board  PAY-12  Fix webhook retry storm       standard · [ACTIVE] · 2 behind main |
|                                                                                    |
|   (✓ Research) ──── (✓ Plan) ──── (● Code · r2) ──── (○ Review)                    |
|                                                                                    |
|   Code is running · 12m active · 84k tokens        [Approve] [Request changes] [⋯] |
+------------------------------------------------------------------------------------+
|  Terminal   Files   Diff   Metrics                                                 |
|                                                                                    |
|   xterm.js running claude for the current stage (themed to match tokens)           |
|                                                                                    |
+------------------------------------------------------------------------------------+
```

- **Stage rail** is a stepper: icon + title + round per stage, coloured by the status table, tooltips with active minutes and tokens. Clicking a past stage opens its artifact in Files.
- **Action bar** shows only what is legal now (the reducer decides): one filled primary button (Approve when awaiting, Resume when interrupted, Start when draft), secondary buttons for Request changes and Send back to…, and Skip / End session / Stop session / Abandon in the overflow menu. Destructive actions get a confirm dialog that names the consequence.
- **Request changes** and **Send back** open a dialog with a Markdown textbox and (for send back) a stage picker.

| Sub-tab | Contents |
| --- | --- |
| Terminal | Live PTY for the current stage, plus a dropdown to view past runs' output (read-only, from ring buffer or transcript) |
| Files | Task folder tree on the left. `brief.md` opens in a Write/Preview editor; artifacts open rendered, with a "modified since approval" badge; drag-and-drop into `resources/` |
| Diff | Diff viewer, commit list, line comments, review.md findings panel, Send back / Approve buttons, Ship panel once `ready_to_ship` |
| Metrics | Per-stage table, tool timeline, transcript links |

**Onboarding:** first launch with no projects shows a welcome screen with one action, **Add your first project**: pick the repo folder (validated as a git repo), auto-detect the default branch and remote, suggest a name, key (from the folder name) and colour, optional setup and pre commands. Finishing it lands on an empty board whose empty state says "No issues yet. Press C to write one." A second, dismissible tip explains "Drag a card to In Progress to start a task."

**Command palette (Ctrl+K):** jump to project, issue (by key or title), open task, view; actions: new issue, start task on the selected issue, approve current stage, toggle theme, open settings.

**Keyboard shortcuts** (shown in tooltips with `Kbd`, and in a `?` cheat sheet): `C` new issue, `/` focus search, `Ctrl+K` palette, `Enter` open selected card, `Esc` close drawer/dialog, `1–4` task sub-tabs, `Ctrl+W` close task tab, `Ctrl+B` toggle sidebar, `G B` board, `G R` running.

**Notifications:** an in-app toast and an OS notification (Electron `Notification`) when a stage reaches `awaiting_approval`, a session is blocked by the fence, or checks finish. Clicking it focuses that task tab.

**Settings:** Projects (name, key, colour, repo path, default branch, remote, shared dirs, worktree setup commands, pre-commands override), General (claude binary path with a **Test** button that runs the pre-flight and shows version, login email and plan, max sessions, data root, theme, the worktree-trust setting), Pricing (price table editor). Forms validate inline with zod messages.

Onboarding also runs the pre-flight as its first step, so a missing or logged-out CLI is caught before I add a project.

## Stage templates and prompts

A template is data: a list of stages, each with an agent prompt, what it may read, what it may write, what it must produce, and a manual gate. I pick the template when I start a task, and the YAML is snapshotted into the `task` row so later edits never break a running task.

Write access is enforced by `hook.cjs` on `PreToolUse` (it sees `tool_input.file_path` for Edit/Write/MultiEdit), not by trusting the prompt. Plan mode is **not** used for Research and Plan, because plan mode blocks the artifact write; the hook does the fencing instead.

`resources/templates/standard.yaml`:

```yaml
name: standard
description: Research, plan, code, review. For features and anything non-trivial.
stages:
  - key: research
    title: Research
    prompt: prompts/research.md
    reads: [brief.md, issue.md, resources/]
    write: ["task:research.md"]          # task-folder files only
    produces: research.md
    gate: manual
  - key: plan
    title: Plan
    prompt: prompts/plan.md
    reads: [brief.md, issue.md, research.md, resources/]
    write: ["task:plan.md"]
    produces: plan.md
    gate: manual
  - key: code
    title: Code
    prompt: prompts/code.md
    reads: [plan.md, brief.md]
    write: ["worktree", "task:implementation.md"]
    produces: implementation.md
    requireCommits: true                  # gate disabled until branch has commits beyond base
    gate: manual
  - key: review
    title: Review
    prompt: prompts/review.md
    pre: ["npm test", "npm run lint", "npx tsc --noEmit"]   # run by the app, output to checks.txt; project `pre` overrides
    reads: [plan.md, implementation.md, checks.txt]
    write: ["task:review.md"]
    produces: review.md
    gate: manual
deny:                                     # applied to every stage by the hook
  - "git push"
  - "git merge"
  - "git rebase"
  - "gh pr merge"
  - "glab mr merge"
  - "git reset --hard"
  - "git checkout main"
```

`quickfix.yaml` is the same file with only `code` and `review`, where `code` reads `brief.md` and `issue.md` instead of `plan.md`.

Prompt files use `{{placeholders}}` filled at launch: `{{taskDir}}`, `{{worktree}}`, `{{issueKey}}`, `{{title}}`, `{{round}}`, `{{feedbackFile}}` (empty on round 1), `{{baseSha}}`. Each prompt is passed as the **initial message** of the interactive session, and a short role line goes in via `--append-system-prompt`.

The CLI records the system prompt on a session's first request and reuses it verbatim on every resume (`--system-prompt-snapshot` defaults to `on`). So the appended role line must be stable for the life of a stage session, and anything round-specific (feedback files, "round 2") goes in the message, never the system prompt. The "X READY" lines are a courtesy, not a signal: in Phase 0 the model skipped one. Readiness is always "the `produces` file exists and is non-empty".

**prompts/research.md**

```markdown
You are the RESEARCH stage for {{issueKey}}: {{title}}.
Task folder: {{taskDir}}. Code: {{worktree}} (read-only for you).

Read brief.md, issue.md and everything in resources/. Then explore the codebase.
Write {{taskDir}}/research.md with these sections:
- Problem restated in 3 sentences
- Relevant code (file:line, what it does, why it matters)
- Constraints and gotchas found
- Options considered (2-3), with trade-offs
- Open questions for the human
Do not plan the implementation in detail and do not edit code.
When research.md is complete, say "RESEARCH READY" and stop.
{{#feedback}}Revise based on {{feedbackFile}}.{{/feedback}}
```

**prompts/plan.md**

```markdown
You are the PLAN stage for {{issueKey}}: {{title}}.
Read brief.md, issue.md, research.md (approved) and resources/.
Write {{taskDir}}/plan.md:
- Chosen approach and why (one paragraph)
- Ordered steps, each with files touched and how to verify it
- Tests to add or change
- Out of scope
- Risks and rollback
Steps must be small enough for one commit each. Do not edit code.
When done, say "PLAN READY" and stop.
{{#feedback}}Revise based on {{feedbackFile}}.{{/feedback}}
```

**prompts/code.md**

```markdown
You are the CODE stage for {{issueKey}}: {{title}}.
Work only in {{worktree}} on the current branch. Follow {{taskDir}}/plan.md step by step.
Commit after each step with a message "{{issueKey}}: <step>". Never push. Never switch branches.
If the plan is wrong, stop and explain why instead of improvising a new plan.
Run the relevant tests before each commit.
At the end write {{taskDir}}/implementation.md: what you did per step, deviations from plan and why, anything left undone.
Then say "CODE READY" and stop.
{{#feedback}}Address every comment in {{feedbackFile}}. One commit per comment group.{{/feedback}}
```

**prompts/review.md**

```markdown
You are the REVIEW stage for {{issueKey}}: {{title}}.
You did not write this code. Be skeptical.
Inputs: plan.md, implementation.md, checks.txt, and `git diff {{baseSha}}...HEAD` in {{worktree}}.
Write {{taskDir}}/review.md:
- Verdict: PASS / NEEDS CHANGES
- Check results summary (from checks.txt)
- Plan coverage: each plan step -> done / partial / missing
- Findings, each with file:line, severity (blocker/major/minor), and a concrete fix
- Things the diff touches that the plan did not mention
Do not edit code. Say "REVIEW READY" and stop.
```

## Session engine

Every stage is a real interactive `claude` process in a node-pty, rendered in xterm.js, so I can type into it mid-stage and answer its permission prompts. State never comes from scraping the terminal; it comes from hooks, transcript files and artifact files.

**Launch** (`sessions.ts`, cwd = task worktree):

```text
claude "<rendered stage prompt>" \
  --session-id <uuid generated by the app> \
  --append-system-prompt "You are the <STAGE> agent in YANTRA. Stay in your lane." \
  --add-dir <taskDir> [--add-dir <each project sharedDir>] \
  --settings <taskDir>/.stage/settings-<stage>.json \
  --no-chrome \
  [--model <template model, if set>]
```

`--add-dir` is variadic, so the positional prompt goes first. `--no-chrome` stops stage agents driving my browser and suppresses the Chrome-extension prompt. Never pass `--bare` or `--safe-mode`: both disable hooks.

**Resume / feedback round:** `claude --resume <session_id> "<feedback prompt pointing at feedback/<stage>-round-N.md>"` (verified in Phase 0: same session ID, `SessionStart.source = "resume"`, full context). **After an app crash:** the same, with no prompt.

**Env passed to the PTY:** the user's env **minus every `CLAUDE*` variable and `ELECTRON_RUN_AS_NODE`** (YANTRA may itself be started from inside a Claude Code session, and inherited `CLAUDECODE`/`CLAUDE_CODE_*` vars make the CLI think it is nested), plus `YANTRA_TASK_DIR`, `YANTRA_WORKTREE`, `YANTRA_STAGE`, `YANTRA_RUN_ID`, `YANTRA_POLICY` (path to a JSON policy file with the stage's `write` list and the template's `deny` list), `CLAUDE_CODE_ENABLE_TELEMETRY=0` for MVP, and `TERM=xterm-256color`.

**Pre-flight before any launch** (`preflight.ts`, run at app start and before each spawn, cached for the session):

1. `claudeBinary` exists and `claude --version` runs; the version is recorded per run.
2. `claude auth status` (JSON, exit 1 when logged out) reports `loggedIn: true`.
3. `~/.claude.json` has `hasCompletedOnboarding: true`.

If 2 or 3 fails, the stage doesn't launch. A blocking banner says "Open a terminal, run `claude` once, pick a theme and log in", with a **Check again** button. A stage terminal must never show the onboarding screens.

**Workspace trust:** the first launch in any new folder (so every new worktree) shows "Is this a project you created or one you trust?", whose **default is "No, exit"**. Pressing Enter quits with exit code 1. **Decided in Phase 3: option (a).** At worktree creation YANTRA sets `projects["<path>"].hasTrustDialogAccepted = true` in `~/.claude.json` (path with forward slashes, the way Claude keys it; nothing else in the file changes; written to a temp file and renamed), behind the **Trust new worktrees automatically** setting, which is on by default. With it off, the dialog shows in the stage terminal and I answer it. An exit with code 1 in the first seconds of a run is shown as "Claude exited at the trust prompt" with a **Retry**, not as a crash.

**Generated settings file** (one per stage launch):

```json
{
  "hooks": {
    "SessionStart":     [{ "hooks": [{ "type": "command", "command": "<hookWrapper>" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "<hookWrapper>" }] }],
    "PreToolUse":       [{ "matcher": "*", "hooks": [{ "type": "command", "command": "<hookWrapper>" }] }],
    "PostToolUse":      [{ "matcher": "*", "hooks": [{ "type": "command", "command": "<hookWrapper>" }] }],
    "Stop":             [{ "hooks": [{ "type": "command", "command": "<hookWrapper>" }] }],
    "SessionEnd":       [{ "hooks": [{ "type": "command", "command": "<hookWrapper>" }] }]
  },
  "permissions": { "deny": ["Bash(git push:*)", "Bash(git merge:*)", "Bash(gh pr merge:*)", "Bash(glab mr merge:*)"] }
}
```

`<hookWrapper>` is a tiny script the app writes to `~/Yantra/bin/` at startup: `hook.cmd` on Windows (my primary OS: Windows 11) or `hook.sh` elsewhere, running `ELECTRON_RUN_AS_NODE=1 "<process.execPath>" "<path>/hook.cjs"`. The Windows version, verified in Phase 0 on a machine with no bash:

```bat
@echo off
set ELECTRON_RUN_AS_NODE=1
"<process.execPath>" "<path>\hook.cjs"
exit /b %ERRORLEVEL%
```

Reference it in the settings file with forward slashes. Quote paths carefully (spaces in `Program Files`). Don't disable Electron's `RunAsNode` fuse when packaging, or this breaks. `electron.exe` is a GUI-subsystem binary whose stdout doesn't reach a console, which is fine because hooks communicate through the exit code, stderr and the log file.

**`hook.cjs` contract** (zero dependencies, must finish in under 100 ms):

1. Read the JSON payload from stdin, stripping a leading UTF-8 BOM (Windows shells add one) before `JSON.parse`. Fields: `hook_event_name`, `session_id`, `transcript_path`, `cwd`, `prompt_id`; tool events add `tool_name`, `tool_input`, `tool_use_id`; see `fixtures/hooks/` for the real shapes and validate them with zod in main, permissively (unknown fields allowed).
2. Append one line to `$YANTRA_TASK_DIR/log/hooks.jsonl`: `{ts, runId, stage, event, sessionId, transcriptPath, tool, summary}`. Summary = Bash command, or file path, truncated to 300 chars.
3. On `PreToolUse` only, block and `exit 2` with a reason on stderr when:
   - a shell command (`tool_name` is `Bash` **or `PowerShell`**; on Windows Claude uses `PowerShell`; command in `tool_input.command`), after collapsing whitespace and stripping quotes, contains any `deny` entry (also check inside `sh -c`/`bash -c`/`cmd /c`/`powershell -Command` strings, best effort). The list of shell tool names lives in one constant so a new one is a one-line change;
   - an Edit/Write/MultiEdit/NotebookEdit `file_path` resolves outside the stage's `write` list (`task:<file>` = that exact file in the task dir, `worktree` = anything under the worktree); compare paths case-insensitively on Windows;
   - `task:plan.md` / `task:research.md` are touched by any stage other than their owner.
4. Log the block with `blocked: true`. Otherwise `exit 0` silently.

Be honest in the UI that this fence is best effort: an agent with a shell can still do odd things. The real guarantees are that the app never merges, never pushes without my click, and the remote's branch protection stops merges anyway.

**Event handling in main** (`hooks.ts`, chokidar tail with a byte offset per file):

| Hook event | Effect |
| --- | --- |
| `SessionStart` | store `transcript_path` on the run (`source` is `startup` or `resume`), stage status `running` |
| `UserPromptSubmit` | stage `running`, open an active-time interval. A `prompt` starting with `<task-notification>` is the CLI waking the agent after a background subagent finished, not me; it counts as agent-active time and is tagged as such in the timeline |
| `PreToolUse` / `PostToolUse` | insert `event` rows (tool timeline); blocked events raise a toast |
| `Stop` | close active interval. **If `background_tasks` has any entry with `status: "running"`, the stage stays `running`** (subagents run in the background, and a new turn follows when they finish). Otherwise stage `idle`; if `produces` file exists and is non-empty (and `requireCommits` is satisfied) → `awaiting_approval`, set `awaiting_since`, notify. Store `last_assistant_message` on the stage for the card and rail tooltip |
| `SessionEnd` | run `ended_at` (`reason`, e.g. `prompt_input_exit`), copy transcript and its `subagents/` folder into `log/`, parse usage (see Metrics) |

Every stage status change emits `board:changed` and `task:changed` so cards, rail and sidebar counts update live.

**PTY plumbing:** main keeps a 2 MB ring buffer of output per run, so closing and reopening a tab redraws instantly. IPC channels: `pty:data` (main→renderer, batched every 16 ms), `pty:input`, `pty:resize`. Closing a tab never kills the process; only an explicit **Stop session** does: send `/exit`; if the CLI answers with "Background work is running" (option 1, "Exit and stop tasks", is the default), send Enter; kill after 5 s. The xterm theme is generated from the design tokens and switches with the app theme.

**Windows/ConPTY notes:** after the child exits, node-pty keeps a ConPTY handle open, so always call `pty.kill()` and drop the reference on `onExit`. A `kill()` after exit can print a harmless `AttachConsole failed` trace; swallow it. The app never parses the screen to drive Claude: pre-flight and the trust decision exist so that it doesn't have to.

**Concurrency:** at most `maxConcurrentSessions` live PTYs. Extra launches go to status `queued` and start FIFO when a slot frees. Idle stages awaiting my approval still hold a slot; **End session** frees it without losing anything (resume later by session id).

**App restart:** on boot, every stage in `running`, `idle` or `queued` becomes `interrupted`, with a **Resume** button. Nothing auto-restarts, because surprise Claude sessions burn usage limits.

## State machine

The state machine is the product: `machine.ts` is pure functions (state + action → new state + side effects to perform), unit-tested without Electron. Everything else just executes the side effects.

```text
draft ──Start──▶ active ──approve last stage──▶ ready_to_ship ──Push branch──▶ pushed ──Mark done──▶ done
  │                │  ▲                                │
  │                │  └── send back / request changes ─┘ (from Review)
  └──── Abandon ───┴──────────── Abandon (any state before done) ─────────────▶ abandoned
```

Inside `active`, each stage goes pending → queued → running ⇄ idle → awaiting_approval → approved, and every forward arrow between stages is an approval click.

```ts
// src/main/machine.ts
export type TaskStatus = 'draft' | 'active' | 'ready_to_ship' | 'pushed' | 'done' | 'abandoned';
export type StageStatus =
  | 'pending' | 'queued' | 'running' | 'idle'
  | 'awaiting_approval' | 'approved' | 'skipped' | 'interrupted';

export type Action =
  | { type: 'startTask' }                                   // draft -> active, first stage queued
  | { type: 'launchStage'; stageKey: string }               // pending|interrupted -> queued
  | { type: 'slotFree'; stageKey: string }                  // queued -> running (spawn)
  | { type: 'hook'; event: 'UserPromptSubmit' | 'Stop' | 'SessionEnd'; stageKey: string;
      artifactReady: boolean; backgroundRunning: boolean }  // Stop + backgroundRunning keeps the stage running
  | { type: 'approve'; stageKey: string; artifactHash: string }
  | { type: 'reject'; stageKey: string; feedback: string }  // same stage, round+1, resume session
  | { type: 'sendBack'; toStageKey: string; feedback: string } // earlier stage, round+1; later stages reset to pending
  | { type: 'skip'; stageKey: string }
  | { type: 'appRestart' }                                  // running|idle|queued -> interrupted
  | { type: 'pushed' }                                      // ready_to_ship -> pushed
  | { type: 'finish' }                                      // pushed (or ready_to_ship) -> done (cleanup)
  | { type: 'abandon' };                                    // any but done -> abandoned (cleanup, no push)

export type Effect =
  | { kind: 'spawn'; stageKey: string; mode: 'start' | 'resume'; feedbackFile?: string }
  | { kind: 'kill'; stageKey: string }
  | { kind: 'snapshotArtifact'; stageKey: string }          // commit task-folder repo
  | { kind: 'writeFeedback'; stageKey: string; round: number; text: string }
  | { kind: 'runChecks'; stageKey: string }                 // template/project `pre` commands
  | { kind: 'notify'; reason: 'awaiting_approval' | 'blocked' | 'checks_done'; stageKey: string }
  | { kind: 'cleanup'; keepBranch: boolean };

export function reduce(task: TaskState, action: Action): { task: TaskState; effects: Effect[] };
export function legalActions(task: TaskState): Action['type'][];   // drives which buttons the UI shows
```

**Rules the reducer enforces:**

1. Only one stage of a task is `running`/`idle`/`queued` at a time. Stages run in template order.
2. `approve` is only legal from `awaiting_approval`. It snapshots the artifact (sha256 into `approved_hash`, commit in the task-folder repo), kills the session, and launches the next non-skipped stage. Approving the last stage moves the task to `ready_to_ship`.
3. `reject` writes `feedback/<stage>-round-N.md`, bumps `round`, and resumes the **same** session.
4. `sendBack` from Review to Code (the common case) or from Code to Plan: target stage round+1 and resumes its session; every stage after the target goes back to `pending` and its approval is cleared. Legal from `ready_to_ship` too (task goes back to `active`). Hash mismatches on later approve are fine, because the history is in the task-folder repo.
5. A stage with `pre` commands runs them (`runChecks`) before spawning, writing combined output plus exit codes to `checks.txt`. Failing checks don't block; the reviewer reads them.
6. If I edit an approved artifact by hand, the UI shows "modified since approval" by comparing hashes, and the next stage's prompt uses the file as it is on disk.

**Task creation flow** (`createTask` in main, each step idempotent so a half-failed start can be retried; progress shown as a checklist in the Start task dialog):

1. Create the task folder, `git init` it, write `issue.md` from the local issue and `brief.md` prefilled from the issue body, copy issue attachments into `resources/`.
2. `git -C <repo> fetch <remote>` (skip with a warning if offline or no remote), then `git -C <repo> worktree add -b yantra/<issue-key>-<slug> <worktreePath> <remote>/<defaultBranch>` (fall back to local `<defaultBranch>` without a remote), then record `base_sha`.
3. Run the project's `worktreeSetup` commands in the worktree, streaming output into a setup log in the dialog.
4. Open the task tab on the Files sub-tab with `brief.md` in the editor. The task stays `draft` (card in In Progress, badge "Draft") until I click **Start**, so I can fill `brief.md` and `resources/` first.

## Review, ship and done

My review happens in the app before anything leaves my machine: diff, line comments, then either send them back to the Code agent or ship.

**Diff tab.** Source is `git diff <base_sha>...HEAD` in the worktree (so commits on the default branch after branching don't pollute it), parsed with `gitdiff-parser`, rendered side-by-side or unified (toggle, remembered), themed from tokens with JetBrains Mono. Next to it sits a commit list (`git log --oneline <base_sha>..HEAD`) where clicking a commit shows that commit's diff. A file tree with +/- counts, and "viewed" checkboxes per file kept in memory.

**Comments.** Click a line gutter to add a `review_comment` (state `draft`). The Review stage's `review.md` findings are shown in a side panel, colour-coded by severity; each has a **Make comment** button that pre-fills a draft at that file:line.

**Three exits from review:**

1. **Send back to Code:** all `draft` comments become `feedback/code-round-N.md` (grouped by file, with file:line and the line's text for context), state becomes `sent_to_agent`, and the Code session resumes with "Address every item in feedback/code-round-N.md". When Code finishes, Review runs again, a new round.
2. **Approve and ship:** the task moves to `ready_to_ship` and the card to Review. The Ship panel shows a generated PR title (`<issue-key>: <issue title>`) and a description built from:
   - the first paragraph of `plan.md` (approach)
   - plan steps as a checklist
   - a 3-5 line summary of `research.md` (main findings, rejected options)
   - the deviations section of `implementation.md`
   - a metrics footer (stages, rounds, agent time, tokens)

   All of it is editable in a Write/Preview editor and saved to `pr.md` in the task folder.
3. **Abandon:** confirm dialog, then cleanup without pushing; the issue returns to Todo.

**Ship = separate buttons, on purpose:** **Push branch** (runs `git push -u <remote> <branch>` with my normal git credentials and shows output; never `--force` unless I click a separate **Force push** button), **Copy PR description** (title + body to the clipboard), and **Copy branch name**. After a successful push the task moves to `pushed` and the header shows "Pushed · open your PR". I open the PR/MR in the forge myself, paste, and merge myself.

**Done.** A **Mark done** button on `pushed` (or `ready_to_ship`, for work I merge locally by hand) tasks. Cleanup: `git worktree remove <path>` (refuse if there are uncommitted changes, with a force option), keep the local branch, final commit in the task-folder repo, write `manifest.json` (issue row + task row + stage rows + totals) into the task folder for archival, set `closed_at`, close the tab. The card moves to Done; the task stays in the **Done** view, and its folder, transcripts and metrics stay.

## Metrics

Tokens come from Claude's own transcript files and time comes from hook timestamps, so MVP needs no OpenTelemetry collector and no listener. Every dollar figure is an estimate from the configured price table, labelled as such in the UI.

**Token parsing** (`metrics.ts`):

1. Transcript path comes from the `SessionStart` hook payload (`transcript_path`), stored on the run.
2. On every `Stop` and on `SessionEnd`, read the transcript from the last byte offset (incremental, so live numbers update after each turn).
3. Keep lines with `type === "assistant"` and ignore every other type (there are many: `attachment`, `system`, `api-request*`, `cost-state`, `file-history-*`, …). Usage lives at `message.usage`: `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`; model at `message.model`. Skip messages whose model is `<synthetic>` (CLI-generated, no API call).
4. **Dedupe by `message.id`.** One API response is written as several lines (one per content block) with the same id and usage, so summing lines double-counts (Phase 0 fixture: 1242 output tokens naive vs 736 deduped). Upsert into `usage` keyed by message id.
5. Subagent usage (verified on 2.1.312): each subagent has its own file at `<session-id>/subagents/agent-<agentId>.jsonl` next to the session transcript, every line `isSidechain: true`, plus `agent-<agentId>.meta.json` (`agentType`, `description`, `toolUseId`, `finished`). The main transcript carries no sidechain lines. A run's usage = main file + every subagent file, each read incrementally and deduped, stored with `is_sidechain = 1` for subagent rows. Also accept inline `isSidechain` lines in the main file in case an older or newer CLI puts them there.
6. Record `claude --version` per run, since the transcript format is not a stable API. Parse defensively: unknown shapes get logged and skipped, never crash. `fixtures/transcripts/` holds a redacted real transcript with a subagent; its tests are the ones to re-run after a CLI upgrade.

**Time accounting** (three clocks, never one):

| Clock | Definition | Source |
| --- | --- | --- |
| Agent active | sum of `UserPromptSubmit` → `Stop` intervals | hooks |
| Waiting on me | sum of `awaiting_approval` durations plus interrupted/queued time | stage timestamps |
| Wall clock | task `created_at` → `closed_at` (or now) | task row |

Permission prompts I'm slow to answer count as agent-active in MVP. v1.1 can subtract them using the `Notification` hook.

**Metrics tab per task:** a stage table (round count, agent-active minutes, waiting-on-me minutes, input/output/cache tokens, estimated cost, tool calls, blocked calls), a tool timeline from `event` rows (filterable: Bash, Edit, Read, blocked only), and a link to the raw transcript. **Metrics view (global):** per-project totals, a sortable list of done tasks, and simple bar charts (plain SVG, no chart library) of tokens and agent time per template and per label, so I can see which kind of issue eats tokens.

## Build phases

Eight phases, each ending in a working app and a stop for my review. Test with a throwaway repo (with a throwaway local bare repo as `origin`) until Phase 6 passes.

**Testing baseline for every phase:** `vitest` for pure logic (`machine.ts`, board ordering and column derivation, hook policy, transcript parser, PR description builder), fixtures captured in Phase 0, `npm run typecheck` and `npm test` green before stopping. Screens are checked by eye in both themes.

### Phase 0: Spike (prove the risky bits) ✅ done

Throwaway code in `spike/`. Results in `docs/phase-0.md`, findings in `docs/cli-notes.md` (claude 2.1.312, Electron 45.1.0, Windows 11); this spec already includes them.

- [x] node-pty (ConPTY on Windows) and better-sqlite3 load in Electron (prebuilds, no rebuild needed).
- [x] An Electron window shows xterm.js running interactive `claude` with an initial prompt, `--session-id`, `--settings`, `--add-dir`, `--append-system-prompt`. Typing works, resize works.
- [x] `claude --resume <id> "<prompt>"` reopens the same session interactively.
- [x] The `hook.cmd` wrapper via `ELECTRON_RUN_AS_NODE` fires for all six events; captured payloads saved to `fixtures/hooks/`.
- [x] `PreToolUse` exit 2 blocks a `git push` attempt and Claude sees the reason.
- [x] A real transcript saved to `fixtures/transcripts/` (redacted), with duplicate `message.id` lines confirmed and the subagent file layout noted.
- [x] `docs/cli-notes.md` lists the installed `claude --version`, every flag verified, and every deviation from this spec.

### Phase 1: Skeleton and design system

- [x] electron-vite app with main/preload/renderer, strict TS, typed `window.api` generated from one shared IPC contract type.
- [x] Config load/save with zod; SQLite with the full schema and `user_version` migrations.
- [x] `tokens.css`, fonts, light/dark/system theme, every `ui/` primitive, and the `DevUi` view.
- [x] App shell: sidebar (collapsible), top bar with pinned board tab, status bar (placeholder numbers), command palette with navigation commands.
- [x] `preflight.ts` (binary, version, `claude auth status`, onboarding flag) wired into onboarding and Settings → Test.
- [x] Onboarding wizard and Settings → Projects/General/Pricing.
- [x] Acceptance: add a project through onboarding, restart, it's still there; pre-flight shows the logged-in email, and a wrong binary path shows a clear error; `DevUi` looks finished in both themes; keyboard focus is visible everywhere.

### Phase 2: Local board

- [x] `board.ts`: issues, labels, comments, attachments, `issue_seq` numbering, fractional ordering with renormalization, `deriveColumn`.
- [x] Board view with dnd-kit (mouse and keyboard), column counts, inline "Add issue", `C` shortcut, filter bar, archive.
- [x] Issue drawer: title, Markdown body with autosave, priority, labels (create inline), comments, attachments.
- [x] Empty states and the first-run tip; palette can jump to issues by key.
- [x] Acceptance: create, edit, label, move, reorder and archive issues; order survives restart; the whole flow works keyboard-only; unit tests for ordering math and column derivation.

### Phase 3: Task creation and Files

- [x] Start task dialog (from drawer button or drag into In Progress), template picker, creation checklist with live setup log.
- [x] Task folder + `git init`, `issue.md`, prefilled `brief.md`, attachments → `resources/`, worktree + branch, `base_sha`, `draft` status, card shows "Draft".
- [x] Task tab with header and empty stage rail; Files sub-tab with tree, `brief.md` Write/Preview editor, `resources/` drag-and-drop.
- [x] Decide and implement worktree trust (pre-trust in `~/.claude.json` behind a setting, or banner); document it in `docs/phase-3.md`.
- [x] Acceptance: start a task from a card; folder, worktree and branch exist; starting it twice is a no-op, not a crash; cancelling the drag dialog puts the card back.

### Phase 4: Sessions

- [x] `sessions.ts` PTY manager with ring buffer, launch/resume/stop/end, concurrency queue.
- [x] Settings file and policy file generation per launch; `hook.cjs` with the policy logic exported as a pure function and unit-tested against `fixtures/hooks/` (including the `PowerShell` tool, Windows paths and a BOM-prefixed payload).
- [x] `hooks.ts` tailer writing `event` rows and driving stage status, including `Stop` with running `background_tasks` and `<task-notification>` prompts; `board:changed` live updates.
- [x] Stop session handles the "Background work is running" exit dialog.
- [x] Terminal sub-tab themed from tokens; closing and reopening the tab keeps the session and redraws. Cards show running/interrupted indicators; Running view lists live sessions.
- [x] Acceptance: launch a stage by hand, watch it run, ask it to `git push` (blocked, toast shown), have it use a background subagent (stage stays `running` until the subagent's turn ends), quit the app mid-run, reopen: stage is `interrupted`, **Resume** continues the same session.

### Phase 5: Pipeline

- [x] Template loader + zod schema; `standard.yaml`, `quickfix.yaml`, four prompt files with placeholder rendering.
- [x] `machine.ts` reducer and `legalActions` with unit tests covering every action, including `sendBack` resetting later stages.
- [x] Stage rail stepper and action bar (Approve / Request changes / Send back to / Skip / End session) driven by `legalActions`.
- [x] Artifact snapshot commits in the task-folder repo; "modified since approval" badge.
- [x] Checks runner for `pre` commands writing `checks.txt`.
- [x] Card stage dots, "Needs you" badge, sidebar Needs-you count, OS notification.
- [~] Acceptance: run `quickfix` end to end on the toy repo, then `standard` including one reject and one send-back from Review to Code; nothing advances without my click; the card follows along on the board.

### Phase 6: Review and ship (local)

- [ ] Diff sub-tab (base...HEAD), commit list, file tree, line comments, review.md findings panel.
- [ ] Send back to Code with `feedback/code-round-N.md`.
- [ ] Ship panel: generated, editable PR description saved to `pr.md`; separate Push branch, Force push, Copy PR description, Copy branch name.
- [ ] Mark done with cleanup and `manifest.json`; Abandon returns the issue to Todo.
- [ ] Acceptance: the branch appears on the throwaway `origin` with the task's commits; `pr.md` reads well; a grep test fails if the codebase contains `git merge`, `git rebase`, `/merge`, `auto_merge` or `merge_when_pipeline_succeeds` outside the hook deny lists.

### Phase 7: Metrics

- [ ] Incremental transcript parser for the main file plus `subagents/*.jsonl`, dedupe by `message.id`, skipping `<synthetic>`, tested on `fixtures/transcripts/` (expected: 736 main output tokens, 166 subagent).
- [ ] Three clocks, Metrics sub-tab, live status bar totals, global Metrics view and Done view.
- [ ] Acceptance: token totals for a finished task match a manual sum of unique message ids in its transcripts.

### Later (not MVP)

- **Forge adapter** (GitLab first, then GitHub) behind one `IssueSource` interface: import issues into the local board as linked cards, and create the PR/MR from the Ship panel. Never merge or approve, permanently.
- Custom board columns and WIP limits, OpenTelemetry export, a rebase-on-default-branch helper, a cross-model reviewer, custom per-task templates built in the UI, packaging and auto-update.

## Out of scope and known risks

**Out of scope for MVP, so don't build it even if it seems easy:** any forge integration, multi-user anything, sync of the board with any forge board, sub-issues/epics, due dates, sprints, auto-merge or approve (permanently, not just MVP), parallel stages within one task, the Agent SDK, any HTTP server, cloud sync, code signing and auto-update, and a plugin system.

| Risk | Why it bites | Mitigation |
| --- | --- | --- |
| Claude Code CLI changes flags, hook payloads or transcript format | Near-daily releases; transcript is not a public API | Phase 0 notes, version recorded per run, zod-parse hook payloads, defensive transcript parser, fixture tests to re-run after upgrades |
| Native module breakage (node-pty, better-sqlite3) | A future version could drop its N-API prebuilds and need Visual Studio to compile | Pin exact versions, keep `allowScripts` as in Stack, re-run `spike/check-native.cjs` before any upgrade; `node:sqlite` is the fallback for the DB |
| First-run and trust prompts inside stage terminals | Onboarding, login and the trust dialog (default "No, exit") block or kill a stage | Pre-flight before every launch; the worktree-trust decision in Phase 3; exit code 1 at the trust prompt shown as such, with Retry |
| Windows quoting and paths | Hook wrapper, `cmd /c`, backslashes, case-insensitive paths | Policy function unit-tested with Windows fixtures; paths normalized with `path.win32` |
| Hook fence bypassed | Agents with a shell can obfuscate commands | Fence is best effort; the app never merges, only pushes on my click, and branch protection on the remote is the real control |
| Usage limits burned by parallel sessions | Several live sessions on one subscription | `maxConcurrentSessions` default 3, no auto-restart, End session frees slots |
| Worktree disk bloat | `node_modules` per worktree | Cleanup on Done/Abandon; consider pnpm for its shared store |
| Base branch drift | Long-lived tasks fall behind | Show "N behind <defaultBranch>" in the header; rebase helper later |
| Board and task disagree | Two places could claim the column | Column is derived from the task once one exists (`deriveColumn`), never stored twice |
| Design scope creep | "Make it pretty" has no end | Design is limited to the tokens, primitives and screens in this spec; anything else goes to Later |
| Secrets in task folders | Briefs and resources may hold sensitive notes | Folders live outside repos, task repos are never pushed, `.env` copied by setup is in the worktree's `.gitignore` |
| Spec drift during the build | Claude Code improvises on vague bits | One phase per session, `docs/phase-N.md` after each, I review before the next |

Auth note: the app launches the official, unmodified `claude` binary under my own login, which is the arrangement Anthropic's terms explicitly allow for subscriptions. If that ever changes, switch the launcher to API-key auth via the `ANTHROPIC_API_KEY` env var; nothing else in the design depends on how the CLI is authenticated.
