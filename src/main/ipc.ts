// Every ipcMain.handle registration lives here. Payloads are validated with zod before use.
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { app, dialog, ipcMain, nativeTheme, Notification, shell, type BrowserWindow } from 'electron';
import { spawn as ptySpawn } from 'node-pty';
import { z } from 'zod';
import type { Notice } from '@shared/sessions';
import type { PreflightResult } from '@shared/types';
import { IPC_ERROR_PREFIX, type Channel, type IpcEvents, type Req, type Res } from '@shared/ipc';
import { AppConfigSchema, GeneralSettingsSchema, PriceTableSchema, ProjectSchema, type AppConfig, type Project } from '@shared/schemas';
import type { ConfigState } from '@shared/types';
import * as board from './board';
import { saveConfig } from './config';
import type { Db } from './db/db';
import { inspectRepo } from './git';
import { configPath, yantraHome } from './paths';
import { applyHookLine, HookTailer } from './hooks';
import { writeHookWrapper } from './launch';
import * as metrics from './metrics';
import * as pipeline from './pipeline';
import * as review from './review';
import { findOnPath, runPreflight } from './preflight';
import { artifactReady, copyTranscript, Sessions } from './sessions';
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

// The same handlers, callable from main itself: the CLI server runs every command through them.
const handlers = new Map<Channel, (req: never) => unknown>();

/** Calls a channel's handler in-process; errors come back as plain messages (zod issues joined). */
export async function invokeLocal<C extends Channel>(channel: C, req: Req<C>): Promise<Res<C>> {
  const fn = handlers.get(channel) as ((req: Req<C>) => Promise<Res<C>> | Res<C>) | undefined;
  if (!fn) throw new Error(`Unknown channel ${channel}`);
  try {
    return await fn(req);
  } catch (e) {
    throw new Error(e instanceof z.ZodError ? e.issues.map((i) => i.message).join('; ') : (e as Error).message);
  }
}

function handle<C extends Channel>(channel: C, fn: (req: Req<C>) => Promise<Res<C>> | Res<C>): void {
  handlers.set(channel, fn as (req: never) => unknown);
  ipcMain.handle(channel, async (_e, req: Req<C>) => {
    try {
      return await invokeLocal(channel, req);
    } catch (e) {
      // Electron wraps thrown errors; the prefix lets the renderer recover the clean message.
      throw new Error(IPC_ERROR_PREFIX + (e as Error).message);
    }
  });
}

export function registerIpc(ctx: IpcContext): { shutdown(): void } {
  const requireConfig = (): AppConfig => {
    const state = ctx.config();
    if (!state.ok) throw new Error('config.json is invalid; fix it and restart YANTRA');
    return state.config;
  };
  const save = (next: AppConfig): AppConfig => {
    const saved = saveConfig(configPath(), AppConfigSchema.parse(next));
    ctx.setConfig(saved);
    ctx.window()?.webContents.send('config:changed', saved);
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
  const sessions = sessionContext(ctx, board, requireConfig);
  registerBoardIpc(board, requireConfig);
  registerTaskIpc(ctx, board, requireConfig, sessions);
  registerSessionIpc(sessions, board, requireConfig);
  return { shutdown: () => sessions.shutdown() };
}

type SessionContext = ReturnType<typeof sessionContext>;

/** The one Sessions manager and hook tailer, created on first use (the database may open later). */
function sessionContext(ctx: IpcContext, { db, lookup }: BoardContext, requireConfig: () => AppConfig) {
  const send = <E extends keyof IpcEvents>(event: E, payload: IpcEvents[E]) => ctx.window()?.webContents.send(event, payload);
  let mgr: Sessions | null = null;
  let tailer: HookTailer | null = null;
  // Pre-flight runs before the first launch and is cached once it passes; a failure is re-checked every time.
  let preflightOk: PreflightResult | null = null;
  const changed = (taskId: number) => {
    const ref = tasks.taskRef(db(), taskId);
    ctx.window()?.webContents.send('board:changed', { projectSlug: ref.projectSlug, issueId: ref.issueId });
    send('task:changed', ref);
  };
  const get = (): Sessions => {
    if (mgr) return mgr;
    const notify = (n: Notice) => {
      send('notice', n);
      // The toast is enough while I'm looking; otherwise the OS tells me, and a click brings the task up.
      const win = ctx.window();
      if (!n.os || !win || win.isFocused() || !Notification.isSupported()) return;
      const note = new Notification({ title: n.title, body: n.description ?? '' });
      note.on('click', () => {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
        if (n.taskId !== undefined) send('notice:open', { taskId: n.taskId });
      });
      note.show();
    };
    tailer = new HookTailer(
      async (_file, line) => {
        await applyHookLine(
          {
            db: db(),
            artifactReady: (stageId) => artifactReady(db(), stageId),
            notify,
            changed: (taskId) => {
              changed(taskId);
              send('sessions:changed', get().summary());
            },
            sessionEnded: (runId, path) => {
              try {
                copyTranscript(db(), runId, path);
              } catch (e) {
                console.error('Could not copy the transcript', e);
              }
            },
          },
          line,
        );
        // Live token numbers after every turn.
        if (line.runId !== null && (line.event === 'Stop' || line.event === 'SessionEnd')) {
          try {
            metrics.ingestRun(db(), line.runId);
          } catch (e) {
            console.error('Could not read the transcript usage', e);
          }
        }
      },
      (e) => console.error('[hooks]', e),
    );
    const resources = ctx.resourcesDir();
    mgr = new Sessions({
      db: db(),
      lookup,
      claudeBinary: () => {
        const bin = requireConfig().claudeBinary;
        return isAbsolute(bin) || /[\\/]/.test(bin) ? bin : (findOnPath(bin) ?? bin);
      },
      maxSessions: () => requireConfig().maxConcurrentSessions,
      preflight: async () => {
        if (preflightOk) return preflightOk;
        const r = await runPreflight(requireConfig().claudeBinary);
        if (r.ok) preflightOk = r;
        return r;
      },
      hookWrapper: writeHookWrapper(join(yantraHome(), 'bin'), process.execPath, join(resources, 'hook.cjs')),
      promptDirs: [yantraHome(), resources],
      tailer,
      spawn: (file, args, o) => ptySpawn(file, args, { name: 'xterm-256color', cwd: o.cwd, env: o.env, cols: o.cols, rows: o.rows }),
      data: (runId, data) => send('pty:data', { runId, data }),
      exited: (runId, exitCode) => send('pty:exit', { runId, exitCode }),
      changed,
      sessionsChanged: () => send('sessions:changed', get().summary()),
      notify,
    });
    return mgr;
  };
  return {
    get,
    changed: (taskId: number) => {
      changed(taskId);
      send('sessions:changed', get().summary());
    },
    liveRun: (stageId: number) => mgr?.liveRunOf(stageId) ?? null,
    checking: (stageId: number) => mgr?.isChecking(stageId) ?? false,
    shutdown: () => {
      mgr?.killAll();
      void tailer?.close();
    },
  };
}

const PipelineActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('approve'), stageKey: z.string().min(1) }),
  z.object({ type: z.literal('reject'), stageKey: z.string().min(1), feedback: z.string().trim().min(1, 'Write what should change first') }),
  z.object({ type: z.literal('sendBack'), toStageKey: z.string().min(1), feedback: z.string().trim().min(1, 'Write what should change first') }),
  z.object({ type: z.literal('skip'), stageKey: z.string().min(1) }),
]);

