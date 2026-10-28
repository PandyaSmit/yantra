import { useState } from 'react';
import { Check, Pencil, Plus, Trash, X } from 'lucide-react';
import type { LabelInfo } from '@shared/board';
import { PALETTE, type PaletteName } from '@shared/palette';
import { Button, ColorSwatches, ConfirmDialog, Dialog, EmptyState, IconButton, Input, useToast } from '../ui';
import { errorMessage } from '../actions';
import b from './board.module.css';

/** Rename, recolour, add and delete a project's labels. */
export function LabelsDialog({
  open,
  onOpenChange,
  projectSlug,
  labels,
  usage,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectSlug: string;
  labels: LabelInfo[];
  usage: Map<number, number>;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState<{ id?: number; name: string; color: PaletteName } | null>(null);
  const [deleting, setDeleting] = useState<LabelInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!editing) return;
    try {
      await window.api.invoke['labels:upsert']({ ...editing, projectSlug });
      setEditing(null);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const editor = editing && (
    <div className={b.labelEditor}>
      <Input
        autoFocus
        aria-label="Label name"
        placeholder="Label name"
        value={editing.name}
        onChange={(e) => setEditing({ ...editing, name: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save();
          if (e.key === 'Escape') {
            e.stopPropagation();
            setEditing(null);
          }
        }}
      />
      <ColorSwatches label="Label colour" value={editing.color} onChange={(color) => setEditing({ ...editing, color })} />
      {error && <div className={b.labelError}>{error}</div>}
      <div className={b.labelEditorActions}>
        <Button size="sm" variant="ghost" icon={X} onClick={() => setEditing(null)}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" icon={Check} onClick={save}>
          Save
        </Button>
      </div>
    </div>
  );

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title="Labels"
        description="Labels belong to this project. Deleting one removes it from every issue."
        footer={
          <Button
            icon={Plus}
            onClick={() => {
              setError(null);
              setEditing({ name: '', color: PALETTE[(labels.length + 6) % PALETTE.length]! });
            }}
          >
            New label
          </Button>
        }
      >
        <div className={b.labelRows}>
          {labels.length === 0 && !editing && <EmptyState icon={Plus} title="No labels yet" hint="Labels like bug, ui or docs help you filter the board." />}
          {labels.map((l) =>
            editing?.id === l.id ? (
              <div key={l.id}>{editor}</div>
            ) : (
              <div key={l.id} className={b.labelRow}>
                <span className={b.chip} style={{ background: `var(--${l.color}-bg)`, color: `var(--${l.color}-fg)` }}>
                  {l.name}
                </span>
                <span className={b.labelUsage}>
                  {usage.get(l.id) ?? 0} issue{usage.get(l.id) === 1 ? '' : 's'}
                </span>
                <IconButton
                  icon={Pencil}
                  label={`Edit ${l.name}`}
                  size="sm"
                  onClick={() => {
                    setError(null);
                    setEditing({ id: l.id, name: l.name, color: l.color });
                  }}
                />
                <IconButton icon={Trash} label={`Delete ${l.name}`} size="sm" onClick={() => setDeleting(l)} />
              </div>
            ),
          )}
          {editing && editing.id === undefined && editor}
        </div>
      </Dialog>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete "${deleting?.name}"?`}
        consequence={`It comes off ${usage.get(deleting?.id ?? 0) ?? 0} issue(s). The issues themselves stay.`}
        confirmLabel="Delete label"
        danger
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await window.api.invoke['labels:delete']({ id: deleting.id });
          } catch (e) {
            toast({ tone: 'error', title: 'Could not delete the label', description: errorMessage(e) });
          }
        }}
      />
    </>
  );
}
