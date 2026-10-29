// The tiny store: one state object, subscribe/notify, and a selector hook. No library.
import { useSyncExternalStore } from 'react';
import type { BoardFilters } from '@shared/board';
import type { AppConfig } from '@shared/schemas';
import type { SessionsSummary } from '@shared/sessions';
import type { AppInfo, PreflightResult, ResolvedTheme } from '@shared/types';

export type View = 'board' | 'task' | 'running' | 'needs' | 'done' | 'metrics' | 'settings' | 'add-project' | 'devui';
export type SettingsSection = 'projects' | 'general' | 'pricing';
export type TaskTab = 'terminal' | 'files' | 'diff' | 'metrics';

export interface Route {
  view: View;
  /** The project whose board is pinned as the first tab. */
  project?: string;
  section?: SettingsSection;
  /** The issue open in the board's drawer. */
  issue?: number;
  /** The task shown when view is 'task', its sub-tab, and the task-folder file open in Files. */
  task?: number;
  taskTab?: TaskTab;
  file?: string;
}

/** A task tab in the top bar. The label is cached so the strip renders before the task loads. */
export interface OpenTask {
  id: number;
  key: string;
  title: string;
  projectSlug: string;
}

export interface AppState {
  status: 'loading' | 'ready' | 'config-error';
  config: AppConfig | null;
  configError: { path: string; error: string; issues: string[] } | null;
  info: AppInfo | null;
  preflight: PreflightResult | null;
  preflightRunning: boolean;
  route: Route;
  sidebarCollapsed: boolean;
  paletteOpen: boolean;
  shortcutsOpen: boolean;
  /** New-issue dialog: open for this column, or null. */
  newIssue: { column: 'backlog' | 'todo' } | null;
  /** Board filters per project, for this session only (SPEC: not persisted in MVP). */
  filters: Record<string, BoardFilters>;
  /** Task tabs, in strip order (kept across restarts in localStorage). */
  openTasks: OpenTask[];
  theme: ResolvedTheme;
  /** Live and queued stage sessions, pushed by main on every change. */
  sessions: SessionsSummary | null;
}

const initial: AppState = {
  status: 'loading',
  config: null,
  configError: null,
  info: null,
  preflight: null,
  preflightRunning: false,
  route: { view: 'board' },
  sidebarCollapsed: false,
  paletteOpen: false,
  shortcutsOpen: false,
  newIssue: null,
  filters: {},
  openTasks: [],
  theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  sessions: null,
};

let state = initial;
const listeners = new Set<() => void>();

export const store = {
  get: () => state,
  set(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
    state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

/** Stable fallback for selectors: a fresh `[]` per call makes useSyncExternalStore re-render forever. */
export const NO_PROJECTS: AppConfig['projects'] = [];

/** Select a slice. Return primitives or existing references so renders stay stable. */
export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()));
}
