// Automated Phase 0 checks: drives a real interactive claude inside node-pty.
// Run under Electron's Node so node-pty is proven against Electron's ABI:
//   set ELECTRON_RUN_AS_NODE=1 && electron.exe drive-claude.cjs start
//   ... drive-claude.cjs resume <sessionId>
// Writes the raw PTY output to out/pty-<mode>.log and a result to out/drive-<mode>.json.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const pty = require('node-pty');
const { out, taskDir, repo, claudeBinary, stageEnv, startArgs, resumeArgs } = require('./launch.cjs');

const mode = process.argv[2] || 'start';
const sessionId = process.argv[3] || crypto.randomUUID();
const runId = Date.now();
const hooksLog = path.join(taskDir, 'log', 'hooks.jsonl');
const TIMEOUT_MS = 5 * 60 * 1000;

const START_PROMPT = [
  'This is a YANTRA spike test in a throwaway repo. Do these steps in order:',
  '1) Run the shell command `git push origin main` exactly once. It is expected to be blocked by a hook; do not retry or work around it.',
  '2) Use the Agent/Task tool to launch one subagent that counts the .js files in this repo and reports the number.',
  `3) Write the file ${taskDir.replace(/\\/g, '/')}/research.md containing the line "spike ok" and the subagent's count.`,
  '4) Reply with exactly: RESEARCH READY. The codeword is BANYAN.',
].join(' ');
const RESUME_PROMPT = 'What codeword did you give at the end of your last reply? Answer with: RESUMED <codeword>.';

const args =
  mode === 'start'
    ? startArgs({ sessionId, prompt: START_PROMPT, stage: 'research' })
    : resumeArgs({ sessionId, prompt: RESUME_PROMPT });

const strip = (s) => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
const logFile = path.join(out, `pty-${mode}.log`);
fs.writeFileSync(logFile, '');
const result = { mode, sessionId, runId, claude: claudeBinary(), args, events: [], notes: [] };

const p = pty.spawn(result.claude, args, {
  name: 'xterm-256color',
  cols: 120,
  rows: 40,
  cwd: repo,
  env: stageEnv({ runId, stage: 'research' }),
});

// First-run and per-folder screens that block a stage before the prompt is sent.
// Matched on whitespace-free text because the TUI positions words with cursor moves.
const GATES = [
// Loose on purpose: redraws drop letters from the raw stream ("PressEnertocontinue").
  { name: 'theme picker (onboarding)', re: /textstyle/i },
  { name: 'press enter to continue', re: /Press.{0,10}continue/i },
  // Default is "No, keep browser tools off"; --no-chrome should prevent it anyway.
  { name: 'chrome extension offer', re: /ChromeextensiondetectedClaude|keepbrowsertoolsoff/i },
  // /exit while a background subagent runs asks what to do; option 1 "Exit and stop tasks" is the default.
  { name: 'exit with background work', re: /Exitandstoptasks/i },
  // The trust dialog defaults to "No, exit": move down to "Yes, I trust this folder" first.
  { name: 'workspace trust', re: /Yes,?Itrust|trustthisfolder/i, keys: '\x1b[B\r' },
];
let screen = '';
let exitSent = false;
let gateTimer = null;
p.onData((d) => {
  fs.appendFileSync(logFile, d);
  screen = (screen + strip(d).replace(/\s+/g, '')).slice(-8000);
  const gate = GATES.find((g) => g.re.test(screen));
  if (gate && !gateTimer) {
    gateTimer = setTimeout(() => {
      result.notes.push(`gate: ${gate.name}; answered with ${JSON.stringify(gate.keys || '\r')}`);
      screen = '';
      gateTimer = null;
      p.write(gate.keys || '\r');
    }, 800);
  }
});

// Poll our own hooks.jsonl (the app will tail it with chokidar) for this run's Stop event.
const readEvents = () => {
  const lines = fs.existsSync(hooksLog) ? fs.readFileSync(hooksLog, 'utf8').trim().split('\n') : [];
  const mine = lines.filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.runId === String(runId));
  result.events = mine.map((e) => `${e.event}${e.tool ? ':' + e.tool : ''}${e.blocked ? ' (BLOCKED)' : ''}`);
  return mine;
};
const timer = setInterval(() => {
  const mine = readEvents();
  // Stop can fire while a background subagent is still working, so "done" for the start run
  // is Stop + the artifact on disk (the same rule the state machine uses). Resume needs only Stop.
  const lastStop = mine.findLastIndex((e) => e.event === 'Stop');
  const artifactReady = mode !== 'start' || fs.existsSync(path.join(taskDir, 'research.md'));
  if (lastStop > -1 && !exitSent) {
    if (!result.firstStopAt) result.firstStopAt = mine[lastStop].ts;
  }
  if (!exitSent && lastStop > -1 && artifactReady) {
    exitSent = true;
    result.notes.push('Stop hook seen with artifact ready; sending /exit');
    setTimeout(() => p.write('/exit\r'), 1500);
  }
}, 500);

const finish = (why) => {
  clearInterval(timer);
  readEvents();
  result.finishedBecause = why;
  result.lastScreen = screen.slice(-3000);
  fs.writeFileSync(path.join(out, `drive-${mode}.json`), JSON.stringify(result, null, 2));
  try { p.kill(); } catch {}
  // node-pty keeps a ConPTY handle open on Windows; exit explicitly.
  setTimeout(() => process.exit(0), 200);
};

p.onExit(({ exitCode }) => {
  result.exitCode = exitCode;
  // give SessionEnd hook a moment to land in hooks.jsonl
  setTimeout(() => finish('claude exited'), 2000);
});
setTimeout(() => finish('timeout'), TIMEOUT_MS);
