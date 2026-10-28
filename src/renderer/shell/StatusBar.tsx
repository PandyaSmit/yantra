import { Activity, Clock, Coins } from 'lucide-react';
import { Tooltip } from '../ui';
import { navigate } from '../actions';
import { useStore } from '../store';
import s from './shell.module.css';

/** Live numbers arrive with sessions (Phase 4) and metrics (Phase 7); until then they read zero. */
export function StatusBar() {
  const max = useStore((s) => s.config?.maxConcurrentSessions ?? 3);
  const version = useStore((s) => s.info?.version);
  const project = useStore((s) => s.config?.projects.find((p) => p.slug === s.route.project));

  return (
    <footer className={s.statusbar}>
      <Tooltip content="Open metrics" side="top">
        <button type="button" className={s.statusItem} onClick={() => navigate({ view: 'metrics' })}>
          <Activity size={12} aria-hidden />0/{max} sessions live
        </button>
      </Tooltip>
      <span className={s.statusItem}>
        <Coins size={12} aria-hidden />0 tokens today <span className={s.sep}>(est. $0.00)</span>
      </span>
      <span className={s.statusItem}>
        <Clock size={12} aria-hidden />0m agent time
      </span>
      <div className={s.statusRight}>
        {project && (
          <span className="mono" title={project.repoPath}>
            {project.key} · {project.defaultBranch}
          </span>
        )}
        <span>YANTRA {version}</span>
      </div>
    </footer>
  );
}
