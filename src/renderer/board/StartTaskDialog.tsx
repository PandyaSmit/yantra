import { FolderGit2, GitBranch, Info, NotebookPen } from 'lucide-react';
import type { Card } from '@shared/board';
import { Button, Dialog } from '../ui';
import b from './board.module.css';

/**
 * Opened by dropping a task-less card on In Progress, or by "Start task" in the drawer.
 * Phase 2 shows what will happen; Phase 3 adds the template picker and actually creates the task.
 * Cancelling puts a dragged card back where it was.
 */
export function StartTaskDialog({ card, onClose }: { card: Card | null; onClose: () => void }) {
  return (
    <Dialog
      open={!!card}
      onOpenChange={(o) => !o && onClose()}
      title={card ? `Start a task for ${card.key}` : 'Start task'}
      description={card?.title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} autoFocus>
            Cancel
          </Button>
          <Button variant="primary" disabled>
            Start task
          </Button>
        </>
      }
    >
      <ul className={b.startList}>
        <li>
          <GitBranch size={16} /> A branch <span className="mono">yantra/{card?.key ?? 'KEY-1'}-…</span> in its own worktree
        </li>
        <li>
          <FolderGit2 size={16} /> A task folder with the issue snapshot, a brief and your attachments
        </li>
        <li>
          <NotebookPen size={16} /> Stages from the template you pick: research, plan, code, review
        </li>
      </ul>
      <div className={b.startNote}>
        <Info size={16} />
        <div>Starting tasks arrives in Phase 3. For now the card stays where it was.</div>
      </div>
    </Dialog>
  );
}
