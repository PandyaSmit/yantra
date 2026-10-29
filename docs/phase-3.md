# Phase 3: Task creation and Files

Starting a task from a card now creates everything a task needs: a draft task row with its stages, the task folder, a branch in its own worktree, and the project's setup commands. The task opens in its own tab, where the Files sub-tab shows the task folder and edits `brief.md`.

## Acceptance checks

| Check | Result |
| --- | --- |
| Start a task from a card | ✅ In the built app, against a throwaway `YANTRA_HOME` and a toy repo with a bare `origin`. Dropping YAN-11 on In Progress opened the Start task dialog. Create task showed the checklist with the setup log streaming, then opened the task tab on Files with `brief.md`. YAN-12 was started from the drawer's Start task button. |
| Folder, worktree and branch exist | ✅ `git worktree list` showed `yantra/YAN-11-inline-one` at `worktrees/yantra/YAN-11`. The setup command had copied `.env` into it. The task folder had `brief.md`, `issue.md`, `resources/`, `feedback/` and `log/setup.log`, and its own git history ("Task created"). Unit tests check the same, plus `base_sha` = `origin/main`. |
| Starting twice is a no-op, not a crash | ✅ In the app, `tasks:create` was called again for YAN-11 with a different template, and twice more in parallel. All three returned task 1 with the original template, and nothing was rerun. Unit tests also check that edits to `brief.md` survive and that only one task row exists. |
| Cancelling the drag dialog puts the card back | ✅ Dragged YAN-4 onto In Progress, the dialog opened, Cancel: YAN-4 is back at the top of Backlog. |
| Worktree trust decided and implemented | ✅ Option (a): pre-trust, details below. The app wrote `hasTrustDialogAccepted: true` for the worktree path into a scratch `.claude.json` (`YANTRA_CLAUDE_HOME`). Unit tests check that the rest of the file is untouched, and that nothing is written with the setting off. |
| Light and dark, empty states | ✅ The task workspace and Files (text, Markdown, an image, `brief.md`) in both themes. The dialog's choose, running and failed states, plus the Terminal, Diff and Metrics empty states, in dark only; they use the same tokens. Also covered: an empty `resources/` and `feedback/`, a missing file, an unreadable task, and unfinished setup. |

Typecheck clean, 81 tests pass (21 new), build succeeds.

## What's in place

- **Templates (`src/main/templates.ts`, `resources/templates/`):** `standard.yaml` and `quickfix.yaml` as in SPEC, parsed with `yaml` (pinned 2.9.1) and validated with zod.
  - `write` entries must be `worktree` or `task:<file>`, and stage keys must be unique.
  - A file in `<YANTRA_HOME>/templates` replaces a shipped template of the same name.
  - Templates are reloaded on every call, and a broken file is listed in the dialog rather than dropped silently.
  - The full YAML is snapshotted into `task.template_yaml`.
- **Creation (`src/main/tasks.ts`):** inserts the draft task and one `pending` stage row per template stage, then runs three steps. Each step reports progress (`task:progress`) and can safely run again.
  1. **Folder:** creates the folders, runs `git init`, writes `issue.md` and `brief.md` (Goal = issue body), copies attachments into `resources/`, then commits as "YANTRA" with signing off (local history only, never pushed). Existing files are never overwritten.
  2. **Worktree:** `git fetch <remote>` (a failure is noted, not fatal), then a worktree from `<remote>/<default>`, else the local default branch. Records `base_sha` and pre-trusts the path.
  3. **Setup:** runs each `worktreeSetup` command through the shell in the worktree. Output streams to the dialog (`task:log`) and to `log/setup.log`. It stops at the first non-zero exit.
- **Starting again:** concurrent starts for one issue share a single run. A second start on a finished task returns it unchanged, and one on a half-finished task finishes the remaining steps. `task.setup_done_at` (migration 2) records completion.
- **Names:** branch `yantra/<KEY>-<title-slug>`, cut at a word boundary at 40 characters. If an earlier (abandoned) task used the branch or folders, the new one gets `-2`, `-3` and so on.
- **Abandon draft:** removes the worktree (git refuses if it has changes; the toast offers "Remove anyway"). Keeps the branch and task folder, and puts the issue at the end of Todo. Checked in the app: the git-ignored `.env` copied by setup did not block removal.
- **Task-folder files (`src/main/taskfs.ts`):**
  - The tree lists known files in pipeline order and hides dot entries.
  - Reads refuse paths that escape the folder or reach into `.git`. They return text, images (as data URLs up to 8 MB), or "binary" / "too large".
  - Only `brief.md` can be written. Files can be added to or removed from `resources/`, and only there.
- **IPC:** `templates:list` and the `tasks:*` channels (`create`, `get`, `abandon`, `files`, `readFile`, `writeFile`, `addResources`, `removeResource`, `refreshIssue`, `reveal`). Events: `task:changed`, `task:progress`, `task:log`, `shortcut:closeTab`.
- **Start task dialog:**
  - Template cards showing their stage chain, with the default marked.
  - A preview of the branch, start point, folder and setup command count.
  - Then the checklist and setup log.
  - On failure: the error, a note that the task stays a draft, and Retry.
  - "Hide (keeps going)" lets creation finish in the background, and a toast offers Open task.
