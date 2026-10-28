import type { KeyboardEvent } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Archive, MessageSquare, Paperclip } from 'lucide-react';
import type { Card, LabelInfo } from '@shared/board';
import { Tag } from '../ui';
import { openIssue } from '../actions';
import { LabelChips } from './LabelPicker';
import { PriorityIcon } from './Priority';
import b from './board.module.css';

const TASK_LABEL = { draft: 'Draft', active: 'Active', ready_to_ship: 'Ready to ship', pushed: 'Pushed', done: 'Done' } as const;

/** The card's content; used in the column and, while dragging, in the drag overlay. */
export function CardView({ card, labels, overlay }: { card: Card; labels: LabelInfo[]; overlay?: boolean }) {
  return (
    <div className={b.card} data-overlay={overlay || undefined} data-archived={card.archived || undefined}>
      <div className={b.cardTop}>
        <span className={b.cardKey}>{card.key}</span>
        {card.priority > 0 && <PriorityIcon priority={card.priority} size={13} />}
        {card.task && (
          <span className={b.cardTask}>
            <Tag tone={card.task.status === 'done' ? 'ok' : 'accent'}>{TASK_LABEL[card.task.status]}</Tag>
          </span>
        )}
      </div>
      <div className={b.cardTitle}>{card.title}</div>
      {(card.labelIds.length > 0 || card.commentCount > 0 || card.attachmentCount > 0 || card.archived) && (
        <div className={b.cardFoot}>
          <LabelChips labels={labels} ids={card.labelIds} max={3} />
          <span className={b.cardCounts}>
            {card.archived && (
              <span title="Archived">
                <Archive size={12} />
              </span>
            )}
            {card.commentCount > 0 && (
              <span title={`${card.commentCount} comment${card.commentCount === 1 ? '' : 's'}`}>
                <MessageSquare size={12} />
                {card.commentCount}
              </span>
            )}
            {card.attachmentCount > 0 && (
              <span title={`${card.attachmentCount} attachment${card.attachmentCount === 1 ? '' : 's'}`}>
                <Paperclip size={12} />
                {card.attachmentCount}
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

/** A draggable card. Space picks it up (arrows move, Space/Enter drops, Esc cancels); Enter or click opens it. */
export function SortableCard({ card, labels, selected }: { card: Card; labels: LabelInfo[]; selected: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id });

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !isDragging) {
      e.preventDefault();
      openIssue(card.id);
      return;
    }
    listeners?.onKeyDown?.(e);
  };

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={b.cardSlot}
      data-dragging={isDragging || undefined}
      data-selected={selected || undefined}
      data-card-id={card.id}
      {...attributes}
      {...listeners}
      aria-label={`${card.key} ${card.title}`}
      onKeyDown={onKeyDown}
      onClick={() => openIssue(card.id)}
    >
      <CardView card={card} labels={labels} />
    </div>
  );
}
