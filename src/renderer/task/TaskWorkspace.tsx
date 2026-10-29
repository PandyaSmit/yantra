import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChartColumn,
  Clock,
  Copy,
  FileDiff,
  FolderOpen,
  FolderTree,
  GitBranch,
  LoaderCircle,
  MoreHorizontal,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldQuestion,
  Square,
  SquareTerminal,
  TriangleAlert,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { LaunchResult } from '@shared/sessions';
import type { StageInfo, TaskDetail } from '@shared/tasks';
import type { PreflightResult } from '@shared/types';
import { Button, ConfirmDialog, EmptyState, IconButton, Menu, MenuItem, MenuSeparator, Skeleton, StatusIcon, Tabs, Tag, Tooltip, useToast } from '../ui';
import { closeTask, errorMessage, navigate, updateOpenTask } from '../actions';
import { StartTaskDialog, type StartTarget } from '../board/StartTaskDialog';
import { store, useStore, type TaskTab } from '../store';
import { Files } from './Files';
import { StageRail } from './StageRail';
import { TerminalTab } from './Terminal';
import { useTask } from './useTask';
import t from './task.module.css';

export const TASK_TAB_KEYS: Record<string, TaskTab> = { '1': 'terminal', '2': 'files', '3': 'diff', '4': 'metrics' };

const STATUS_TAG: Record<TaskDetail['status'], { label: string; tone: 'neutral' | 'accent' | 'ok' | 'danger' }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  active: { label: 'Active', tone: 'accent' },
  ready_to_ship: { label: 'Ready to ship', tone: 'accent' },
  pushed: { label: 'Pushed', tone: 'ok' },
  done: { label: 'Done', tone: 'ok' },
  abandoned: { label: 'Abandoned', tone: 'danger' },
};

export function TaskWorkspace() {
  const id = useStore((s) => s.route.task);
  if (id === undefined) return null;
  return <Workspace key={id} id={id} />;
}

