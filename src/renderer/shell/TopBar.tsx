import { Bell, CircleCheck, LayoutGrid, Monitor, Moon, Palette, Play, Plus, Search, Settings, Sigma, Sun, type LucideIcon } from 'lucide-react';
import { IconButton, Kbd } from '../ui';
import { cycleTheme, navigate } from '../actions';
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
  const viewTab = VIEW_TAB[route.view];

  return (
    <header className={`${s.topbar} drag`}>
      {/* Board is always the first, pinned tab. Task tabs join it in Phase 3. */}
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
