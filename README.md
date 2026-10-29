# YANTRA

A desktop app for issue-driven work with Claude Code. Each project gets a local kanban board;
starting a task on an issue gives it a git worktree and runs it through stages (research, plan,
code, review) as real interactive `claude` sessions. You approve or send back each stage, review
the diff, push the branch and open the PR yourself. YANTRA never merges.

Everything is also scriptable from a terminal with the `yantra` CLI. See [docs/cli.md](docs/cli.md).

## Requirements

- Node.js 24+ and npm 11+
- Git
- [Claude Code](https://claude.com/claude-code), signed in (`claude` on PATH, or its path set in Settings)

No Visual Studio is needed: `node-pty` and `better-sqlite3` ship N-API prebuilds.

## Development

```bash
npm install
npm run dev        # app with hot reload
npm run typecheck
npm test
npm run build      # production build into out/
npm start          # run the production build
```

## Windows release

```bash
npm run dist:win
```

This writes `dist/YANTRA-Setup-<version>.exe`, an NSIS installer for the current user.
The installer is not code-signed, so SmartScreen warns on first run.

## Layout

- `src/main`: the backend (config, SQLite, PTYs, git, pipeline, CLI server)
- `src/preload`, `src/shared`: the typed IPC contract
- `src/renderer`: the React UI
- `src/cli`: the `yantra` thin client
- `resources`: stage templates, prompts and the hook script shipped with the app
- `docs`: per-phase notes; `SPEC.md` is the full design
- `spike`, `fixtures`: the Phase 0 spike and the recorded Claude hook/transcript fixtures the tests use
