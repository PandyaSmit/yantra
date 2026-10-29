import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Circle, CircleAlert, FolderGit2, GitBranch, LoaderCircle, SkipForward, TerminalSquare } from 'lucide-react';
import type { Card } from '@shared/board';
import { taskBranch } from '@shared/naming';
import { CREATION_STEP_LABEL, CREATION_STEPS, type TaskDetail, type TemplateError, type TemplateInfo } from '@shared/tasks';
import { Button, Dialog, Skeleton, useToast } from '../ui';
import { errorMessage, openTask } from '../actions';
import { useStore } from '../store';
import { useCreationProgress, type StepState } from '../task/useTask';
import b from './board.module.css';

type Phase = 'choose' | 'creating' | 'failed';

/** The issue a task is being started on. */
export type StartTarget = Pick<Card, 'id' | 'key' | 'title' | 'projectSlug'>;

/**
 * Opened by dropping a task-less card on In Progress, by "Start task" in the drawer, or by
 * "Finish setup" on a draft whose setup failed (`resume`). Picks a template, then shows the
 * creation checklist with the live setup log. Cancelling before starting puts a dragged card back.
 */
export function StartTaskDialog({ card, resume, onClose }: { card: StartTarget | null; resume?: boolean; onClose: () => void }) {
  const toast = useToast();
  const project = useStore((s) => s.config?.projects.find((p) => p.slug === card?.projectSlug));
  const defaultTemplate = useStore((s) => s.config?.defaultTemplate);
  const [templates, setTemplates] = useState<TemplateInfo[] | null>(null);
  const [errors, setErrors] = useState<TemplateError[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('choose');
  const [failure, setFailure] = useState<string | null>(null);
  const { steps, log, reset } = useCreationProgress(card?.id ?? null);
  const open = useRef(false);
  open.current = !!card;

  useEffect(() => {
    if (!card) return;
    setPhase('choose');
    setFailure(null);
    reset();
    void window.api.invoke['templates:list']().then(({ templates: ts, errors: es }) => {
      setTemplates(ts);
      setErrors(es);
      setChosen((ts.find((t) => t.name === defaultTemplate) ?? ts[0])?.name ?? null);
    });
    if (resume) void start(); // finishing setup needs no template choice
  }, [card?.id]); // once per opening

  const done = (task: TaskDetail) => {
    const tab = { id: task.id, key: task.issueKey, title: task.title, projectSlug: task.projectSlug };
    if (open.current) {
      onClose();
      openTask(tab, { tab: 'files', file: 'brief.md' });
    }
    toast({
      tone: 'success',
      title: `${task.issueKey} is ready`,
      description: 'Fill in brief.md and add resources, then start the first stage.',
      ...(open.current ? {} : { action: { label: 'Open task', onClick: () => openTask(tab, { tab: 'files', file: 'brief.md' }) } }),
    });
  };

  async function start() {
    if (!card) return;
    setPhase('creating');
    setFailure(null);
    reset();
    try {
      done(await window.api.invoke['tasks:create']({ issueId: card.id, template: chosen ?? defaultTemplate ?? 'standard' }));
    } catch (e) {
      const message = errorMessage(e);
      if (open.current) {
        setPhase('failed');
        setFailure(message);
      } else toast({ tone: 'error', title: `Setting up ${card.key} failed`, description: message });
    }
  }

  const creating = phase === 'creating';
  const branch = card ? taskBranch(card.key, card.title) : '';
  const from = project ? (project.remote ? `${project.remote}/${project.defaultBranch}` : project.defaultBranch) : '';
  const setupCount = project?.worktreeSetup.length ?? 0;

  return (
    <Dialog
      open={!!card}
      onOpenChange={(o) => !o && onClose()}
      wide
      title={card ? (resume ? `Finish setting up ${card.key}` : `Start a task for ${card.key}`) : 'Start task'}
      description={card?.title}
      footer={
        phase === 'choose' ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" icon={ArrowRight} disabled={!chosen} onClick={() => void start()} data-autofocus>
              Create task
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              {creating ? 'Hide (keeps going)' : 'Close'}
            </Button>
            {phase === 'failed' && (
              <Button variant="primary" onClick={() => void start()} data-autofocus>
                Retry
              </Button>
            )}
          </>
        )
      }
    >
      {phase === 'choose' ? (
        <>
          <div className={b.templates} role="radiogroup" aria-label="Template">
            {templates === null ? (
              <>
                <Skeleton height={64} />
                <Skeleton height={64} />
              </>
            ) : templates.length === 0 ? (
              <div className={b.startNote}>
                <CircleAlert size={16} />
                <div>No templates found. Add a YAML file to the templates folder.</div>
              </div>
            ) : (
              templates.map((t) => (
                <button
                  key={t.name}
                  type="button"
                  role="radio"
                  aria-checked={chosen === t.name}
                  className={b.template}
                  onClick={() => setChosen(t.name)}
                  onDoubleClick={() => void start()}
                >
                  <span className={b.templateRadio} aria-hidden />
                  <span className={b.templateText}>
                    <span className={b.templateName}>
                      {t.name}
                      {t.name === defaultTemplate && <span className={b.templateDefault}>default</span>}
                    </span>
                    <span className={b.templateDesc}>{t.description}</span>
                    <span className={b.templateStages}>
                      {t.stages.map((s, i) => (
                        <span key={s.key}>
                          {i > 0 && <ArrowRight size={11} aria-hidden />}
                          {s.title}
                        </span>
                      ))}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
          {errors.map((e) => (
            <div key={e.file} className={b.templateError}>
              <CircleAlert size={14} /> <span className="mono">{e.file}</span> was skipped: {e.message}
            </div>
          ))}
          <ul className={b.startList}>
            <li>
              <GitBranch size={16} />
              <span>
                Branch <span className="mono">{branch}</span> from <span className="mono">{from}</span>, in its own worktree
              </span>
            </li>
            <li>
              <FolderGit2 size={16} /> A task folder with the issue snapshot, a brief from the description, and the attachments
            </li>
            <li>
              <TerminalSquare size={16} />
              {setupCount ? `${setupCount} setup command${setupCount === 1 ? '' : 's'} in the worktree` : 'No setup commands (set them in project settings)'}
            </li>
          </ul>
          <div className={b.hint}>Nothing runs yet: the task starts as a draft, so you can write the brief first.</div>
        </>
      ) : (
        <>
          <ol className={b.checklist}>
            {CREATION_STEPS.map((step) => {
              const s = steps[step] ?? { state: 'pending' as StepState };
              return (
                <li key={step} className={b.checkStep} data-state={s.state}>
                  <StepIcon state={s.state} />
                  <div className={b.checkText}>
                    <div>{CREATION_STEP_LABEL[step]}</div>
                    {s.detail && <div className={b.checkDetail}>{s.detail}</div>}
                    {s.state === 'skipped' && <div className={b.checkDetail}>Nothing to run</div>}
                  </div>
                </li>
              );
            })}
          </ol>
          {log && <SetupLog text={log} />}
          {failure && (
            <div className={b.startError} role="alert">
              <CircleAlert size={16} />
              <div>
                <div>{failure}</div>
                <div className={b.hint}>The task stays as a draft. Fix the cause and retry; finished steps are not repeated.</div>
              </div>
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}

function StepIcon({ state }: { state: StepState }) {
  if (state === 'running') return <LoaderCircle size={16} className={b.spin} aria-label="Running" />;
  if (state === 'done') return <Check size={16} color="var(--ok)" aria-label="Done" />;
  if (state === 'skipped') return <SkipForward size={16} color="var(--text-faint)" aria-label="Skipped" />;
  if (state === 'failed') return <CircleAlert size={16} color="var(--danger)" aria-label="Failed" />;
  return <Circle size={16} color="var(--text-faint)" aria-label="Waiting" />;
}

/** Setup output, pinned to the bottom while it streams unless I scroll up. */
export function SetupLog({ text }: { text: string }) {
  const ref = useRef<HTMLPreElement>(null);
  const pinned = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [text]);
  return (
    <pre
      ref={ref}
      className={b.setupLog}
      aria-label="Setup output"
      tabIndex={0}
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
    >
      {text}
    </pre>
  );
}
