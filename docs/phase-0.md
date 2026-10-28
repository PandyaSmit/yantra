# Phase 0: Spike

Throwaway code in `spike/`. Findings and every deviation from SPEC.md are in [cli-notes.md](cli-notes.md).

## Acceptance checks

| Check | Result |
| --- | --- |
| node-pty and better-sqlite3 load in Electron | ✅ Electron 45.1.0 (ABI 150). Both ship N-API prebuilds, so **no `@electron/rebuild` and no Visual Studio needed**. `node:sqlite` works too. (`spike/check-native.cjs`) |
| xterm.js window running interactive `claude` with initial prompt, `--session-id`, `--settings`, `--add-dir`, `--append-system-prompt` | ✅ `npm start` in `spike/`: the session starts, runs its prompt and hooks fire; typing and resize confirmed by hand. |
| `claude --resume <id> "<prompt>"` interactive | ✅ Same session ID, `source: resume`, remembers context. No fallback needed. |
| Hook wrapper via `ELECTRON_RUN_AS_NODE` fires for all six events | ✅ `hook.cmd` wrapper, no bash on the machine. Payloads in `fixtures/hooks/`. |
| `PreToolUse` exit 2 blocks `git push`, Claude sees the reason | ✅ Blocked on the `PowerShell` tool (Windows uses PowerShell, not Bash). Claude reported it and didn't retry. |
| Real transcript saved, duplicate `message.id` confirmed, subagent layout noted | ✅ `fixtures/transcripts/` (redacted). Duplicates confirmed (1242 naive vs 736 deduped output tokens). Subagents live in `<session>/subagents/agent-<id>.jsonl` + `.meta.json`. |
| `docs/cli-notes.md` | ✅ |

## Spec changes these findings called for (all folded into SPEC.md)

1. **Native modules:** remove `@electron/rebuild` and the electron-rebuild postinstall; pin exact versions; `allowScripts` with `better-sqlite3: false`.
2. **Launch args:** add `--no-chrome` to every stage launch. Stage env drops all `CLAUDE*` vars.
3. **Hook policy:** shell tool names are `Bash` **and** `PowerShell`; strip a BOM before parsing.
4. **Stop ≠ done:** on `Stop`, stay `running` while `background_tasks` has a running entry. `UserPromptSubmit` with a `<task-notification>` prompt is an agent turn, not the human's.
5. **Stop session:** handle the "Background work is running" exit dialog.
6. **Pre-flight before the first launch:** `claude auth status` + onboarding check. Folder-trust handling per worktree (trust dialog defaults to "No, exit").
7. **Metrics:** sum the main transcript plus `subagents/*.jsonl`, dedupe by `message.id`, skip `<synthetic>` models, ignore unknown line types.
8. **System prompt snapshot:** `--append-system-prompt` is frozen for the session's life; feedback rounds go in the message.
9. **claudeBinary default:** `%USERPROFILE%\.local\bin\claude.exe` when `claude` isn't on PATH.

## Skipped / not done

- No production code, tests or TypeScript: Phase 0 is throwaway by design.
- The spike drives first-run screens by pattern-matching the raw PTY stream, which is fragile (redraws drop letters). Phase 4 should read the screen via `@xterm/headless` if it ever needs to, or better, avoid needing it with the pre-flight checks.
- Pre-seeding folder trust in `~/.claude.json` wasn't tried (it writes Claude's own config). Decide in Phase 3.
- macOS/Linux `hook.sh` wrapper wasn't tested (Windows-only machine).

## How to re-run

```text
cd spike
npm install                     # no compiler needed
node setup.cjs                  # hook.cmd, toy repo + bare origin, settings file
set YANTRA_CLAUDE=%USERPROFILE%\.local\bin\claude.exe
set ELECTRON_RUN_AS_NODE=1
node_modules\electron\dist\electron.exe drive-claude.cjs start          # results in out\drive-start.json
node_modules\electron\dist\electron.exe drive-claude.cjs resume <id>    # results in out\drive-resume.json
set ELECTRON_RUN_AS_NODE=
npm start                       # the xterm window
node inspect-transcript.cjs <transcript.jsonl>
```
