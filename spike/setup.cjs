// Spike setup: writes the hook wrapper, a toy repo with a bare origin, a task dir,
// and a generated Claude settings file. Run with plain node: `node setup.cjs`.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const out = path.join(__dirname, 'out');
const binDir = path.join(out, 'bin');
const taskDir = path.join(out, 'task');
const repo = path.join(out, 'toyrepo');
const origin = path.join(out, 'origin.git');
const electronExe = require('electron'); // path to electron.exe
const hookScript = path.join(__dirname, 'hook-capture.cjs');

fs.mkdirSync(binDir, { recursive: true });
fs.mkdirSync(path.join(taskDir, 'log'), { recursive: true });
fs.mkdirSync(path.join(taskDir, '.stage'), { recursive: true });

// hook.cmd: run hook-capture.cjs with Electron's bundled Node, no separate Node install needed.
const hookCmd = path.join(binDir, 'hook.cmd');
fs.writeFileSync(
  hookCmd,
  ['@echo off', 'set ELECTRON_RUN_AS_NODE=1', `"${electronExe}" "${hookScript}"`, 'exit /b %ERRORLEVEL%', ''].join('\r\n'),
);

if (!fs.existsSync(repo)) {
  const git = (args, cwd) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  git(['init', '--bare', '-b', 'main', origin], out);
  fs.mkdirSync(repo);
  git(['init', '-b', 'main'], repo);
  fs.writeFileSync(path.join(repo, 'README.md'), '# toy repo\n\nThrowaway repo for the YANTRA spike.\n');
  fs.writeFileSync(path.join(repo, 'add.js'), 'exports.add = (a, b) => a + b;\n');
  git(['add', '.'], repo);
  git(['-c', 'user.name=spike', '-c', 'user.email=spike@example.invalid', 'commit', '-m', 'init'], repo);
  git(['remote', 'add', 'origin', origin], repo);
  git(['push', '-u', 'origin', 'main'], repo);
}

// Forward slashes: the hook command string is run by Git Bash on Windows.
const hookCommand = hookCmd.replace(/\\/g, '/');
const h = () => [{ hooks: [{ type: 'command', command: hookCommand }] }];
const m = () => [{ matcher: '*', hooks: [{ type: 'command', command: hookCommand }] }];
const settings = {
  hooks: {
    SessionStart: h(),
    UserPromptSubmit: h(),
    PreToolUse: m(),
    PostToolUse: m(),
    Stop: h(),
    SessionEnd: h(),
  },
};
const settingsPath = path.join(taskDir, '.stage', 'settings-spike.json');
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

console.log(JSON.stringify({ electronExe, hookCmd, hookCommand, settingsPath, repo, taskDir }, null, 2));
