import type { ReactNode } from 'react';
import { Bell, CircleCheck, LayoutGrid, PanelLeftClose, PanelLeftOpen, Play, Plus, Settings, Sigma, type LucideIcon } from 'lucide-react';
import { IconButton, ProjectMark, Tooltip } from '../ui';
import { navigate, setSidebarCollapsed } from '../actions';
import { NO_PROJECTS, useStore, type View } from '../store';
import { Logo } from './Logo';
import s from './shell.module.css';

const VIEWS: { view: View; label: string; icon: LucideIcon; shortcut: string[] }[] = [
  { view: 'board', label: 'Board', icon: LayoutGrid, shortcut: ['G', 'B'] },
  { view: 'running', label: 'Running', icon: Play, shortcut: ['G', 'R'] },
  { view: 'needs', label: 'Needs you', icon: Bell, shortcut: ['G', 'N'] },
  { view: 'done', label: 'Done', icon: CircleCheck, shortcut: ['G', 'D'] },
  { view: 'metrics', label: 'Metrics', icon: Sigma, shortcut: ['G', 'M'] },
  { view: 'settings', label: 'Settings', icon: Settings, shortcut: ['G', 'S'] },
];

function NavItem({
  icon,
  label,
  current,
  onClick,
  count,
  alert,
  collapsed,
  shortcut,
}: {
  icon: ReactNode;
  label: string;
  current: boolean;
  onClick: () => void;
  count?: number;
  alert?: boolean;
  collapsed: boolean;
  shortcut?: string[];
}) {
  const button = (
    <button type="button" className={s.navItem} aria-current={current ? 'page' : undefined} onClick={onClick} aria-label={label}>
      {icon}
      <span className={s.navLabel}>{label}</span>
      {!!count && <span className={[s.navCount, alert && s.navCountAlert].filter(Boolean).join(' ')}>{count}</span>}
    </button>
  );
  // Labels are hidden when collapsed, so the tooltip carries them.
  return collapsed ? (
    <Tooltip content={label} shortcut={shortcut} side="right">
      {button}
    </Tooltip>
  ) : (
    button
  );
}

export function Sidebar() {
  const collapsed = useStore((s) => s.sidebarCollapsed);
  const projects = useStore((s) => s.config?.projects ?? NO_PROJECTS);
  const route = useStore((s) => s.route);
  const preflight = useStore((s) => s.preflight);
  const preflightRunning = useStore((s) => s.preflightRunning);
  const running = useStore((s) => s.sessions?.sessions.length ?? 0);

  const claude = preflightRunning
    ? { color: 'var(--text-faint)', text: 'Checking Claude…' }
    : !preflight
      ? { color: 'var(--text-faint)', text: 'Claude not checked' }
      : preflight.ok
        ? { color: 'var(--ok)', text: `Claude ${preflight.binary.version} · ready` }
        : { color: 'var(--danger)', text: 'Claude needs setup' };

  return (
    <aside className={s.sidebar} aria-label="Sidebar">
      <div className={`${s.brand} drag`}>
        <Logo />
        <span className={s.brandName}>YANTRA</span>
        <IconButton
          className={s.collapseButton}
          icon={collapsed ? PanelLeftOpen : PanelLeftClose}
          label="Collapse sidebar"
          shortcut={['Ctrl', 'B']}
          size="sm"
          onClick={() => setSidebarCollapsed(!collapsed)}
        />
      </div>

      <nav className={s.nav}>
        <div className={s.section}>
          <div className={s.sectionTitle}>Projects</div>
          {projects.map((p) => (
            <NavItem
              key={p.slug}
              icon={<ProjectMark name={p.name} color={p.color} />}
              label={p.name}
              current={route.view === 'board' && route.project === p.slug}
              onClick={() => navigate({ view: 'board', project: p.slug })}
              collapsed={collapsed}
            />
          ))}
          <NavItem
            icon={<Plus size={16} aria-hidden />}
            label="Add project"
            current={route.view === 'add-project'}
            onClick={() => navigate({ view: 'add-project' })}
            collapsed={collapsed}
          />
        </div>

        <div className={s.section}>
          <div className={s.sectionTitle}>Views</div>
          {VIEWS.map(({ view, label, icon: Icon, shortcut }) => (
            <NavItem
              key={view}
              icon={<Icon size={16} aria-hidden />}
              label={label}
              current={route.view === view && view !== 'board'}
              onClick={() => navigate({ view })}
              collapsed={collapsed}
              shortcut={shortcut}
              count={view === 'running' ? running : undefined}
            />
          ))}
        </div>
      </nav>

      <div className={s.sidebarFooter}>
        <button type="button" className={s.claudeStatus} onClick={() => navigate({ view: 'settings', section: 'general' })}>
          <span className={s.dot} style={{ background: claude.color }} />
          <span>{claude.text}</span>
        </button>
      </div>
    </aside>
  );
}
