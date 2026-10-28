import { useEffect, useState } from 'react';
import { ChevronDown, Tag as TagIcon } from 'lucide-react';
import type { LabelInfo, Priority } from '@shared/board';
import type { Project } from '@shared/schemas';
import { Button, Dialog, Field, Input, Kbd, Select, Textarea, useToast } from '../ui';
import { errorMessage, openIssue } from '../actions';
import { store, useStore } from '../store';
import { LabelChips, LabelPicker } from './LabelPicker';
import { PriorityMenu } from './Priority';
import b from './board.module.css';

/** New issue (C on the board, the palette, or the header button). Ctrl+Enter creates. */
export function NewIssueDialog({ project, labels }: { project: Project; labels: LabelInfo[] }) {
  const req = useStore((s) => s.newIssue);
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [column, setColumn] = useState<'backlog' | 'todo'>('backlog');
  const [priority, setPriority] = useState<Priority>(0);
  const [labelIds, setLabelIds] = useState<number[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!req) return;
    setTitle('');
    setBody('');
    setColumn(req.column);
    setPriority(0);
    setLabelIds([]);
    setError(undefined);
  }, [req]);

  const close = () => store.set({ newIssue: null });
  const create = async (open: boolean) => {
    if (!title.trim()) return setError('Give the issue a title');
    setBusy(true);
    try {
      const card = await window.api.invoke['issues:create']({ projectSlug: project.slug, title, body, column, priority, labelIds });
      close();
      toast({ tone: 'success', title: `${card.key} created`, action: open ? undefined : { label: 'Open', onClick: () => openIssue(card.id) } });
      if (open) openIssue(card.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={!!req}
      onOpenChange={(o) => !o && close()}
      title={`New issue in ${project.name}`}
      wide
      footer={
        <>
          <span className={b.dialogHint}>
            <Kbd keys={['Ctrl', 'Enter']} /> to create
          </span>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button onClick={() => void create(true)} disabled={busy}>
            Create and open
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void create(false)}>
            Create issue
          </Button>
        </>
      }
    >
      <div
        className={b.newIssue}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void create(false);
          }
        }}
      >
        <Field label="Title" error={error}>
          {(p) => (
            <Input
              {...p}
              autoFocus
              placeholder="Fix webhook retry storm"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setError(undefined);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
                  e.preventDefault();
                  void create(false);
                }
              }}
            />
          )}
        </Field>
        <Field label="Description" hint="Markdown. Becomes the Goal in the task brief.">
          {(p) => <Textarea {...p} rows={6} placeholder="What's wrong, what done looks like, links…" value={body} onChange={(e) => setBody(e.target.value)} />}
        </Field>
        <div className={b.newIssueProps}>
          <Select aria-label="Column" value={column} onChange={(e) => setColumn(e.target.value as 'backlog' | 'todo')} style={{ width: 'auto' }}>
            <option value="backlog">Backlog</option>
            <option value="todo">Todo</option>
          </Select>
          <PriorityMenu value={priority} onChange={setPriority} />
          <LabelPicker
            labels={labels}
            selected={labelIds}
            onChange={setLabelIds}
            projectSlug={project.slug}
            trigger={
              <button type="button" className={b.propPill}>
                <TagIcon size={14} />
                {labelIds.length ? <LabelChips labels={labels} ids={labelIds} /> : 'Labels'}
                <ChevronDown size={12} />
              </button>
            }
          />
        </div>
      </div>
    </Dialog>
  );
}
