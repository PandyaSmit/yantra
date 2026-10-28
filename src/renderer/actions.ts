// Everything that changes app state or talks to main goes through here.
import { IPC_ERROR_PREFIX } from '@shared/ipc';
import type { AppConfig, GeneralSettings, Price, Project } from '@shared/schemas';
import { store, type Route } from './store';

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
  store.set({ info, status: 'ready' });
  void runPreflight();
}

export function navigate(route: Partial<Route>) {
  const next = { ...store.get().route, ...route };
  if (next.project) safeSet(LAST_PROJECT, next.project);
  store.set({ route: next });
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
