import { Fragment } from 'react';
import type { StageInfo } from '@shared/tasks';
import { StatusIcon, STATUS_STYLE, Tooltip } from '../ui';
import t from './task.module.css';

/** The stepper: one node per stage in template order, coloured by stage status. A stage with an artifact opens it. */
export function StageRail({ stages, onOpen }: { stages: StageInfo[]; onOpen?: (s: StageInfo) => void }) {
  return (
    <ol className={t.rail} aria-label="Stages">
      {stages.map((s, i) => {
        const st = STATUS_STYLE[s.status];
        const opens = onOpen && (s.status === 'approved' || s.status === 'awaiting_approval');
        const tip = [
          st.label,
          s.round > 1 && `round ${s.round}`,
          s.modified && `${s.artifact} modified since approval`,
          opens && `click to open ${s.artifact}`,
        ]
          .filter(Boolean)
          .join(' · ');
        const inner = (
          <>
            <StatusIcon status={s.status} size={14} />
            <span className={t.railTitle}>{s.title}</span>
            {s.round > 1 && <span className={t.railRound}>r{s.round}</span>}
            {s.modified && <span className={t.railModified} aria-label="modified since approval" />}
          </>
        );
        const style = { background: st.soft, color: st.color };
        return (
          <Fragment key={s.key}>
            {i > 0 && <li className={t.railLine} aria-hidden data-done={stages[i - 1]!.status === 'approved' || undefined} />}
            <li className={t.railStep}>
              <Tooltip content={tip}>
                {opens ? (
                  <button type="button" className={t.railNode} style={style} onClick={() => onOpen(s)}>
                    {inner}
                  </button>
                ) : (
                  <span className={t.railNode} style={style} tabIndex={0}>
                    {inner}
                  </span>
                )}
              </Tooltip>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
