import { useState, type ReactNode } from 'react';
import { Bell, CircleCheck, LayoutGrid, PanelLeftClose, PanelLeftOpen, Play, Plus, RefreshCw, Settings, Sigma, type LucideIcon } from 'lucide-react';
import type { NeedsYou } from '@shared/sessions';
import { IconButton, ProjectMark, Tooltip } from '../ui';
import { navigate, reloadConfig, setSidebarCollapsed } from '../actions';
import { NO_PROJECTS, useStore, type View } from '../store';
import { Logo } from './Logo';
import s from './shell.module.css';

const NO_NEEDS: NeedsYou[] = [];

const VIEWS:{ view: View; label: string; icon: LucideIcon; shortcut: string[] }[] = [
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
  const needs = useStore((s) => s.sessions?.needs ?? NO_NEEDS);
  const [refreshing, setRefreshing] = useState(false);

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
      </div>

      <nav className={s.nav}>
        <div className={s.section}>
          <div className={s.sectionTitle}>
            <span>Projects</span>
            <IconButton
              className={[s.sectionAction, refreshing && s.spinning].filter(Boolean).join(' ')}
              icon={RefreshCw}
              label="Refresh projects"
              size="sm"
              onClick={() => {
                setRefreshing(true);
                void reloadConfig().finally(() => setTimeout(() => setRefreshing(false), 400));
              }}
            />
          </div>
          {projects.map((p) => (
            <NavItem
              key={p.slug}
              icon={<ProjectMark name={p.name} color={p.color} />}
              label={p.name}
              current={route.view === 'board' && route.project === p.slug}
              onClick={() => navigate({ view: 'board', project: p.slug })}
              collapsed={collapsed}
              count={needs.filter((n) => n.projectSlug === p.slug).length}
              alert
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
              count={view === 'running' ? running : view === 'needs' ? needs.length : undefined}
              alert={view === 'needs'}
            />
          ))}
        </div>
      </nav>

      <div className={s.sidebarFooter}>
        <Tooltip content={claude.text} side="right">
          <button type="button" className={s.claudeStatus} onClick={() => navigate({ view: 'settings', section: 'general' })}>
            <span className={s.dot} style={{ background: claude.color }} />
            <span className={s.claudeText}>{claude.text}</span>
          </button>
        </Tooltip>
        <Tooltip content={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} shortcut={['Ctrl', 'B']} side="right">
          <button
            type="button"
            className={s.collapseToggle}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            onClick={() => setSidebarCollapsed(!collapsed)}
          >
            {collapsed ? <PanelLeftOpen size={16} aria-hidden /> : <PanelLeftClose size={16} aria-hidden />}
          </button>
        </Tooltip>
      </div>
    </aside>
  );
}
