import { useCallback, useEffect, type ReactNode } from 'react';
import { applyConfig, closeTask, navigate, openTaskById } from '../actions';
import { Board } from '../board/Board';
import { TASK_TAB_KEYS, TaskWorkspace } from '../task/TaskWorkspace';
import { FOCUS_SEARCH_EVENT } from '../board/FilterBar';
import { Dialog, Kbd, useToast } from '../ui';
import { SHORTCUTS, useGlobalShortcuts } from '../lib/hooks';
import { store, useStore, type View } from '../store';
import { AddProject } from '../views/AddProject';
import { DevUi } from '../views/DevUi';
import { DoneView, MetricsView } from '../views/Placeholders';
import { NeedsYouView, RunningView } from '../views/Running';
import { Settings } from '../views/Settings';
import { CommandPalette } from './CommandPalette';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import { TopBar } from './TopBar';
import s from './shell.module.css';

const VIEWS: Record<View, () => ReactNode> = {
  board: () => <Board />,
  task: () => <TaskWorkspace />,
  running: () => <RunningView />,
  needs: () => <NeedsYouView />,
  done: () => <DoneView />,
  metrics: () => <MetricsView />,
  settings: () => <Settings />,
  'add-project': () => <AddProject />,
  devui: () => <DevUi />,
};

export function Shell() {
  const view = useStore((st) => st.route.view);
  const collapsed = useStore((st) => st.sidebarCollapsed);
  const platform = useStore((st) => st.info?.platform);
  const shortcutsOpen = useStore((st) => st.shortcutsOpen);

  // Ctrl+W: main catches the real key press (so the window stays open) and sends shortcut:closeTab.
  // A key event that reaches the page anyway (e.g. one injected for testing) closes the tab the same way.
  useEffect(() => {
    const closeCurrent = () => {
      const { route } = store.get();
      if (route.view === 'task' && route.task !== undefined) closeTask(route.task);
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        closeCurrent();
      }
    };
    window.addEventListener('keydown', onKey);
    const off = window.api.on('shortcut:closeTab', closeCurrent);
    return () => {
      window.removeEventListener('keydown', onKey);
      off();
    };
  }, []);

  // Live sessions (Running view, sidebar count, status bar) and main's toasts.
  const toast = useToast();
  useEffect(() => {
    void window.api.invoke['sessions:summary']().then((sessions) => store.set({ sessions }), () => {});
    const offs = [
      window.api.on('sessions:changed', (sessions) => store.set({ sessions })),
      window.api.on('config:changed', applyConfig),
      window.api.on('notice:open', ({ taskId }) => void openTaskById(taskId)),
      window.api.on('notice', (n) => {
        const taskId = n.taskId;
        const viewing = store.get().route.view === 'task' && store.get().route.task === taskId;
        toast({
          tone: n.tone,
          title: n.title,
          description: n.description,
          ...(taskId !== undefined && !viewing ? { action: { label: 'Open task', onClick: () => void openTaskById(taskId, { tab: 'terminal' }) } } : {}),
        });
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [toast]);

  const onLetter = useCallback((k: string) => {
    const { route, newIssue } = store.get();
    if (route.view === 'task') {
      const tab = TASK_TAB_KEYS[k as '1'];
      if (tab) navigate({ taskTab: tab });
      return !!tab;
    }
    if (route.view !== 'board' || newIssue) return false;
    if (k === 'c') store.set({ newIssue: { column: 'backlog' } });
    else if (k === '/') window.dispatchEvent(new Event(FOCUS_SEARCH_EVENT));
    else return false;
    return true;
  }, []);
  useGlobalShortcuts(onLetter);

  return (
    <div className={s.app} data-collapsed={collapsed} data-platform={platform}>
      <Sidebar />
      <div className={s.mainCol}>
        <TopBar />
        <main className={s.content}>{VIEWS[view]()}</main>
        <StatusBar />
      </div>
      <CommandPalette />
      <Dialog open={shortcutsOpen} onOpenChange={(o) => store.set({ shortcutsOpen: o })} title="Keyboard shortcuts">
        <div className={s.shortcutList}>
          {SHORTCUTS.map((sc) => (
            <ShortcutRow key={sc.label} label={sc.label} keys={sc.keys} />
          ))}
        </div>
      </Dialog>
    </div>
  );
}

function ShortcutRow({ label, keys }: { label: string; keys: string[] }) {
  return (
    <>
      <span className={s.shortcutLabel}>{label}</span>
      <Kbd keys={keys} />
    </>
  );
}
