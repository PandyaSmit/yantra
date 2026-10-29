# Phase 4: Sessions

A stage now runs real `claude` in a PTY. You launch it from the task header, watch and type in the Terminal sub-tab, and the hook fence blocks pushes and merges. Hook events, not the screen, decide whether a stage is running, idle, waiting for you or interrupted. Sessions survive closing the tab, and after a quit, Resume continues the same conversation.

## Acceptance checks

All checks ran in the built app with real `claude` 2.1.312, against a throwaway `YANTRA_HOME` and a toy repo with a bare `origin`, on task YAN-1 (`quickfix`). Pre-trust wrote to the real `~/.claude.json` (removed afterwards, see below).

| Check | Result |
| --- | --- |
| Launch a stage by hand, watch it run | ✅ Launch Code switched to the Terminal tab. `claude` opened with no trust prompt (pre-trust works end to end, closing the open item from Phase 3). The stage went to running. Typing in the terminal worked, including answering permission prompts. |
| `git push` is blocked, toast shown | ✅ for the block: claude ran `git push origin HEAD` through the PowerShell tool, the hook exited 2, and claude saw the reason. An `event` row with `blocked = 1` was recorded. ⚠️ The toast path (`notice` → toast with Open task) is unit-tested, but it wasn't screenshotted in this run. |
| Background subagent keeps the stage running | ✅ claude started a background subagent. Its main turn's `Stop` arrived with background work running, and the stage stayed running. The `<task-notification>` prompt woke it (recorded as `UserPromptSubmit · task-notification`). After the commit and `implementation.md`, it went to awaiting approval: "Needs you" on the card, in the Running view and on the rail. An earlier `Stop`, before the commit existed, went to idle because quickfix's `requireCommits` gate held. |
| Closing and reopening the tab | ✅ The terminal redraws from the ring buffer and keeps streaming. |
| Quit mid-run, reopen: interrupted, Resume continues | ✅ Closing the window killed claude. On relaunch the stage was interrupted with Resume. Resume ran `--resume <same id>` (SessionStart `source=resume`), and claude had the earlier conversation. |
| Stop session | ✅ Overflow → Stop session… → confirm. claude exited cleanly (code 0), the run is marked `stopped`, the rail says "Code was stopped", and Resume is offered. |
| Running view, status bar, card indicators | ✅ The Running view lists the live session (key, title, stage, started, last message), and the status bar shows `n/max sessions live`. Cards show the stage pill and a border while running, needs-you or interrupted. |
| Light and dark | ✅ Terminal (live and read-only), Running (list and empty state), board cards and the task header in both themes. |

Typecheck clean, 129 tests pass (48 new: 32 hook, 16 sessions), build succeeds.

## What's in place

- **Hook (`resources/hook.cjs`):** zero-dependency CommonJS, run by `<YANTRA_HOME>/bin/hook.cmd` through Electron with `ELECTRON_RUN_AS_NODE`.
  - The policy is the pure `decide(payload, policy, platform)`.
  - Shell commands (`Bash` and `PowerShell`) are normalized before matching against the deny list: quotes, backticks and `^` removed, `git.exe` treated as `git`, git global options (`-c x=y`, `--git-dir=…`) dropped.
  - Write tools are fenced to the stage's `write` entries: `worktree`, or `task:<file>`, plus Claude's own scratchpad. Matching is case-insensitive on Windows.
  - A missing policy fails closed: no writes allowed, and push/merge denied.
  - Every event appends one JSON line to `log/hooks.jsonl`. A BOM-prefixed payload is accepted.
- **Launch (`src/main/launch.ts`):**
  - Per stage it writes `.stage/settings-<stage>.json` (six hook events, plus `permissions.deny` for push and merge) and `.stage/policy-<stage>.json`.
  - Renders the stage prompt (`{{x}}`, `{{#feedback}}…{{/feedback}}`) from `<YANTRA_HOME>/prompts` or the shipped `resources/prompts`.
  - Builds argv and env. The env drops `CLAUDE*` and `ELECTRON_RUN_AS_NODE`, sets `YANTRA_*`, and turns telemetry off.
- **Sessions (`src/main/sessions.ts`):**
  - One PTY per run, with a 2 MB ring buffer, output batched to the renderer every 16 ms, and the buffer saved to `log/terminal-<run>.log` on exit and on quit.
  - FIFO queue behind `maxConcurrentSessions`. Pre-flight runs before the first launch (cached once it passes).
  - You can launch the task's current stage when it's pending (start), interrupted (resume), or awaiting approval with no live PTY (reopen).
  - On exit, a running, idle or queued stage becomes interrupted. If SessionStart never arrived, it goes back to pending.
  - A non-zero exit within 30 s with no SessionStart is flagged as the trust prompt.
  - On boot, open stages are marked interrupted.