function registerSessionIpc(sessions: SessionContext, { db, lookup }: BoardContext, requireConfig: () => AppConfig): void {
  const ping = (taskId: number) => sessions.changed(taskId);
  handle('review:diff', ({ taskId, sha }) => review.taskDiff(db(), idOf(taskId), sha === undefined ? undefined : z.string().regex(/^[0-9a-f]{4,40}$/).parse(sha)));
  handle('ship:pr', ({ taskId }) => review.prDraft(db(), idOf(taskId)));
  handle('ship:savePr', ({ taskId, text }) => review.savePr(db(), idOf(taskId), z.string().parse(text)));
  handle('ship:push', async ({ taskId, force }) => {
    const r = await review.push(db(), lookup, idOf(taskId), force === true);
    ping(idOf(taskId));
    return r;
  });
  handle('tasks:finish', async ({ id, force }) => {
    await review.finish(db(), lookup, idOf(id), force === true);
    ping(idOf(id));
  });
  handle('metrics:task', ({ taskId }) => metrics.taskMetrics(db(), requireConfig().priceTable, idOf(taskId)));
  handle('metrics:overview', () => metrics.overview(db(), requireConfig().priceTable));
  handle('pipeline:act', ({ taskId, action }) =>
    pipeline.act({ db: db(), lookup, sessions: sessions.get(), changed: sessions.changed }, idOf(taskId), PipelineActionSchema.parse(action)),
  );
  handle('sessions:start', ({ taskId }) => sessions.get().startTask(idOf(taskId)));
  handle('sessions:launch', ({ stageId }) => sessions.get().launch(idOf(stageId)));
  handle('sessions:stop', ({ stageId }) => sessions.get().stop(idOf(stageId)));
  handle('sessions:attach', ({ runId }) => sessions.get().attach(idOf(runId)));
  handle('sessions:runs', ({ taskId }) => sessions.get().runs(idOf(taskId)));
  handle('sessions:summary', () => sessions.get().summary());
  handle('pty:input', ({ runId, data }) => sessions.get().input(idOf(runId), z.string().parse(data)));
  handle('pty:resize', ({ runId, cols, rows }) => sessions.get().resize(idOf(runId), z.number().parse(cols), z.number().parse(rows)));
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

function registerTaskIpc(ctx: IpcContext, { db, lookup, dataRoot, changed }: BoardContext, requireConfig: () => AppConfig, sessions: SessionContext): void {
  const send = <E extends keyof IpcEvents>(event: E, payload: IpcEvents[E]) => ctx.window()?.webContents.send(event, payload);
  const loadAll = () => loadTemplates([join(ctx.resourcesDir(), 'templates'), join(yantraHome(), 'templates')]);
  const env = (): TaskEnv => ({
    db: db(),
    lookup,
    dataRoot: dataRoot(),
    templates: () => loadAll().templates,
    trustWorktrees: () => requireConfig().trustWorktrees,
    liveRun: sessions.liveRun,
    checking: sessions.checking,
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
  handle('tasks:abandon', ({ id, force }) =>
    tasks.abandonDraft(env(), idOf(id), force === true, async () => {
      const stages = db().prepare('SELECT id FROM stage WHERE task_id = ?').all(idOf(id)) as { id: number }[];
      for (const s of stages) await sessions.get().stopAndWait(s.id);
    }),
  );
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
