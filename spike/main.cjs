// Spike window: xterm.js in the renderer, interactive claude in node-pty in main.
// `npm start` launches a fresh session; `npm start -- --resume <sessionId>` resumes one.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const crypto = require('node:crypto');
const pty = require('node-pty');
const { repo, claudeBinary, stageEnv, startArgs, resumeArgs } = require('./launch.cjs');

let win;
let proc;

function spawnClaude(cols, rows) {
  const resumeIdx = process.argv.indexOf('--resume');
  const sessionId = resumeIdx > -1 ? process.argv[resumeIdx + 1] : crypto.randomUUID();
  const args =
    resumeIdx > -1
      ? resumeArgs({ sessionId })
      : startArgs({ sessionId, stage: 'research', prompt: 'Say hello and tell me which directory you are in. Then stop.' });
  proc = pty.spawn(claudeBinary(), args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: repo,
    env: stageEnv({ runId: Date.now(), stage: 'research' }),
  });

  // Batch PTY output to the renderer every 16 ms, as SPEC.md describes.
  let pending = '';
  let flush = null;
  proc.onData((d) => {
    pending += d;
    if (!flush) {
      flush = setTimeout(() => {
        win?.webContents.send('pty:data', pending);
        pending = '';
        flush = null;
      }, 16);
    }
  });
  proc.onExit(({ exitCode }) => win?.webContents.send('pty:data', `\r\n[claude exited with ${exitCode}]\r\n`));
  win.setTitle(`YANTRA spike · session ${sessionId}`);
}

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 1100,
    height: 720,
    backgroundColor: '#0E0F11',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  ipcMain.handle('pty:start', (_e, { cols, rows }) => {
    if (!proc) spawnClaude(cols, rows);
  });
  ipcMain.on('pty:input', (_e, data) => proc?.write(data));
  ipcMain.on('pty:resize', (_e, { cols, rows }) => proc?.resize(cols, rows));
});

app.on('window-all-closed', () => {
  try { proc?.kill(); } catch {}
  app.quit();
});