- **Stop session:**
  1. ESC if the stage is running, then `/exit` and Enter.
  2. Enter again if claude shows "Background work is running".
  3. Kill after 5 s.
- **Hook events (`src/main/hooks.ts`):**
  - Tails each task's `hooks.jsonl` from a byte offset (chokidar plus a 1 s poll), in order, keeping partial lines.
  - Writes `event` rows and moves the stage:
    - SessionStart: running (idle on resume).
    - UserPromptSubmit: running.
    - Stop: running while background work runs; awaiting approval when the artifact is ready; otherwise idle. A subagent's own Stop is ignored.
    - SessionEnd: copies the transcript (and its subagents folder) into `log/`.
  - A block raises an error toast; reaching awaiting approval raises a success toast.
- **DB (migration 3):** `run.transcript_path`, `run.exit_note`, `stage.last_message`, and indexes on `event(run_id)` and `run(stage_id)`.
- **IPC:** `sessions:start|launch|stop|attach|runs|summary`, `pty:input|resize`. Events: `pty:data`, `pty:exit`, `sessions:changed`, `notice`.
- **Renderer:**
  - **Header action:** the button reads Start, Launch <Stage>, Resume, Queued or Reopen session. The overflow menu holds Stop session…, End session… and Leave the queue.
  - **Banners:** pre-flight (with Check again) and trust prompt (with Retry).
  - **Status line** under the rail.
  - **Terminal tab:** xterm themed from tokens, which follows the theme toggle. A run picker follows the live run, and ended runs replay read-only.
  - **Running view, status bar, card pill and border.** Toasts from `notice` offer Open task.

## Deviations from SPEC.md

1. **Prompt files came forward from Phase 5** (`resources/prompts/*.md` and rendering). A stage can't launch without its prompt. The template loader itself came forward in Phase 3.
2. **`--permission-mode acceptEdits`.** Without it, every edit inside the fence asks first. The fence is the real guard; shell commands still ask.
3. **Migration 3 columns** (`transcript_path`, `exit_note`, `last_message`) weren't in the schema. They're needed for transcript copy, the trust and stopped notes, and the status line.
4. **"Reopen session" for a stage awaiting approval** whose PTY is gone (after a quit or a stop). Otherwise you can't talk to it again before Phase 5's Request changes exists.
5. **Resume goes to idle, not running:** a resume with no prompt waits at claude's input box. A feedback prompt (Phase 5) is a UserPromptSubmit and moves it to running.
6. **Claude's own scratchpad is writable** inside the fence. claude keeps its temp files there, outside the worktree and task folder.
7. **The status bar's session count still links to Metrics.** Running is one click away in the sidebar.
8. **The card pill shows the status only;** the stage name is in its tooltip. "Code: running" didn't fit a card next to the key and priority. The pill wraps below the key on narrow cards.

## Bugs found while verifying (fixed)

- **`git.exe push` slipped past the deny list:** `.exe` was only stripped when git options followed.
- **A resumed stage showed Running** while claude sat waiting for input.
- **Quitting lost the terminal output of live runs.** Buffers are now saved in `killAll`. The first version of the fix wrote the pending batch twice.
- **The status line showed a stale last message** while the stage was running.
- **A stopped stage was described as "interrupted (the app quit…)".** It now says "was stopped".
- **The card key wrapped** ("YAN-" / "1") beside the pill, and later the pill was clipped ("Interruptec") on narrow cards.

## Cleanup after testing

`~/.claude.json` was backed up before the real runs. Afterwards, two `projects` entries under the scratch folder were removed: the YAN-1 worktree (written by pre-trust) and the toy repo root (added by claude itself, which also records a worktree's main repo). Only those keys were edited, and the `projects` keys then matched the backup exactly; the backup was then deleted. The older `spike/out/toyrepo` entry from Phase 0 was left alone; remove it by hand if you like.

## Skipped / not tested

- **The blocked-push toast** wasn't captured on screen in the real run (unit-tested).
- **Ctrl+B to background a running foreground tool** wasn't tried. The background case tested was a subagent claude started in the background itself.
- **The trust-prompt path with pre-trust off**, and the pre-flight banner with a broken binary, were only unit-tested.
- **The concurrency queue** with more stages than `maxConcurrentSessions` was only unit-tested (one real session at a time).
- **End session and Leave the queue** weren't clicked; they share the stop path with Stop session.
- **The first run's terminal log is missing:** that run was killed before the `killAll` fix, so it can't replay. Later runs replay.
- **Only Windows 11 was tested.**

## How to try it

```text
npm run dev
Open a task → Start / Launch <Stage>     the Terminal tab opens with claude
… → Stop session                         clean exit; Resume continues it
Quit mid-run, reopen → Resume            same conversation
Sidebar → Running                        live, queued and idle sessions
```
