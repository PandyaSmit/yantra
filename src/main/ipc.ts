// Every ipcMain.handle registration lives here. Payloads are validated with zod before use.
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app, dialog, ipcMain, nativeTheme, shell, type BrowserWindow } from 'electron';
import { z } from 'zod';
import { IPC_ERROR_PREFIX, type Channel, type IpcEvents, type Req, type Res } from '@shared/ipc';
import { AppConfigSchema, GeneralSettingsSchema, PriceTableSchema, ProjectSchema, type AppConfig, type Project } from '@shared/schemas';
import type { ConfigState } from '@shared/types';
import * as board from './board';
import { saveConfig } from './config';
import type { Db } from './db/db';
import { inspectRepo } from './git';
import { configPath, yantraHome } from './paths';
import { runPreflight } from './preflight';
import * as taskfs from './taskfs';
import * as tasks from './tasks';
import type { TaskEnv } from './tasks';
import { loadTemplates, templateInfo } from './templates';

export interface IpcContext {
  config(): ConfigState;
  setConfig(config: AppConfig): void;
  db(): Db | null;
  window(): BrowserWindow | null;
  dbPath(): string | null;
  /** The app's shipped resources/ folder (templates, later hook.cjs and prompts). */
  resourcesDir(): string;
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

  handle('dialog:pickFiles', async (req) => {
    const win = ctx.window();
    const opts = { title: req?.title, properties: ['openFile' as const, 'multiSelections' as const] };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return r.canceled ? [] : r.filePaths;
  });

  const board = boardContext(ctx, requireConfig);
  registerBoardIpc(board, requireConfig);
  registerTaskIpc(ctx, board, requireConfig);
}

type BoardContext = ReturnType<typeof boardContext>;

function boardContext(ctx: IpcContext, requireConfig: () => AppConfig) {
  const db = (): Db => {
    const d = ctx.db();
    if (!d) throw new Error('The YANTRA database is not open');
    return d;
  };
  const lookup = (slug: string): Project => {
    const p = requireConfig().projects.find((x) => x.slug === slug);
    if (!p) throw new Error(`Project "${slug}" is no longer in YANTRA`);
    return p;
  };
  // Attachments and task folders live next to the database that is actually open (a changed data root applies after restart).
  const dataRoot = () => dirname(ctx.dbPath() ?? join(requireConfig().dataRoot, 'yantra.db'));
  const changed = (projectSlug: string, issueId?: number) => ctx.window()?.webContents.send('board:changed', { projectSlug, issueId });
  return { db, lookup, dataRoot, changed };
}

const idOf = (v: unknown) => z.number().int().positive().parse(v);