function Workspace({ id }: { id: number }) {
  const toast = useToast();
  const { task, error } = useTask(id);
  const tab = useStore((s) => s.route.taskTab ?? 'files');
  const [abandoning, setAbandoning] = useState(false);
  const [finishing, setFinishing] = useState<StartTarget | null>(null);
  const [stopping, setStopping] = useState(false);
  const [launching, setLaunching] = useState(false);
  /** The failed pre-flight from the last launch attempt, and what to retry once it passes. */
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const retry = useRef<(() => Promise<LaunchResult>) | null>(null);

  useEffect(() => {
    if (task) updateOpenTask({ id: task.id, key: task.issueKey, title: task.title, projectSlug: task.projectSlug });
  }, [task]);

  if (error && !task)
    return (
      <div className={t.workspace}>
        <EmptyState
          icon={TriangleAlert}
          title="This task can't be opened"
          hint={error}
          action={
            <Button icon={X} onClick={() => closeTask(id)}>
              Close tab
            </Button>
          }
        />
      </div>
    );
  if (!task)
    return (
      <div className={t.workspace}>
        <div className={t.header}>
          <Skeleton width={260} height={20} />
          <Skeleton width={360} />
          <Skeleton height={44} style={{ marginTop: 12 }} />
        </div>
      </div>
    );

  const call = async (fn: () => Promise<unknown>, failTitle: string, okTitle?: string) => {
    try {
      await fn();
      if (okTitle) toast({ tone: 'success', title: okTitle });
    } catch (e) {
      toast({ tone: 'error', title: failTitle, description: errorMessage(e) });
    }
  };
  const copyBranch = () => void call(() => navigator.clipboard.writeText(task.branch), 'Could not copy', 'Branch name copied');
  const setupUnfinished = task.setupDoneAt === null && task.status === 'draft';
  const closed = task.status === 'abandoned' || task.status === 'done';
  const current = task.stages.find((s) => s.status !== 'approved' && s.status !== 'skipped');
  const trustExit = !!current && current.status === 'pending' && current.lastRun?.exitNote === 'trust_prompt';

  /** Launch something; a failed pre-flight shows the banner instead of a toast. */
  const launch = async (fn: () => Promise<LaunchResult>) => {
    setLaunching(true);
    try {
      const r = await fn();
      if (r.ok) {
        setPreflight(null);
        retry.current = null;
        navigate({ taskTab: 'terminal' });
      } else {
        setPreflight(r.preflight);
        retry.current = fn;
      }
    } catch (e) {
      toast({ tone: 'error', title: 'Could not launch the stage', description: errorMessage(e) });
    } finally {
      setLaunching(false);
    }
  };
  const checkAgain = async () => {
    const r = await window.api.invoke['preflight:run']({});
    store.set({ preflight: r });
    if (!r.ok) return setPreflight(r);
    setPreflight(null);
    if (retry.current) await launch(retry.current);
  };

  const action = ((): { label: string; icon: LucideIcon; run?: () => void; disabled?: boolean; hint: string; secondary?: boolean } | null => {
    if (closed || !current) return null;
    if (task.status === 'draft')
      return {
        label: 'Start',
        icon: Play,
        disabled: task.creating || setupUnfinished,
        hint: setupUnfinished ? 'Finish setup first' : `Launch ${current.title}. Write brief.md first; the stage reads it.`,
        run: () => void launch(() => window.api.invoke['sessions:start']({ taskId: task.id })),
      };
    const launchIt = () => void launch(() => window.api.invoke['sessions:launch']({ stageId: current.id }));
    if (current.status === 'interrupted') return { label: 'Resume', icon: RotateCcw, run: launchIt, hint: `Continue the same ${current.title} conversation` };
    if (current.status === 'pending') return { label: `Launch ${current.title}`, icon: Play, run: launchIt, hint: `Start the ${current.title} stage` };
    if (current.status === 'queued') return { label: 'Queued', icon: Clock, disabled: true, hint: 'Starts when a session slot frees' };
    if (current.status === 'awaiting_approval' && current.liveRunId === null)
      return { label: 'Reopen session', icon: SquareTerminal, run: launchIt, secondary: true, hint: 'Resume the conversation; Approve arrives with the pipeline (Phase 5)' };
    return null;
  })();

  const abandon = async (force = false) => {
    try {
      await window.api.invoke['tasks:abandon']({ id: task.id, force });
      toast({ tone: 'success', title: `${task.issueKey} draft abandoned`, description: 'The issue is back in Todo. Branch and task folder are kept.' });
      closeTask(task.id);
    } catch (e) {
      const message = errorMessage(e);
      const dirty = /modified or untracked|contains modified|untracked files/i.test(message);
      toast({
        tone: 'error',
        title: 'Could not abandon the draft',
        description: dirty ? 'The worktree has changes git would lose.' : message,
        ...(dirty ? { action: { label: 'Remove anyway', onClick: () => void abandon(true) } } : {}),
      });
    }
  };

  return (
    <div className={t.workspace}>
      <div className={t.header}>
        <div className={t.titleRow}>
          <IconButton icon={ArrowLeft} label="Back to board" shortcut={['G', 'B']} onClick={() => navigate({ view: 'board', project: task.projectSlug })} />
          <span className={`${t.key} mono`}>{task.issueKey}</span>
          <h1 className={t.title}>{task.title}</h1>
          <div className={t.headerActions}>
            {action && (
              <Tooltip content={action.hint}>
                <span>
                  <Button variant={action.secondary ? 'secondary' : 'primary'} icon={action.icon} disabled={action.disabled || launching} onClick={action.run}>
                    {action.label}
                  </Button>
                </span>
              </Tooltip>
            )}
            <Menu trigger={<IconButton icon={MoreHorizontal} label="Task actions" />}>
              {current && (current.liveRunId !== null || current.status === 'queued') && (
                <>
                  <MenuItem icon={Square} onSelect={() => setStopping(true)}>
                    {current.status === 'queued' ? 'Leave the queue' : current.status === 'running' ? 'Stop session…' : 'End session…'}
                  </MenuItem>
                  <MenuSeparator />
                </>
              )}
              <MenuItem icon={Copy} onSelect={copyBranch}>
                Copy branch name
              </MenuItem>
              <MenuItem icon={FolderOpen} onSelect={() => void call(() => window.api.invoke['tasks:reveal']({ id: task.id, what: 'folder' }), 'Could not open the folder')}>
                Open task folder
              </MenuItem>
              <MenuItem
                icon={FolderTree}
                disabled={closed}
                onSelect={() => void call(() => window.api.invoke['tasks:reveal']({ id: task.id, what: 'worktree' }), 'Could not open the worktree')}
              >
                Open worktree
              </MenuItem>
              <MenuItem
                icon={RefreshCw}
                onSelect={() => void call(() => window.api.invoke['tasks:refreshIssue']({ id: task.id }), 'Could not refresh issue.md', 'issue.md refreshed from the board')}
              >
                Refresh issue.md from board
              </MenuItem>
              {task.status === 'draft' && (
                <>
                  <MenuSeparator />
                  <MenuItem icon={X} danger disabled={task.creating} onSelect={() => setAbandoning(true)}>
                    Abandon draft…
                  </MenuItem>
                </>
              )}
            </Menu>
          </div>
        </div>
        <div className={t.meta}>
          <span>{task.template}</span>
          <span className={t.sep}>·</span>
          <Tag tone={STATUS_TAG[task.status].tone}>{STATUS_TAG[task.status].label}</Tag>
          {task.behind !== null && (
            <>
              <span className={t.sep}>·</span>
              <span>{task.behind === 0 ? `Up to date with ${task.defaultBranch}` : `${task.behind} behind ${task.defaultBranch}`}</span>
            </>
          )}
          <span className={t.sep}>·</span>
          <button type="button" className={`${t.branch} mono`} onClick={copyBranch} title="Copy branch name">
            <GitBranch size={12} aria-hidden />
            {task.branch}
          </button>
        </div>

        {task.creating ? (
          <div className={t.banner} data-tone="info">
            <LoaderCircle size={16} className={t.spin} />
            <span>Setting up the folder, worktree and setup commands…</span>
          </div>
        ) : setupUnfinished ? (
          <div className={t.banner} data-tone="warn">
            <TriangleAlert size={16} />
            <span>Setup didn't finish, so the worktree may be missing or half set up.</span>
            <Button size="sm" onClick={() => setFinishing(cardFor(task))}>
              Finish setup
            </Button>
          </div>
        ) : null}
        {preflight && !preflight.ok && (
          <div className={t.banner} data-tone="danger">
            <TriangleAlert size={16} />
            <span className={t.bannerText}>
              <strong>Claude needs setup before a stage can run</strong>
              <span>
                {[preflight.binary, preflight.auth, preflight.onboarding].find((c) => !c.ok)?.detail}. Open a terminal, run <code className="mono">claude</code> once, pick a theme
                and log in.
              </span>
            </span>
            <Button size="sm" icon={RefreshCw} disabled={launching} onClick={() => void checkAgain()}>
              Check again
            </Button>
          </div>
        )}
        {trustExit && (
          <div className={t.banner} data-tone="danger">
            <ShieldQuestion size={16} />
            <span className={t.bannerText}>
              <strong>Claude exited at the trust prompt</strong>
              <span>Its default answer is "No, exit". Retry and choose "Yes, I trust this folder", or turn on "Trust new worktrees automatically" in Settings.</span>
            </span>
            <Button size="sm" icon={RotateCcw} disabled={launching} onClick={() => void launch(() => window.api.invoke['sessions:launch']({ stageId: current!.id }))}>
              Retry
            </Button>
          </div>
        )}

        <StageRail stages={task.stages} />
        {current && statusLine(current) && (
          <div className={t.status}>
            <StatusIcon status={current.status} size={14} />
            <span className={t.statusText}>{statusLine(current)}</span>
          </div>
        )}
      </div>

      <div className={t.subtabs}>
        <Tabs
          label="Task views"
          value={tab}
          onChange={(v) => navigate({ taskTab: v })}
          items={[
            { value: 'terminal', label: 'Terminal', icon: SquareTerminal },
            { value: 'files', label: 'Files', icon: FolderTree },
            { value: 'diff', label: 'Diff', icon: FileDiff },
            { value: 'metrics', label: 'Metrics', icon: ChartColumn },
          ]}
        />
      </div>

      <div className={t.body}>
        {tab === 'files' ? (
          <Files task={task} />
        ) : tab === 'terminal' ? (
          <TerminalTab task={task} />
        ) : tab === 'diff' ? (
          <EmptyState icon={FileDiff} title="No changes yet" hint={`Commits on ${task.branch} since it branched show up here for review.`} />
        ) : (
          <EmptyState icon={ChartColumn} title="No metrics yet" hint="Tokens, agent time and waiting-on-you time per stage, once stages run." />
        )}
      </div>

      <ConfirmDialog
        open={abandoning}
        onOpenChange={setAbandoning}
        title={`Abandon the ${task.issueKey} draft?`}
        consequence="The worktree is removed (git refuses if it has changes). The branch and task folder stay as history, and the issue goes back to Todo."
        confirmLabel="Abandon draft"
        danger
        onConfirm={() => abandon()}
      />
      {current && (
        <ConfirmDialog
          open={stopping}
          onOpenChange={setStopping}
          title={current.status === 'queued' ? `Take ${current.title} out of the queue?` : `${current.status === 'running' ? 'Stop' : 'End'} the ${current.title} session?`}
          consequence={
            current.status === 'queued'
              ? "It won't start when a slot frees. You can launch it again later."
              : 'Claude is asked to exit (and to stop any background work), and is closed after 5 seconds if it doesn\'t. Nothing is lost: Resume continues the same conversation.'
          }
          confirmLabel={current.status === 'queued' ? 'Leave the queue' : current.status === 'running' ? 'Stop session' : 'End session'}
          danger={current.status === 'running'}
          onConfirm={() => call(() => window.api.invoke['sessions:stop']({ stageId: current.id }), 'Could not stop the session')}
        />
      )}
      <StartTaskDialog card={finishing} resume onClose={() => setFinishing(null)} />
    </div>
  );
}

/** One line under the rail about the current stage. */
function statusLine(s: StageInfo): string | null {
  const last = s.lastMessage?.split('\n').find((l) => l.trim())?.trim();
  const tail = last ? ` · “${last.length > 140 ? `${last.slice(0, 140)}…` : last}”` : '';
  switch (s.status) {
    case 'queued':
      return `${s.title} is queued and starts when a session slot frees`;
    case 'running':
      return `${s.title} is running`; // the last message is from the previous turn; the terminal is live
    case 'idle':
      return `${s.title} is waiting for your next message in the terminal${tail}`;
    case 'awaiting_approval':
      return `${s.title} is ready for you${tail}`;
    case 'interrupted':
      if (s.lastRun?.exitNote === 'stopped') return `${s.title} was stopped. Resume continues the same conversation.`;
      return `${s.title} was interrupted (the app quit or the session closed). Resume continues the same conversation.`;
    default:
      return null;
  }
}

const cardFor = (task: TaskDetail): StartTarget => ({ id: task.issueId, projectSlug: task.projectSlug, key: task.issueKey, title: task.title });
