# Claude Code CLI notes (Phase 0)

Machine: Windows 11 Home 10.0.26200, Node 24.19.0 (system), npm 11.17.0, Git 2.47.1 (MinGit, no bash).
Verified against **claude 2.1.312** (native install at `%USERPROFILE%\.local\bin\claude.exe`), logged in with claude.ai (Pro). `--help` was also read on the desktop-bundled 2.1.304; the flags are the same.

Re-run the checks after a CLI upgrade: `spike/drive-claude.cjs start`, then `resume <id>`, then `spike/inspect-transcript.cjs` on the new transcript.

## Installing and first run

- The desktop app bundles a `claude.exe` under `%LOCALAPPDATA%\Claude-Data\...\claude-code\<version>\`. That path is versioned, so never depend on it. `claude install` (run from that copy) installs the native build to `%USERPROFILE%\.local\bin\claude.exe` but does **not** add it to PATH. YANTRA config's `claudeBinary` must accept a full path, and Settings should offer `%USERPROFILE%\.local\bin\claude.exe` as a default when `claude` isn't on PATH.
- `claude auth status` prints JSON (`loggedIn`, `authMethod`, `email`, `subscriptionType`), with exit code 1 when logged out. YANTRA's Settings "Test" button should use it.
- **First-run and per-folder screens block a stage before the prompt is sent.** In order, as seen in a PTY:
  1. Theme picker (onboarding). Enter accepts the default.
  2. Login, then "Login successful. Press Enter to continue".
  3. "Security notes … Press Enter to continue".
  4. **Workspace trust ("Accessing workspace: <cwd> … Is this a project you created or one you trust?").** The default is **"No, exit"**: Enter quits claude with exit code 1. Shown once per new cwd, so for **every new worktree**.
  5. "Claude in Chrome extension detected" offer. The default is No. Suppressed by `--no-chrome`.
- Onboarding is recorded as `hasCompletedOnboarding` in `~/.claude.json`, and per-folder trust in the same file under `projects["<path>"].hasTrustDialogAccepted` (not yet tested as a pre-seed).
- **For YANTRA:** check `claude auth status` and `hasCompletedOnboarding` before the first launch, and if either fails send the user to a terminal to run `claude` once. For trust, either show the dialog in the stage terminal with a clear banner ("Choose 'Yes, I trust this folder'"), or pre-trust the worktree path in `~/.claude.json` at worktree creation. Pre-trusting writes Claude's own config file, so decide in Phase 3 and keep it behind a setting.

## Flags verified (`claude --help`, 2.1.312)

| Flag | Present | Verified live | Notes |
| --- | --- | --- | --- |
| positional `prompt` | yes | yes | sent as the first user message of an interactive session |
| `--session-id <uuid>` | yes | yes | the transcript file is `<uuid>.jsonl` |
| `--append-system-prompt` | yes | yes | **`--system-prompt-snapshot` defaults to `on`**: the system prompt (including appended text) is recorded on the first request and reused verbatim on resume. Round-specific instructions go in the message, never the system prompt. |
| `--add-dir <dirs...>` | yes | yes | variadic; put it after the positional prompt. Writing into the add-dir with `acceptEdits` needed no prompt. |
| `--settings <file>` | yes | yes | hooks from it fire alongside user settings |
| `--resume <id> "<prompt>"` | yes | yes | **works interactively with a positional prompt**: same session ID, `SessionStart.source = "resume"`, full memory of the earlier turns. No fallback needed. |
| `--permission-mode` | yes | `acceptEdits` | choices: acceptEdits, auto, bypassPermissions, manual, dontAsk, plan |
| `--no-chrome` | yes | yes | **add to every stage launch**: stops the Chrome offer and stops agents driving the user's browser |
| `--model` | yes | — | aliases `fable`, `opus`, `sonnet`; the default on this account was `claude-opus-5-5` |

Never pass `--bare` or `--safe-mode`: both disable hooks. Possibly useful later: `-n/--name` (display name, could be the issue key) and `--effort`.

## Environment for stage PTYs

Processes launched from inside a Claude Code session (the desktop app, its terminal panel, or YANTRA started from one) inherit `CLAUDECODE=1`, `CLAUDE_CODE_*`, host-auth and messaging variables. A stage PTY must **drop every `CLAUDE*` variable** and `ELECTRON_RUN_AS_NODE`, then add the `YANTRA_*` contract. With that, the CLI uses its own login. See `spike/launch.cjs` → `stageEnv`.

## Native modules (Electron 45.1.0, Node 24.22.1, ABI 150)

- **No `@electron/rebuild` and no Visual Studio needed.** `node-pty@1.1.0` and `better-sqlite3@13.0.3` ship N-API prebuilds inside the npm package, and both load in Electron 45 (`spike/check-native.cjs`).
- npm 11.17 gates install scripts behind `allowScripts`. Allow `node-pty` (its install script just checks the prebuild). Set **`better-sqlite3: false`**: it has no install script, but npm adds an implicit `node-gyp rebuild` for `binding.gyp`, which fails without Visual Studio.
- Electron 45's package has no postinstall; it downloads the binary lazily on first `require('electron')`.
- The built-in `node:sqlite` (SQLite 3.53.4) also works in Electron 45, as a zero-native fallback.
- `electron.exe` is a GUI-subsystem binary, so its stdout doesn't reach a Windows console. Scripts run with `ELECTRON_RUN_AS_NODE` should log to files.
- node-pty/ConPTY: after the child exits, the host process stays alive (an open ConPTY handle). Call `pty.kill()` and exit explicitly. `kill()` after exit prints a harmless `AttachConsole failed` trace from `conpty_console_list_agent.js`.

## Hooks

- Wrapper `hook.cmd`: `set ELECTRON_RUN_AS_NODE=1`, then `"<electron.exe>" "<hook.cjs>"`, then `exit /b %ERRORLEVEL%`, referenced in settings with forward slashes. **Works on this machine with no bash** (MinGit only): all six events fire, about 3 ms per hook in-process.
- Payloads can start with a UTF-8 BOM when piped by Windows shells. Strip it before `JSON.parse`.
- **On Windows the shell tool is `PowerShell`, not `Bash`.** `tool_input.command` holds the command. The deny policy must check both tool names (and later any other shell tool). `PreToolUse` exit 2 blocked `git push origin main`; Claude reported the block and didn't retry.
- Payload fields seen (beyond the spec): every event has `session_id`, `transcript_path`, `cwd`, `scratchpad_dir`, `prompt_id`; tool and Stop events add `permission_mode` and `effort.level`; tool events add `tool_use_id`.
  - `SessionStart.source`: `startup` or `resume`.
  - `SessionEnd.reason`: `prompt_input_exit` after `/exit`.
  - **`Stop` has `last_assistant_message` and `background_tasks: [{id, type: "subagent", status: "running", description, agent_type}]`.**
- **`Stop` is not "stage finished".** Subagents launched with the Agent tool ran **in the background** by default. `Stop` fired while the subagent was still running; when it finished, a **`UserPromptSubmit` with a `<task-notification>` prompt** started a new turn that wrote the artifact. Consequences for `hooks.ts` and `machine.ts`:
  - On `Stop`, if any `background_tasks[].status === "running"`, keep the stage `running` (don't go `idle`/`awaiting_approval`).
  - Not every `UserPromptSubmit` is the human. A prompt starting with `<task-notification>` is the agent's own continuation. It still counts as agent-active time.
  - `/exit` while background work runs opens a "Background work is running" dialog (1. Exit and stop tasks [default], 2. Move to background and exit, 3. Stay). **Stop session** must handle it: send Enter for option 1, then kill after the timeout.
- Ready markers ("RESEARCH READY") are unreliable: the model skipped it on the notification turn ("No response requested"). Readiness = `produces` file exists and is non-empty, as the spec says. `last_assistant_message` is still nice to show on the card.

## Transcripts

- Location: `~/.claude/projects/<cwd with every non-alphanumeric char replaced by "-">/<session-id>.jsonl`, e.g. `D--projects-yantra-spike-out-toyrepo`. Use `transcript_path` from hooks, never derive it.
- Many line types besides `user`/`assistant`: `attachment`, `system`, `mode`, `permission-mode`, `file-history-snapshot`, `file-history-delta`, `api-request`, `api-request-shape`, `api-request-blob` (~90 KB, full system prompt), `cost-state`, `ai-title`, `last-prompt`, `tools-used`, `queue-operation`, `atis-latch`. The parser must ignore unknown types.
- **Duplicate `message.id` lines confirmed**: main transcript has 8 assistant lines for 6 messages; naive line sum = 1242 output tokens vs **736 deduped**.
- Some assistant messages have `model: "<synthetic>"` (CLI-generated). Exclude them from usage.
- `message.usage` keys: `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, plus `cache_creation` (breakdown), `output_tokens_details`, `server_tool_use`, `service_tier`, `inference_geo`, `iterations`, `speed`, `fallback_credit`.
- **Subagents are separate files**: `<session-id>/subagents/agent-<agentId>.jsonl` (all lines `isSidechain: true`, with `agentId`) plus `agent-<agentId>.meta.json` (`agentType`, `description`, `toolUseId`, `requestShape: "background"`, `finished`). The main transcript has no sidechain lines. Usage for a stage = main + every subagent file, each deduped by `message.id`.
- Fixtures (redacted: request blobs stubbed, username/email/org ids replaced): `fixtures/transcripts/main.jsonl` and `fixtures/transcripts/main/subagents/`. Hook payloads: `fixtures/hooks/<Event>-<n>.json`.
