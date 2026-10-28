import { useCallback, type ReactNode } from 'react';
import { Board } from '../board/Board';
import { FOCUS_SEARCH_EVENT } from '../board/FilterBar';
import { Dialog, Kbd } from '../ui';
import { SHORTCUTS, useGlobalShortcuts } from '../lib/hooks';
import { store, useStore, type View } from '../store';
import { AddProject } from '../views/AddProject';
import { DevUi } from '../views/DevUi';
import { DoneView, MetricsView, NeedsYouView, RunningView } from '../views/Placeholders';
import { Settings } from '../views/Settings';
import { CommandPalette } from './CommandPalette';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import { TopBar } from './TopBar';
import s from './shell.module.css';

const VIEWS: Record<View, () => ReactNode> = {
  board: () => <Board />,
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

  const onLetter = useCallback((k: string) => {
    const { route, newIssue } = store.get();
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
