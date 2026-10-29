import { Bell, ChevronRight, Play } from 'lucide-react';
import type { LiveSession } from '@shared/sessions';
import { EmptyState, Pill, ProjectMark, Skeleton } from '../ui';
import { openTaskById } from '../actions';
import { relativeTime } from '../lib/format';
import { NO_PROJECTS, useStore } from '../store';
import v from './views.module.css';

/** Every live, queued or idle stage across projects. Click one to open its terminal. */
export function RunningView() {
  const summary = useStore((s) => s.sessions);
  const projects = useStore((s) => s.config?.projects ?? NO_PROJECTS);

  return (
    <div className={v.page}>
      <div className={v.pageHeader}>
        <div>
          <h1>Running</h1>
          <p className={v.pageSub}>
            Every live, queued or idle stage, across projects.
            {summary && ` ${summary.live} of ${summary.max} session slots in use.`}
          </p>
        </div>
      </div>
      <div className={v.card}>
        {!summary ? (
          <div className={v.cardPad}>
            <Skeleton height={44} />
          </div>
        ) : summary.sessions.length === 0 ? (
          <EmptyState icon={Play} title="Nothing running" hint="Stages appear here while Claude works on them. Open a task and press Start." />
        ) : (
          <ul className={v.sessionList}>
            {summary.sessions.map((s) => (
              <SessionRow key={s.stageId} s={s} project={projects.find((p) => p.slug === s.projectSlug)} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SessionRow({ s, project }: { s: LiveSession; project?: { name: string; color: Parameters<typeof ProjectMark>[0]['color'] } }) {
  const when = s.status === 'queued' ? `Queued, ${ordinal(s.queuePosition ?? 1)} in line` : s.startedAt ? `Started ${relativeTime(s.startedAt)}` : '';
  return (
    <li>
      <button type="button" className={v.sessionRow} onClick={() => void openTaskById(s.taskId, { tab: 'terminal' })}>
        {project && <ProjectMark name={project.name} color={project.color} />}
        <span className={`${v.sessionKey} mono`}>{s.issueKey}</span>
        <span className={v.sessionMain}>
          <span className={v.sessionTitle}>{s.title}</span>
          <span className={v.sessionMeta}>
            {s.stageTitle}
            {when && ` · ${when}`}
            {s.lastMessage && ` · ${s.lastMessage.split('\n')[0]}`}
          </span>
        </span>
        <Pill status={s.status} />
        <ChevronRight size={16} className={v.muted} aria-hidden />
      </button>
    </li>
  );
}

/** Every stage waiting for my approval, oldest first. Click one to review its artifact. */
export function NeedsYouView() {
  const summary = useStore((s) => s.sessions);
  const projects = useStore((s) => s.config?.projects ?? NO_PROJECTS);
  return (
    <div className={v.page}>
      <div className={v.pageHeader}>
        <div>
          <h1>Needs you</h1>
          <p className={v.pageSub}>Stages whose artifact is written and waiting for your approval, oldest first.</p>
        </div>
      </div>
      <div className={v.card}>
        {!summary ? (
          <div className={v.cardPad}>
            <Skeleton height={44} />
          </div>
        ) : summary.needs.length === 0 ? (
          <EmptyState icon={Bell} title="Nothing waiting on you" hint="When a stage finishes its artifact, it waits here until you approve it or ask for changes." />
        ) : (
          <ul className={v.sessionList}>
            {summary.needs.map((n) => {
              const project = projects.find((p) => p.slug === n.projectSlug);
              return (
                <li key={n.stageId}>
                  <button type="button" className={v.sessionRow} onClick={() => void openTaskById(n.taskId, { tab: 'files', file: n.artifact ?? undefined })}>
                    {project && <ProjectMark name={project.name} color={project.color} />}
                    <span className={`${v.sessionKey} mono`}>{n.issueKey}</span>{' '}
                    <span className={v.sessionMain}>
                      <span className={v.sessionTitle}>{n.title}</span>
                      <span className={v.sessionMeta}>
                        {n.stageTitle}
                        {n.round > 1 && ` round ${n.round}`}
                        {n.artifact && ` · ${n.artifact}`}
                        {n.awaitingSince && ` · waiting ${relativeTime(n.awaitingSince).replace(/ ago$/, '')}`}
                      </span>
                    </span>
                    <Pill status="awaiting_approval" />
                    <ChevronRight size={16} className={v.muted} aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

const ordinal =(n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
