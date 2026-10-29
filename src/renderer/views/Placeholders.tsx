import type { ReactNode } from 'react';
import { CircleCheck, Sigma, type LucideIcon } from 'lucide-react';
import { EmptyState } from '../ui';
import v from './views.module.css';

function Page({ title, sub, icon, empty, hint }: { title: string; sub: string; icon: LucideIcon; empty: string; hint: ReactNode }) {
  return (
    <div className={v.page}>
      <div className={v.pageHeader}>
        <div>
          <h1>{title}</h1>
          <p className={v.pageSub}>{sub}</p>
        </div>
      </div>
      <div className={v.card}>
        <EmptyState icon={icon} title={empty} hint={hint} />
      </div>
    </div>
  );
}

export const DoneView = () => (
  <Page
    title="Done"
    sub="Finished tasks, with their folders, transcripts and metrics."
    icon={CircleCheck}
    empty="No finished tasks yet"
    hint="Tasks land here after you push the branch, merge it yourself and click Mark done."
  />
);

export const MetricsView = () => (
  <Page
    title="Metrics"
    sub="Tokens, agent time and waiting-on-you time, per stage, task and project."
    icon={Sigma}
    empty="No numbers yet"
    hint="Metrics come from Claude's own transcripts and hook timestamps once tasks run. All costs are estimates."
  />
);
