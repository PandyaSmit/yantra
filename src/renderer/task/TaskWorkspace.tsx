import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ChartColumn,
  Copy,
  FileDiff,
  FolderOpen,
  FolderTree,
  GitBranch,
  LoaderCircle,
  MoreHorizontal,
  Play,
  RefreshCw,
  SquareTerminal,
  TriangleAlert,
  X,
} from 'lucide-react';
import type { TaskDetail } from '@shared/tasks';
import { Button, ConfirmDialog, EmptyState, IconButton, Menu, MenuItem, MenuSeparator, Skeleton, Tabs, Tag, Tooltip, useToast } from '../ui';
import { closeTask, errorMessage, navigate, updateOpenTask } from '../actions';
import { StartTaskDialog, type StartTarget } from '../board/StartTaskDialog';
import { useStore, type TaskTab } from '../store';
import { Files } from './Files';
import { StageRail } from './StageRail';
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
            <Tooltip content={task.status === 'draft' ? 'Running stages arrives with sessions (Phase 4). Write the brief first.' : 'Not available yet'}>
              <span>
                <Button variant="primary" icon={Play} disabled>
                  Start
                </Button>
              </span>
            </Tooltip>
            <Menu trigger={<IconButton icon={MoreHorizontal} label="Task actions" />}>
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

        <StageRail stages={task.stages} />
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
          <EmptyState icon={SquareTerminal} title="No session yet" hint="When a stage runs, its Claude session appears here and you can type into it." />
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
      <StartTaskDialog card={finishing} resume onClose={() => setFinishing(null)} />
    </div>
  );
}

const cardFor = (task: TaskDetail): StartTarget => ({ id: task.issueId, projectSlug: task.projectSlug, key: task.issueKey, title: task.title });
