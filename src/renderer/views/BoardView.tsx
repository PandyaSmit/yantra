import { useState } from 'react';
import { FileText, Lightbulb, Plus, X } from 'lucide-react';
import { Button, EmptyState, IconButton, Kbd, Tooltip } from '../ui';
import { useStore } from '../store';
import v from './views.module.css';

const COLUMNS = [
  { key: 'backlog', label: 'Backlog', color: 'var(--text-faint)' },
  { key: 'todo', label: 'Todo', color: 'var(--slate)' },
  { key: 'in_progress', label: 'In Progress', color: 'var(--running)' },
  { key: 'review', label: 'Review', color: 'var(--needs-you)' },
  { key: 'done', label: 'Done', color: 'var(--ok)' },
];

const TIP_KEY = 'yantra.tip.dragToStart';

/** Phase 1: the board's frame and empty state. Cards, drawer and drag-and-drop arrive in Phase 2. */
export function BoardView() {
  const project = useStore((s) => s.config?.projects.find((p) => p.slug === s.route.project));
  const [tip, setTip] = useState(() => {
    try {
      return localStorage.getItem(TIP_KEY) !== 'dismissed';
    } catch {
      return true;
    }
  });
  if (!project) return null;

  const dismissTip = () => {
    setTip(false);
    try {
      localStorage.setItem(TIP_KEY, 'dismissed');
    } catch {
      /* convenience only */
    }
  };

  return (
    <div className={v.board}>
      <div className={v.boardHeader}>
        <span className={v.boardStrip} style={{ background: `var(--${project.color})` }} />
        <div>
          <div className={v.boardTitle}>{project.name}</div>
          <div className={v.boardMeta}>
            <span className="mono">{project.key}</span> · {project.defaultBranch} · <span className="mono">{project.repoPath}</span>
          </div>
        </div>
        <div className={v.pageActions}>
          <Tooltip content="Writing issues arrives in Phase 2" shortcut={['C']}>
            <span>
              <Button variant="primary" icon={Plus} disabled>
                New issue
              </Button>
            </span>
          </Tooltip>
        </div>
      </div>

      {tip && (
        <div className={v.tip}>
          <Lightbulb size={16} />
          <span style={{ flex: 1 }}>Drag a card to In Progress to start a task.</span>
          <IconButton icon={X} label="Dismiss tip" size="sm" onClick={dismissTip} />
        </div>
      )}

      <div className={v.columns}>
        {COLUMNS.map((c) => (
          <section key={c.key} className={v.column} aria-label={c.label}>
            <div className={v.columnHeader}>
              <span className={v.columnDot} style={{ background: c.color }} />
              {c.label}
              <span className={v.columnCount}>0</span>
            </div>
            <div className={v.ghostCard} />
          </section>
        ))}
        <div className={v.boardEmpty}>
          <EmptyState
            icon={FileText}
            title="No issues yet"
            hint={
              <>
                Press <Kbd keys={['C']} /> to write one. (The board comes alive in Phase 2.)
              </>
            }
          />
        </div>
      </div>
    </div>
  );
}
