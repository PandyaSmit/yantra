// Every ipcMain.handle registration lives here. Payloads are validated with zod before use.
import { existsSync } from 'node:fs';
import { app, dialog, ipcMain, nativeTheme, shell, type BrowserWindow } from 'electron';
import { z } from 'zod';
import { IPC_ERROR_PREFIX, type Channel, type Req, type Res } from '@shared/ipc';
import { AppConfigSchema, GeneralSettingsSchema, PriceTableSchema, ProjectSchema, type AppConfig } from '@shared/schemas';
import type { ConfigState } from '@shared/types';
import { saveConfig } from './config';
import type { Db } from './db/db';
import { inspectRepo } from './git';
import { configPath } from './paths';
import { runPreflight } from './preflight';

export interface IpcContext {
  config(): ConfigState;
  setConfig(config: AppConfig): void;
  db(): Db | null;
  window(): BrowserWindow | null;
  dbPath(): string | null;
}

function handle<C extends Channel>(channel: C, fn: (req: Req<C>) => Promise<Res<C>> | Res<C>): void {
  ipcMain.handle(channel, async (_e, req: Req<C>) => {
    try {
      return await fn(req);
    } catch (e) {
      const message = e instanceof z.ZodError ? e.issues.map((i) => i.message).join('; ') : (e as Error).message;
      // Electron wraps thrown errors; the prefix lets the renderer recover the clean message.
      throw new Error(IPC_ERROR_PREFIX + message);
    }
  });
}

export function registerIpc(ctx: IpcContext): void {
  const requireConfig = (): AppConfig => {
    const state = ctx.config();
    if (!state.ok) throw new Error('config.json is invalid; fix it and restart YANTRA');
    return state.config;
  };
  const save = (next: AppConfig): AppConfig => {
    const saved = saveConfig(configPath(), AppConfigSchema.parse(next));
    ctx.setConfig(saved);
    return saved;
  };

  handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    configPath: configPath(),
    dbPath: ctx.dbPath(),
    isDev: !app.isPackaged,
  }));

  handle('config:get', () => ctx.config());

  handle('config:setGeneral', (req) => {
    const general = GeneralSettingsSchema.parse(req);
    const saved = save({ ...requireConfig(), ...general });
    nativeTheme.themeSource = saved.theme;
    return saved;
  });

  handle('config:setPriceTable', (req) => save({ ...requireConfig(), priceTable: PriceTableSchema.parse(req) }));

  handle('projects:upsert', (req) => {
    const project = ProjectSchema.parse(req);
    if (!existsSync(project.repoPath)) throw new Error(`Repository folder not found: ${project.repoPath}`);
    const config = requireConfig();
    const existing = config.projects.find((p) => p.slug === project.slug);
    if (existing && existing.key !== project.key) {
      const row = ctx.db()?.prepare('SELECT COUNT(*) AS n FROM issue WHERE project_slug = ?').get(project.slug) as
        | { n: number }
        | undefined;
      if (row && row.n > 0) throw new Error(`The key can't change once ${existing.key} has issues`);
    }
    const others = config.projects.filter((p) => p.slug !== project.slug);
    if (others.some((p) => p.key === project.key)) throw new Error(`Key ${project.key} is already used by another project`);
    const projects = existing
      ? config.projects.map((p) => (p.slug === project.slug ? project : p))
      : [...config.projects, project];
    return save({ ...config, projects });
  });

  handle('projects:remove', ({ slug }) => {
    const config = requireConfig();
    return save({ ...config, projects: config.projects.filter((p) => p.slug !== slug) });
  });

  handle('preflight:run', (req) => runPreflight(req?.claudeBinary || requireConfig().claudeBinary));

  handle('repo:inspect', ({ path }) => {
    const state = ctx.config();
    const taken = state.ok ? state.config.projects.map((p) => p.key) : [];
    return inspectRepo(z.string().min(1).parse(path), taken);
  });

  handle('dialog:pickFolder', async (req) => {
    const win = ctx.window();
    const opts = { title: req?.title, defaultPath: req?.defaultPath, properties: ['openDirectory' as const] };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });

  handle('shell:openPath', async ({ path }) => {
    const err = await shell.openPath(path);
    if (err) throw new Error(err);
  });
}
