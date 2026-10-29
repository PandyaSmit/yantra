import { Bell, CircleCheck, LayoutGrid, Monitor, Moon, Palette, Play, Plus, Search, Settings, Sigma, Sun, X, type LucideIcon } from 'lucide-react';
import { IconButton, Kbd } from '../ui';
import { closeTask, cycleTheme, navigate, openTask } from '../actions';
import { store, useStore, type View } from '../store';
import s from './shell.module.css';

const VIEW_TAB: Partial<Record<View, { label: string; icon: LucideIcon }>> = {
  running: { label: 'Running', icon: Play },
  needs: { label: 'Needs you', icon: Bell },
  done: { label: 'Done', icon: CircleCheck },
  metrics: { label: 'Metrics', icon: Sigma },
  settings: { label: 'Settings', icon: Settings },
  'add-project': { label: 'Add project', icon: Plus },
  devui: { label: 'UI gallery', icon: Palette },
};

const THEME_ICON = { system: Monitor, light: Sun, dark: Moon } as const;
const THEME_LABEL = { system: 'Theme: system', light: 'Theme: light', dark: 'Theme: dark' } as const;

export function TopBar() {
  const route = useStore((s) => s.route);
  const project = useStore((s) => s.config?.projects.find((p) => p.slug === s.route.project));
  const theme = useStore((s) => s.config?.theme ?? 'system');
  const openTasks = useStore((s) => s.openTasks);
  const viewTab = VIEW_TAB[route.view];

  return (
    <header className={`${s.topbar} drag`}>
      {/* Board is always the first, pinned tab; each open task follows it. */}
      <div className={s.tabStrip} role="tablist" aria-label="Open tabs">
        {project && (
          <button
            type="button"
            role="tab"
            aria-selected={route.view === 'board'}
            className={s.tab}
            onClick={() => navigate({ view: 'board' })}
          >
            <LayoutGrid size={14} aria-hidden />
            <span className={s.tabText}>{project.name} board</span>
          </button>
        )}
        {openTasks.map((t) => {
          const selected = route.view === 'task' && route.task === t.id;
          return (
            <div key={t.id} className={s.taskTab} data-selected={selected || undefined}>
              <button
                type="button"
                role="tab"
                aria-selected={selected}
                className={s.tab}
                title={`${t.key} ${t.title}`}
                onClick={() => openTask(t)}
                onAuxClick={(e) => e.button === 1 && closeTask(t.id)}
              >
                <span className={`${s.tabKey} mono`}>{t.key}</span>
                <span className={s.tabText}>{t.title}</span>
              </button>
              <button type="button" className={s.tabClose} aria-label={`Close ${t.key}`} title="Close tab (Ctrl+W)" onClick={() => closeTask(t.id)}>
                <X size={12} aria-hidden />
              </button>
            </div>
          );
        })}
        {viewTab && (
          <button type="button" role="tab" aria-selected className={s.tab}>
            <viewTab.icon size={14} aria-hidden />
            <span className={s.tabText}>{viewTab.label}</span>
          </button>
        )}
      </div>

      <div className={s.spacer} />

      <button type="button" className={s.search} onClick={() => store.set({ paletteOpen: true })}>
        <Search size={14} aria-hidden />
        <span className={s.searchText}>Search or jump to…</span>
        <Kbd keys={['Ctrl', 'K']} />
      </button>
      <IconButton icon={THEME_ICON[theme]} label={THEME_LABEL[theme]} shortcut={['Ctrl', 'Shift', 'L']} onClick={() => void cycleTheme()} />
      <IconButton
        icon={Settings}
        label="Settings"
        shortcut={['G', 'S']}
        active={route.view === 'settings'}
        onClick={() => navigate({ view: 'settings' })}
      />
    </header>
  );
}
