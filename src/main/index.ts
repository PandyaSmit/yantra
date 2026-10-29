// App lifecycle and the main window. Main is the whole backend: config, SQLite, (later) PTYs and git.
import { join } from 'node:path';
import { app, BrowserWindow, nativeTheme, shell } from 'electron';
import type { AppConfig } from '@shared/schemas';
import type { ConfigState } from '@shared/types';
import { loadConfig } from './config';
import { openDb, type Db } from './db/db';
import { registerIpc } from './ipc';
import { configPath, dbPath } from './paths';
import { markInterrupted } from './sessions';

let configState: ConfigState;
let db: Db | null = null;
let openedDbPath: string | null = null;
let win: BrowserWindow | null = null;

// Window chrome colours, matching --surface / --text in tokens.css.
const CHROME = {
  light: { color: '#F4F4F2', symbolColor: '#1C1917', background: '#FAFAF9' },
  dark: { color: '#131518', symbolColor: '#E7E9EC', background: '#0E0F11' },
};
const TOPBAR_HEIGHT = 44;

const chrome = () => (nativeTheme.shouldUseDarkColors ? CHROME.dark : CHROME.light);

function openDatabase(config: AppConfig): void {
  const path = dbPath(config.dataRoot);
  try {
    db = openDb(path);
    openedDbPath = path;
    // No session survives a restart; stages that were live wait for Resume. Nothing auto-restarts.
    markInterrupted(db);
  } catch (e) {
    configState = { ok: false, path, error: 'Could not open the YANTRA database', issues: [(e as Error).message] };
  }
}

function createWindow(): void {
  const isMac = process.platform === 'darwin';
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'YANTRA',
    backgroundColor: chrome().background,
    titleBarStyle: 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 14, y: 14 } }
      : { titleBarOverlay: { color: chrome().color, symbolColor: chrome().symbolColor, height: TOPBAR_HEIGHT } }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => win?.show());
  win.on('closed', () => (win = null));

  // No in-app navigation away from the renderer; https links open in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  // Ctrl+W closes the current task tab, not the window (the default menu would close it).
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && (input.control || input.meta) && !input.alt && !input.shift && input.key.toLowerCase() === 'w') {
      e.preventDefault();
      win?.webContents.send('shortcut:closeTab', {});
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
}

nativeTheme.on('updated', () => {
  if (!win) return;
  if (process.platform !== 'darwin') win.setTitleBarOverlay({ color: chrome().color, symbolColor: chrome().symbolColor });
  win.setBackgroundColor(chrome().background);
  win.webContents.send('theme:changed', { resolved: nativeTheme.shouldUseDarkColors ? 'dark' : 'light' });
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win?.isMinimized()) win.restore();
    win?.focus();
  });

  void app.whenReady().then(() => {
    configState = loadConfig(configPath());
    if (configState.ok) {
      nativeTheme.themeSource = configState.config.theme;
      openDatabase(configState.config);
    }
    const ipc = registerIpc({
      config: () => configState,
      setConfig: (config) => (configState = { ok: true, config }),
      db: () => db,
      dbPath: () => openedDbPath,
      window: () => win,
      resourcesDir: () => join(app.getAppPath(), 'resources'),
    });
    createWindow();
    // Quitting kills every stage PTY (claude would otherwise linger); they show as interrupted next time.
    app.on('before-quit', () => ipc.shutdown());
  });

  app.on('window-all-closed', () => {
    db?.close();
    app.quit();
  });
}
