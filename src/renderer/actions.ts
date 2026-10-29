// Everything that changes app state or talks to main goes through here.
import { IPC_ERROR_PREFIX } from '@shared/ipc';
import type { AppConfig, GeneralSettings, Price, Project } from '@shared/schemas';
import { store, type OpenTask, type Route, type TaskTab } from './store';

const api = () => window.api.invoke;

/** Electron wraps errors thrown in main ("Error invoking remote method …"); recover the clean message. */
export function errorMessage(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  const i = m.indexOf(IPC_ERROR_PREFIX);
  return i >= 0 ? m.slice(i + IPC_ERROR_PREFIX.length) : m;
}

const LAST_PROJECT = 'yantra.lastProject';
const SIDEBAR = 'yantra.sidebarCollapsed';
const safeGet = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const safeSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* per-viewer convenience only */
  }
};

function applyConfig(config: AppConfig) {
  const { route } = store.get();
  const known = config.projects.some((p) => p.slug === route.project);
  const project = known ? route.project : (config.projects.find((p) => p.slug === safeGet(LAST_PROJECT)) ?? config.projects[0])?.slug;
  store.set({ config, route: { ...route, project } });
}

export async function init() {
  store.set({ sidebarCollapsed: safeGet(SIDEBAR) === '1' });
  const [info, cfg] = await Promise.all([api()['app:info'](), api()['config:get']()]);
  if (!cfg.ok) {
    store.set({ info, status: 'config-error', configError: { path: cfg.path, error: cfg.error, issues: cfg.issues } });
    return;
  }
  applyConfig(cfg.config);
  loadOpenTasks(cfg.config);
  store.set({ info, status: 'ready' });
  void runPreflight();
}

// Back stack, so the mouse back button and Alt+Left work like a browser (e.g. reopening a closed drawer).
const history: Route[] = [];
const sameRoute = (a: Route, b: Route) => JSON.stringify(a) === JSON.stringify(b);

export function navigate(route: Partial<Route>) {
  const prev = store.get().route;
  const next: Route = { ...prev, ...route };
  // Leaving the board or switching project closes the drawer.
  if ((route.view && route.view !== 'board') || (route.project && route.project !== prev.project)) {
    if (!('issue' in route)) next.issue = undefined;
  }
  if (route.view && route.view !== 'task') {
    next.task = undefined;
    next.taskTab = undefined;
    next.file = undefined;
  }
  if (sameRoute(prev, next)) return;
  history.push(prev);
  if (history.length > 50) history.shift();
  if (next.project) safeSet(LAST_PROJECT, next.project);
  store.set({ route: next });
}

export function goBack() {
  const prev = history.pop();
  if (!prev) return;
  const known = store.get().config?.projects.some((p) => p.slug === prev.project);
  store.set({ route: known || !prev.project ? prev : { ...prev, project: store.get().route.project, issue: undefined } });
}

export const openIssue = (id: number, project?: string) => navigate({ view: 'board', issue: id, ...(project ? { project } : {}) });
export const closeIssue = () => navigate({ issue: undefined });

// Task tabs ------------------------------------------------------------------

const OPEN_TASKS = 'yantra.openTasks';

function saveOpenTasks(openTasks: OpenTask[]) {
  store.set({ openTasks });
  safeSet(OPEN_TASKS, JSON.stringify(openTasks));
}

/** Opens (or focuses) a task tab. The board behind it switches to the task's project. */
export function openTask(task: OpenTask, opts: { tab?: TaskTab; file?: string } = {}) {
  const tabs = store.get().openTasks;
  const known = tabs.some((t) => t.id === task.id);
  saveOpenTasks(known ? tabs.map((t) => (t.id === task.id ? task : t)) : [...tabs, task]);
  const sameTask = store.get().route.view === 'task' && store.get().route.task === task.id;
  navigate({
    view: 'task',
    task: task.id,
    project: task.projectSlug,
    issue: undefined,
    taskTab: opts.tab ?? (sameTask ? store.get().route.taskTab : undefined) ?? 'files',
    file: opts.file ?? (sameTask ? store.get().route.file : undefined),
  });
}

/** Closes a task tab (the session, once there is one, keeps running). Focus moves to a neighbour or the board. */
export function closeTask(id: number) {
  const tabs = store.get().openTasks;
  const i = tabs.findIndex((t) => t.id === id);
  if (i < 0) return;
  const rest = tabs.filter((t) => t.id !== id);
  saveOpenTasks(rest);
  const { route } = store.get();
  if (route.view !== 'task' || route.task !== id) return;
  const neighbour = rest[i] ?? rest[i - 1];
  if (neighbour) openTask(neighbour);
  else navigate({ view: 'board' });
}

/** Keeps a tab's cached label in step with the task (e.g. after the issue is renamed). */
export function updateOpenTask(task: OpenTask) {
  const tabs = store.get().openTasks;
  const cur = tabs.find((t) => t.id === task.id);
  if (cur && (cur.key !== task.key || cur.title !== task.title)) saveOpenTasks(tabs.map((t) => (t.id === task.id ? task : t)));
}

function loadOpenTasks(config: AppConfig) {
  try {
    const raw = JSON.parse(safeGet(OPEN_TASKS) ?? '[]') as OpenTask[];
    const slugs = new Set(config.projects.map((p) => p.slug));
    store.set({ openTasks: Array.isArray(raw) ? raw.filter((t) => typeof t.id === 'number' && slugs.has(t.projectSlug)) : [] });
  } catch {
    /* a corrupt entry just means no tabs */
  }
}

export async function runPreflight(claudeBinary?: string) {
  store.set({ preflightRunning: true });
  try {
    const preflight = await api()['preflight:run']({ claudeBinary });
    store.set({ preflight });
    return preflight;
  } finally {
    store.set({ preflightRunning: false });
  }
}

export async function saveGeneral(general: GeneralSettings) {
  const config = await api()['config:setGeneral'](general);
  applyConfig(config);
  return config;
}

export async function savePriceTable(table: Record<string, Price>) {
  applyConfig(await api()['config:setPriceTable'](table));
}

export async function upsertProject(project: Project) {
  applyConfig(await api()['projects:upsert'](project));
}

export async function removeProject(slug: string) {
  const config = await api()['projects:remove']({ slug });
  saveOpenTasks(store.get().openTasks.filter((t) => t.projectSlug !== slug));
  if (store.get().route.project === slug) store.set((s) => ({ route: { ...s.route, project: undefined } }));
  applyConfig(config);
}

const THEME_CYCLE = { system: 'light', light: 'dark', dark: 'system' } as const;

export async function cycleTheme() {
  const config = store.get().config;
  if (!config) return;
  await saveGeneral({ ...generalOf(config), theme: THEME_CYCLE[config.theme] });
}

export function setSidebarCollapsed(collapsed: boolean) {
  safeSet(SIDEBAR, collapsed ? '1' : '0');
  store.set({ sidebarCollapsed: collapsed });
}

/** The general-settings slice of the config, for forms. */
export function generalOf(config: AppConfig): GeneralSettings {
  const { claudeBinary, maxConcurrentSessions, defaultTemplate, theme, dataRoot, trustWorktrees } = config;
  return { claudeBinary, maxConcurrentSessions, defaultTemplate, theme, dataRoot, trustWorktrees };
}