function registerTaskIpc(ctx: IpcContext, { db, lookup, dataRoot, changed }: BoardContext, requireConfig: () => AppConfig): void {
  const send = <E extends keyof IpcEvents>(event: E, payload: IpcEvents[E]) => ctx.window()?.webContents.send(event, payload);
  const loadAll = () => loadTemplates([join(ctx.resourcesDir(), 'templates'), join(yantraHome(), 'templates')]);
  const env = (): TaskEnv => ({
    db: db(),
    lookup,
    dataRoot: dataRoot(),
    templates: () => loadAll().templates,
    trustWorktrees: () => requireConfig().trustWorktrees,
    progress: (p) => send('task:progress', p),
    log: (issueId, taskId, chunk) => send('task:log', { issueId, taskId, chunk }),
    changed: (projectSlug, issueId, taskId) => {
      changed(projectSlug, issueId);
      send('task:changed', { projectSlug, issueId, taskId });
    },
  });
  const dirOf = (id: unknown) => tasks.taskDir(db(), idOf(id));
  const path = z.string().min(1);

  handle('templates:list', () => {
    const { templates, errors } = loadAll();
    return { templates: templates.map(templateInfo), errors };
  });
  handle('tasks:create', ({ issueId, template }) => tasks.createTask(env(), { issueId: idOf(issueId), template: z.string().min(1).parse(template) }));
  handle('tasks:get', ({ id }) => tasks.getTask(env(), idOf(id)));
  handle('tasks:abandon', ({ id, force }) => tasks.abandonDraft(env(), idOf(id), force === true));
  handle('tasks:files', ({ id }) => taskfs.listTree(dirOf(id)));
  handle('tasks:readFile', ({ id, path: p }) => taskfs.readTaskFile(dirOf(id), path.parse(p)));
  handle('tasks:writeFile', ({ id, path: p, text }) => ({ mtime: taskfs.writeTaskFile(dirOf(id), path.parse(p), z.string().parse(text)) }));
  // Folder changes made here are announced, so an open Files tab reloads the tree and the file.
  const folderChanged = (id: unknown) => send('task:changed', tasks.taskRef(db(), idOf(id)));
  handle('tasks:addResources', ({ id, paths }) => {
    const names = taskfs.addResources(dirOf(id), z.array(path).min(1).parse(paths));
    folderChanged(id);
    return names;
  });
  handle('tasks:removeResource', ({ id, path: p }) => {
    taskfs.removeResource(dirOf(id), path.parse(p));
    folderChanged(id);
  });
  handle('tasks:refreshIssue', ({ id }) => {
    tasks.refreshIssueSnapshot(env(), idOf(id));
    folderChanged(id);
  });
  handle('tasks:reveal', async ({ id, what, path: p }) => {
    const t = await tasks.getTask(env(), idOf(id));
    const target = what === 'worktree' ? t.worktreePath : what === 'file' ? taskfs.safePath(t.taskDir, path.parse(p)) : t.taskDir;
    if (what === 'file') return shell.showItemInFolder(target);
    const err = await shell.openPath(target);
    if (err) throw new Error(err);
  });
}

function registerBoardIpc({ db, lookup, dataRoot, changed }: BoardContext, requireConfig: () => AppConfig): void {
  handle('board:list', ({ projectSlug }) => board.listBoard(db(), lookup(projectSlug)));
  handle('issues:get', ({ id }) => board.getIssue(db(), lookup, dataRoot(), idOf(id)));
  handle('issues:index', () => board.issueIndex(db(), requireConfig().projects));

  handle('issues:create', (req) => {
    const project = lookup(z.string().parse(req.projectSlug));
    const id = board.createIssue(db(), project, req);
    changed(project.slug, id);
    return board.getCard(db(), lookup, id);
  });
  handle('issues:update', (req) => {
    board.updateIssue(db(), req);
    const card = board.getCard(db(), lookup, req.id);
    changed(card.projectSlug, card.id);
    return card;
  });
  handle('issues:move', (req) => {
    board.moveIssue(db(), req);
    changed(board.projectOf(db(), req.issueId), req.issueId);
  });
  handle('issues:archive', ({ id, archived }) => {
    board.setArchived(db(), idOf(id), z.boolean().parse(archived));
    changed(board.projectOf(db(), id), id);
  });
  handle('issues:attach', ({ issueId, paths }) => {
    board.attachFiles(db(), lookup, dataRoot(), idOf(issueId), z.array(z.string().min(1)).min(1).parse(paths));
    changed(board.projectOf(db(), issueId), issueId);
  });
  handle('issues:detach', ({ attachmentId }) => {
    const issueId = board.removeAttachment(db(), lookup, dataRoot(), idOf(attachmentId));
    changed(board.projectOf(db(), issueId), issueId);
  });
  handle('issues:revealAttachments', async ({ id }) => {
    const card = board.getCard(db(), lookup, idOf(id));
    const dir = board.attachmentsDir(dataRoot(), card.projectSlug, card.key);
    mkdirSync(dir, { recursive: true });
    const err = await shell.openPath(dir);
    if (err) throw new Error(err);
  });

  handle('labels:upsert', (req) => {
    lookup(req.projectSlug);
    const label = board.upsertLabel(db(), req);
    changed(req.projectSlug);
    return label;
  });
  handle('labels:delete', ({ id }) => changed(board.deleteLabel(db(), idOf(id))));

  handle('comments:add', (req) => {
    board.addComment(db(), req);
    changed(board.projectOf(db(), req.issueId), req.issueId);
  });
}
