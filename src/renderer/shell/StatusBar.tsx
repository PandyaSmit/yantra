import { Activity, Clock, Coins } from 'lucide-react';
import { Tooltip } from '../ui';
import { navigate } from '../actions';
import { useStore } from '../store';
import { dollars, minutes, tokens } from '../task/Review';
import { useOverview } from '../views/Placeholders';
import s from './shell.module.css';

/** Live sessions come from main; today's tokens and agent time from the metrics overview. */
export function StatusBar() {
  const max = useStore((s) => s.sessions?.max ?? s.config?.maxConcurrentSessions ?? 3);
  const live = useStore((s) => s.sessions?.live ?? 0);
  const queued = useStore((s) => s.sessions?.sessions.filter((x) => x.status === 'queued').length ?? 0);
  const version = useStore((s) => s.info?.version);
  const project = useStore((s) => s.config?.projects.find((p) => p.slug === s.route.project));
  const today = useOverview()?.today;
  const t = today?.tokens;

  return (
    <footer className={s.statusbar}>
      <Tooltip content="Open metrics" side="top">
        <button type="button" className={s.statusItem} onClick={() => navigate({ view: 'metrics' })}>
          <Activity size={12} aria-hidden color={live > 0 ? 'var(--running)' : undefined} />
          {live}/{max} sessions live
          {queued > 0 && <span className={s.sep}>· {queued} queued</span>}
        </button>
      </Tooltip>
      <span className={s.statusItem}>
        <Coins size={12} aria-hidden />
        {tokens(t ? t.input + t.output + t.cacheRead + t.cacheWrite : 0)} tokens today <span className={s.sep}>(est. {dollars(t?.cost ?? 0)})</span>
      </span>
      <span className={s.statusItem}>
        <Clock size={12} aria-hidden />
        {minutes(today?.activeMs ?? 0)} agent time
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
