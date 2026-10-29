import { useEffect, useState } from 'react';
import { CircleCheck, Sigma } from 'lucide-react';
import type { MetricsOverview } from '@shared/metrics';
import { EmptyState, Skeleton } from '../ui';
import { openTaskById } from '../actions';
import { shortDate } from '../lib/format';
import { dollars, minutes, tokens } from '../task/Review';
import v from './views.module.css';

const total = (t: MetricsOverview['today']['tokens']) => t.input + t.output + t.cacheRead + t.cacheWrite;

/** Overview numbers, refetched whenever a task or the session list changes. */
export function useOverview() {
  const [data, setData] = useState<MetricsOverview | null>(null);
  useEffect(() => {
    const load = () => void window.api.invoke['metrics:overview']().then(setData, () => {});
    load();
    const offs = [window.api.on('task:changed', load), window.api.on('sessions:changed', load)];
    return () => offs.forEach((off) => off());
  }, []);
  return data;
}

function Page({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className={v.page}>
      <div className={v.pageHeader}>
        <div>
          <h1>{title}</h1>
          <p className={v.pageSub}>{sub}</p>
        </div>
      </div>
      <div className={v.card}>{children}</div>
    </div>
  );
}

export function DoneView() {
  const o = useOverview();
  return (
    <Page title="Done" sub="Finished tasks, with their folders, transcripts and metrics.">
      {!o ? (
        <Skeleton height={120} />
      ) : !o.done.length ? (
        <EmptyState icon={CircleCheck} title="No finished tasks yet" hint="Tasks land here after you push the branch, merge it yourself and click Mark done." />
      ) : (
        <table className={v.priceTable}>
          <thead>
            <tr>
              <th>Issue</th>
              <th>Template</th>
              <th>Closed</th>
              <th>Wall clock</th>
              <th>Agent time</th>
              <th>Tokens</th>
              <th>Est. cost</th>
            </tr>
          </thead>
          <tbody>
            {o.done.map((d) => (
              <tr key={d.taskId} style={{ cursor: 'pointer' }} onClick={() => void openTaskById(d.taskId)}>
                <td>
                  <span className="mono">{d.issueKey}</span> {d.title}
                </td>
                <td>{d.template}</td>
                <td>{shortDate(d.closedAt)}</td>
                <td>{minutes(d.wallMs)}</td>
                <td>{minutes(d.activeMs)}</td>
                <td>{tokens(total(d.tokens))}</td>
                <td>{dollars(d.tokens.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Page>
  );
}

export function MetricsView() {
  const o = useOverview();
  return (
    <Page title="Metrics" sub="Tokens and agent time per project, from Claude's own transcripts and hook timestamps. All costs are estimates.">
      {!o ? (
        <Skeleton height={120} />
      ) : !o.projects.length ? (
        <EmptyState icon={Sigma} title="No numbers yet" hint="Metrics appear once tasks run. Per-stage numbers are on each task's Metrics tab." />
      ) : (
        <>
          <p className={v.muted} style={{ marginBottom: 12 }}>
            Today: {tokens(total(o.today.tokens))} tokens · est. {dollars(o.today.tokens.cost)} · {minutes(o.today.activeMs)} agent time
          </p>
          <table className={v.priceTable}>
            <thead>
              <tr>
                <th>Project</th>
                <th>Tasks</th>
                <th>Done</th>
                <th>Agent time</th>
                <th>Tokens</th>
                <th>Est. cost</th>
              </tr>
            </thead>
            <tbody>
              {o.projects.map((p) => (
                <tr key={p.slug}>
                  <td>{p.slug}</td>
                  <td>{p.tasks}</td>
                  <td>{p.done}</td>
                  <td>{minutes(p.activeMs)}</td>
                  <td>{tokens(total(p.tokens))}</td>
                  <td>{dollars(p.tokens.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Page>
  );
}