- **Task tabs:** after the pinned board tab, with key and title, ×, middle-click to close, and Ctrl+W. They're kept across restarts. Keys 1–4 switch sub-tabs.
- **Task workspace:**
  - Header: back, key, title, template, status tag, "N behind main" and a copyable branch chip.
  - A Start button, disabled until Phase 4.
  - An overflow menu: Copy branch name, Open task folder, Open worktree, Refresh `issue.md` from board, Abandon draft.
  - A "Setting up…" or "Setup didn't finish → Finish setup" banner.
  - The stage rail, and four sub-tabs.
- **Files sub-tab:**
  - Collapsible tree.
  - `brief.md` in Write/Preview with autosave.
  - Other Markdown rendered, `issue.md` with Refresh from board, plain text in mono, images previewed, other files with "Open with default app".
  - Show in folder, and remove for `resources/` files.
  - Drop files anywhere on the tab, or use +, to add them to `resources/`.
  - The tree refreshes on window focus and after the app's own changes.
- **Elsewhere:**
  - The drawer's Open task button now works.
  - The palette has an "Open task" group.
  - Cards show "Draft".

## Worktree trust decision

**Pre-trust (option a), behind "Trust new worktrees automatically" (Settings → General, on by default).**

When a worktree is created, `trust.ts` sets `projects["<path>"].hasTrustDialogAccepted = true` in `~/.claude.json`. The path uses forward slashes, the format Claude itself uses (checked against existing entries).

How the file is handled:
- Only that one flag is added. Every other key, and every other project, is left as it was.
- The new content goes to a temp file, which is then renamed over the original, so no reader ever sees half a file.
- A missing `~/.claude.json` means Claude was never set up. Pre-flight already reports that, so nothing is written.

With the setting off, the file isn't touched and the trust prompt appears in the stage terminal (Phase 4 adds the banner and the "exited at the trust prompt" handling for that case). The trade-off is that YANTRA writes Claude's own config file. It's limited to folders YANTRA itself created under `<dataRoot>/worktrees/`.

**Not yet proven end to end:** that a real `claude` launch in a pre-trusted worktree skips the prompt. Phase 4 starts sessions, and checking it now meant adding a test path to the real `~/.claude.json`, so it was left for then. If the prompt still shows, fall back to option (b).

## Deviations from SPEC.md

1. **Template loading came forward from Phase 5:** the loader and zod schema, plus `standard.yaml` and `quickfix.yaml`. The Start task dialog needs them. Prompt files and placeholder rendering stay in Phase 5.
2. **`quickfix` Review reads `brief.md`** instead of `plan.md`, since that template has no Plan stage.
3. **`task.setup_done_at` (migration 2)** wasn't in the schema. Without it, a draft whose setup failed can't be told apart from a ready one.
4. **Abandon came forward for drafts only,** so a task whose setup can't succeed (wrong repo, broken setup command) doesn't stay stuck in In Progress. Abandoning a task with running stages is still Phase 6.
5. **`issue.md` says it's a snapshot in a blockquote** under the title. The first version used an HTML comment, which the Markdown preview showed as text.
6. **Only `brief.md` is editable in the app.** Artifacts belong to their stages. Other files open in the default app.
7. **`YANTRA_CLAUDE_HOME`** points trust writes at another folder, for tests, like `YANTRA_HOME`.
8. **Dialogs now focus the element marked `data-autofocus`** (else the dialog itself). Radix focused the header's Close button, which also popped its tooltip on every dialog.

## Bugs found while verifying (fixed)

- **Every dialog opened with focus on Close** and its tooltip showing (also true in Phase 2).
- **The `brief.md` editor overflowed** the pane, adding a horizontal scrollbar to the whole window.
- **The "Setting up…" banner stayed** after setup finished: the last change event went out while the task was still counted as in progress.
- **The `issue.md` view didn't reload** after Refresh from board, because folder changes weren't announced.
- **The tree's drop hint wrapped** mid-sentence.

## Skipped / not done

- **Dropping files from Explorer onto Files** and the native file picker weren't automated (the same DevTools limit as Phase 2). Files were added through `tasks:addResources`, the call both paths use. Try both once by hand.
- **"Open with default app", "Show in folder", "Open task folder" and "Open worktree"** call the shell and weren't clicked.
- **A real `claude` launch in a pre-trusted worktree:** see above.
- **Ctrl+W** was tested with injected key events, which reach the page. A real key press is caught in main (so the default menu doesn't close the window); press it once by hand.
- **Only Windows 11 was tested.** The setup commands run through `cmd.exe` there.

## How to try it

```text
npm run dev
Drag a card to In Progress     Start task dialog → Create task
Drawer → Start task / Open task
1–4                            Terminal / Files / Diff / Metrics
Ctrl W                         close the task tab
Ctrl K, "task"                 open a task
```
