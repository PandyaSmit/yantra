import { useRef, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Plus } from 'lucide-react';
import { COLUMN_LABEL, type Card, type ColumnKey, type LabelInfo } from '@shared/board';
import { Input, useToast } from '../ui';
import { errorMessage } from '../actions';
import { SortableCard } from './IssueCard';
import b from './board.module.css';

const DOT: Record<ColumnKey, string> = {
  backlog: 'var(--text-faint)',
  todo: 'var(--slate)',
  in_progress: 'var(--running)',
  review: 'var(--needs-you)',
  done: 'var(--ok)',
};

const EMPTY_HINT: Record<ColumnKey, string> = {
  backlog: 'Ideas and not-yet-triaged issues',
  todo: 'Ready to pick up',
  in_progress: 'Drop a card here to start a task',
  review: 'Tasks ready to ship',
  done: 'Shipped or closed',
};

export const columnDropId = (key: ColumnKey) => `col:${key}`;

interface Props {
  column: ColumnKey;
  ids: number[];
  cards: Map<number, Card>;
  labels: LabelInfo[];
  projectSlug: string;
  openId: number | undefined;
  total: number; // cards in the column before filtering
  filtering: boolean;
}

export function Column({ column, ids, cards, labels, projectSlug, openId, total, filtering }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: columnDropId(column) });
  const canAdd = column === 'backlog' || column === 'todo';

  return (
    <section className={b.column} aria-label={COLUMN_LABEL[column]} data-over={isOver || undefined}>
      <header className={b.columnHeader}>
        <span className={b.columnDot} style={{ background: DOT[column] }} />
        <h2 className={b.columnTitle}>{COLUMN_LABEL[column]}</h2>
        <span className={b.columnCount} title={filtering ? `${ids.length} shown of ${total}` : undefined}>
          {filtering ? `${ids.length}/${total}` : ids.length}
        </span>
      </header>
      <div ref={setNodeRef} className={b.columnBody}>
        <SortableContext id={columnDropId(column)} items={ids} strategy={verticalListSortingStrategy}>
          {ids.map((id) => {
            const card = cards.get(id);
            return card ? <SortableCard key={id} card={card} labels={labels} selected={id === openId} /> : null;
          })}
        </SortableContext>
        {ids.length === 0 && <div className={b.columnEmpty}>{EMPTY_HINT[column]}</div>}
        {canAdd && <InlineAdd column={column} projectSlug={projectSlug} />}
      </div>
    </section>
  );
}

/** "+ Add issue" at the bottom of a column: type a title, Enter creates and keeps the box open for the next one. */
function InlineAdd({ column, projectSlug }: { column: 'backlog' | 'todo'; projectSlug: string }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const button = useRef<HTMLButtonElement>(null);

  const close = () => {
    setOpen(false);
    setTitle('');
    requestAnimationFrame(() => button.current?.focus());
  };
  const create = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      await window.api.invoke['issues:create']({ projectSlug, title, column });
      setTitle('');
    } catch (e) {
      toast({ tone: 'error', title: 'Could not create the issue', description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  if (!open)
    return (
      <button ref={button} type="button" className={b.addButton} onClick={() => setOpen(true)}>
        <Plus size={14} /> Add issue
      </button>
    );
  return (
    <div className={b.inlineAdd}>
      <Input
        autoFocus
        aria-label={`New issue title in ${COLUMN_LABEL[column]}`}
        placeholder="Issue title"
        value={title}
        disabled={busy}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void create();
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            close();
          }
        }}
        onBlur={() => !title.trim() && close()}
      />
      <div className={b.inlineHint}>Enter to add · Esc to close</div>
    </div>
  );
}
