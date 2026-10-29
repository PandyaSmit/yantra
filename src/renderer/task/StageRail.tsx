import { Fragment } from 'react';
import type { StageInfo } from '@shared/tasks';
import { StatusIcon, STATUS_STYLE, Tooltip } from '../ui';
import t from './task.module.css';

/** The stepper: one node per stage in template order, coloured by stage status. */
export function StageRail({ stages }: { stages: StageInfo[] }) {
  return (
    <ol className={t.rail} aria-label="Stages">
      {stages.map((s, i) => {
        const st = STATUS_STYLE[s.status];
        return (
          <Fragment key={s.key}>
            {i > 0 && <li className={t.railLine} aria-hidden data-done={stages[i - 1]!.status === 'approved' || undefined} />}
            <li className={t.railStep}>
              <Tooltip content={`${st.label}${s.round > 1 ? ` · round ${s.round}` : ''}`}>
                <span className={t.railNode} style={{ background: st.soft, color: st.color }} tabIndex={0}>
                  <StatusIcon status={s.status} size={14} />
                  <span className={t.railTitle}>{s.title}</span>
                  {s.round > 1 && <span className={t.railRound}>r{s.round}</span>}
                </span>
              </Tooltip>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
