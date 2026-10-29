# The `yantra` CLI

Everything the app does can be done from a terminal, so an agent (for example Claude Code
opened in your repository) can manage issues and tasks without the window. Open the app
whenever you like to watch, or to take over a session that is stuck.

## Setup

```bash
npm run build
npm link
```

`npm link` puts `yantra` on your PATH (via `bin/yantra.js`). Rebuild after changing the code.

## How it works

- `yantra` is a thin client. It sends its arguments to the app's main process over a local
  pipe (`\\.\pipe\yantra-<hash>` on Windows, `~/Yantra/yantra.sock` elsewhere). The commands run in
  `src/main/cli.ts` through the same handlers the UI uses, so the rules, events and stored state
  are the same either way.
- If the app isn't running, the first command starts it in the background with no window
  (`--background`). In that mode, closing the window leaves the app and its sessions running.
  `yantra open [KEY]` shows the window, and `yantra quit` stops the app. The app keeps running
  only one instance: an app that is already open answers the CLI itself.
- Stage sessions are the same interactive Claude sessions as in the app, each in its own PTY.
  `task screen` and `task type` let a terminal read and answer one. `yantra open KEY` shows
  the live terminal.
- Issues and tasks are named by key (`PAY-12`). The project comes from `--project`, else the
  repository that contains the current folder, else the only project there is.
- `--json` prints the raw result. Exit codes:
  - `0` success
  - `1` error
  - `2` usage error
  - `3` `task wait` timed out with a stage still running

## Using it from Claude Code

Run `yantra guide` and paste its output into the repository's `CLAUDE.md`, or tell the agent to
run `yantra guide` first. `yantra help` lists every command.

A typical loop:

```bash
yantra issue create "Retry storm on webhook failures" --body-file notes.md --column todo
yantra task start PAY-12
yantra task wait PAY-12
yantra task cat PAY-12 plan.md
yantra task approve PAY-12
```

`task wait` returns within 100 s, which fits Claude Code's command timeout. Run it again while
it exits with 3.

## Not in the CLI

These stay UI-only:
- the folder and file pickers (pass paths instead)
- reveal-in-Explorer
- terminal resize
- settings and price-table editing

Edit `config.json` for settings, or use the app.
