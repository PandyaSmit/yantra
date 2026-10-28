// Shared by the spike window (main.cjs) and the automated driver (drive-claude.cjs):
// where claude lives, the env a stage PTY gets, and the argv for start/resume.
const fs = require('node:fs');
const path = require('node:path');

const out = path.join(__dirname, 'out');
const taskDir = path.join(out, 'task');
const repo = path.join(out, 'toyrepo');
const settingsPath = path.join(taskDir, '.stage', 'settings-spike.json');

// YANTRA_CLAUDE overrides; otherwise `claude` must be on PATH.
function claudeBinary() {
  if (process.env.YANTRA_CLAUDE) return process.env.YANTRA_CLAUDE;
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    for (const ext of exts) {
      const p = path.join(dir, 'claude' + ext);
      if (dir && fs.existsSync(p)) return p;
    }
  }
  throw new Error('claude not found on PATH; set YANTRA_CLAUDE');
}

// The user's env, minus anything that would make claude think it is nested inside another
// Claude Code session (or make it run as Node), plus the YANTRA_* contract from SPEC.md.
function stageEnv({ runId, stage }) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^CLAUDE/.test(k) || k === 'ELECTRON_RUN_AS_NODE') continue;
    env[k] = v;
  }
  return {
    ...env,
    YANTRA_TASK_DIR: taskDir,
    YANTRA_WORKTREE: repo,
    YANTRA_STAGE: stage,
    YANTRA_RUN_ID: String(runId),
    YANTRA_POLICY: path.join(taskDir, '.stage', 'policy-spike.json'),
    CLAUDE_CODE_ENABLE_TELEMETRY: '0',
    TERM: 'xterm-256color',
  };
}

function startArgs({ sessionId, prompt, stage }) {
  return [
    prompt,
    '--session-id', sessionId,
    '--append-system-prompt', `You are the ${stage.toUpperCase()} agent in YANTRA. Stay in your lane.`,
    '--add-dir', taskDir,
    '--settings', settingsPath,
    '--permission-mode', 'acceptEdits',
    '--no-chrome', // stage agents must not drive the user's browser
  ];
}

function resumeArgs({ sessionId, prompt }) {
  const args = ['--resume', sessionId];
  if (prompt) args.push(prompt);
  return [...args, '--add-dir', taskDir, '--settings', settingsPath, '--permission-mode', 'acceptEdits', '--no-chrome'];
}

module.exports = { out, taskDir, repo, settingsPath, claudeBinary, stageEnv, startArgs, resumeArgs };
