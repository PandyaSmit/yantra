import { useEffect, useState } from 'react';
import type { StageInfo, TaskDetail } from '@shared/tasks';
import { Button, Dialog, Field, Markdown, Select, Tabs, Textarea } from '../ui';
import t from './task.module.css';

export type FeedbackMode = 'reject' | 'sendBack';

/**
 * Request changes (the current stage revises its artifact) or Send back (an earlier stage takes
 * another round and every stage after it starts over). The text becomes feedback/<stage>-round-N.md.
 */
export function FeedbackDialog({
  task,
  mode,
  onClose,
  onSubmit,
}: {
  task: TaskDetail;
  mode: FeedbackMode | null;
  onClose: () => void;
  onSubmit: (text: string, toStageKey: string) => Promise<boolean>;
}) {
  const [text, setText] = useState('');
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const current = task.stages.find((s) => s.status !== 'approved' && s.status !== 'skipped');

  useEffect(() => {
    if (!mode) return;
    setText('');
    setTab('write');
    setTarget(task.sendBackTargets[0] ?? '');
  }, [mode, task.sendBackTargets]);

  const stage = mode === 'reject' ? current : task.stages.find((s) => s.key === target);
  if (!stage) return null;
  const at = task.stages.indexOf(stage);
  const reset = mode === 'sendBack' ? task.stages.slice(at + 1).filter((s) => s.status !== 'skipped') : [];
  const round = stage.round + 1;
  const ready = text.trim() !== '' && !busy;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      if (await onSubmit(text, stage.key)) onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={mode !== null}
      onOpenChange={(o) => !o && onClose()}
      wide
      title={mode === 'reject' ? `Request changes to ${stage.title}` : 'Send work back'}
      description={
        mode === 'reject'
          ? `${stage.title} resumes the same conversation with this as round ${round} and revises ${stage.artifact}.`
          : `${stage.title} resumes its conversation with this as round ${round}.${reset.length ? ` ${list(reset)} start${reset.length === 1 ? 's' : ''} over afterwards, in a new session.` : ''}`
      }
      footer={
        <>
          <span className={t.feedbackFile}>
            Saved as <span className="mono">feedback/{stage.key}-round-{round}.md</span>
          </span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!ready} loading={busy} onClick={() => void submit()}>
            {mode === 'reject' ? 'Request changes' : `Send back to ${stage.title}`}
          </Button>
        </>
      }
    >
      <div className={t.feedback}>
        {mode === 'sendBack' && (
          <Field label="Send back to" hint={task.sendBackTargets.length > 1 ? 'Usually the stage just before this one.' : undefined}>
            {(p) => (
              <Select {...p} value={target} onChange={(e) => setTarget(e.target.value)}>
                {task.sendBackTargets.map((k) => (
                  <option key={k} value={k}>
                    {task.stages.find((s) => s.key === k)?.title ?? k}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <div className={t.feedbackBar}>
          <Tabs
            label="Feedback mode"
            value={tab}
            onChange={setTab}
            items={[
              { value: 'write', label: 'Write' },
              { value: 'preview', label: 'Preview' },
            ]}
          />
          <span className={t.spacer} />
          <span className={t.editorHint}>Markdown · Ctrl+Enter sends</span>
        </div>
        {tab === 'write' ? (
          <Textarea
            data-autofocus
            className={t.feedbackInput}
            aria-label="What should change"
            placeholder={mode === 'reject' ? `What should ${stage.title} change? Be specific: sections, cases, files.` : `What is wrong, and what should ${stage.title} do differently?`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void submit();
              }
            }}
          />
        ) : (
          <div className={t.feedbackPreview}>
            <Markdown empty="Nothing written yet.">{text}</Markdown>
          </div>
        )}
      </div>
    </Dialog>
  );
}

const list = (stages: StageInfo[]) => {
  const names = stages.map((s) => s.title);
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
};
