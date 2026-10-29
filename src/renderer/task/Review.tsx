import { useCallback, useEffect, useState } from 'react';
import { CircleCheck, Copy, FileDiff, GitBranch, Upload } from 'lucide-react';
import type { TaskDiff, TaskMetrics } from '@shared/metrics';
import type { TaskDetail } from '@shared/tasks';
import { Button, ConfirmDialog, EmptyState, Skeleton, Textarea, useToast } from '../ui';
import { closeTask, errorMessage } from '../actions';
import t from './task.module.css';

function useRefetch<T>(taskId: number, load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const refresh = useCallback(() => void load().then(setData, () => {}), [load]);
  useEffect(() => {
    refresh();
    return window.api.on('task:changed', (e) => e.taskId === taskId && refresh());
  }, [taskId, refresh]);
  return data;
}

/** Diff sub-tab: commits and files on the left, the unified diff on the right; the Ship panel once every stage is approved. */
export function DiffTab({ task }: { task: TaskDetail }) {
  const [sha, setSha] = useState<string | undefined>();
  const load = useCallback(() => window.api.invoke['review:diff']({ taskId: task.id, sha }), [task.id, sha]);
  const diff = useRefetch<TaskDiff>(task.id, load);
  const shipping = task.status === 'ready_to_ship' || task.status === 'pushed';

  return (
    <div className={t.review}>
      {shipping && <ShipPanel task={task} />}
      {!diff ? (
        <div className={t.viewerPad}>
          <Skeleton height={200} />
        </div>
      ) : !diff.commits.length && !sha ? (
        <EmptyState icon={FileDiff} title="No changes yet" hint={`Commits on ${task.branch} since it branched show up here for review.`} />
      ) : (
        <div className={t.reviewBody}>
          <aside className={t.reviewSide}>
            <div className={t.paneTitle}>Commits</div>
            <button type="button" className={t.treeItem} data-selected={!sha || undefined} onClick={() => setSha(undefined)}>
              All changes ({diff.commits.length})
            </button>
            {diff.commits.map((c) => (
              <button key={c.sha} type="button" className={t.treeItem} data-selected={sha === c.sha || undefined} onClick={() => setSha(c.sha)} title={c.subject}>
                <span className="mono">{c.sha}</span> <span className={t.treeName}>{c.subject}</span>
              </button>
            ))}
            <div className={t.paneTitle} style={{ marginTop: 12 }}>
              Files
            </div>
            {diff.files.map((f) => (
              <a key={f.path} className={t.treeItem} href={`#diff-${f.path}`} title={f.path}>
                <span className={t.treeName}>{f.path}</span>
                <span className={t.plus}>+{f.added}</span>
                <span className={t.minus}>−{f.removed}</span>
              </a>
            ))}
          </aside>
          <pre className={t.diff}>
            {diff.patch.split('\n').map((l, i) => {
              const kind = l.startsWith('diff --git') ? 'file' : l.startsWith('@@') ? 'hunk' : l.startsWith('+') && !l.startsWith('+++') ? 'add' : l.startsWith('-') && !l.startsWith('---') ? 'del' : undefined;
              const id = kind === 'file' ? `diff-${l.split(' b/')[1] ?? ''}` : undefined;
              return (
                <div key={i} id={id} data-kind={kind}>
                  {l || ' '}
                </div>
              );
            })}
          </pre>
        </div>
      )}
    </div>
  );
}

function ShipPanel({ task }: { task: TaskDetail }) {
  const toast = useToast();
  const [text, setText] = useState<string | null>(null);
  const [output, setOutput] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'force' | 'done' | null>(null);

  useEffect(() => {
    void window.api.invoke['ship:pr']({ taskId: task.id }).then(setText);
  }, [task.id]);

  const save = () => text !== null && void window.api.invoke['ship:savePr']({ taskId: task.id, text });
  const copy = (value: string, what: string) => void navigator.clipboard.writeText(value).then(() => toast({ tone: 'success', title: `${what} copied` }));
  const push = async (force: boolean) => {
    setBusy(true);
    try {
      const r = await window.api.invoke['ship:push']({ taskId: task.id, force });
      setOutput(r.output);
      toast(r.ok ? { tone: 'success', title: `Pushed ${task.branch}`, description: 'Open your PR in the forge and paste the description.' } : { tone: 'error', title: 'Push failed', description: 'See the output below.' });
    } catch (e) {
      toast({ tone: 'error', title: 'Push failed', description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={t.ship} aria-label="Ship">
      <div className={t.shipHead}>
        <strong>{task.status === 'pushed' ? 'Pushed · open your PR' : 'Ready to ship'}</strong>
        <span className={t.spacer} />
        <Button size="sm" icon={GitBranch} onClick={() => copy(task.branch, 'Branch name')}>
          Copy branch name
        </Button>
        <Button size="sm" icon={Copy} disabled={text === null} onClick={() => text !== null && (save(), copy(text, 'PR description'))}>
          Copy PR description
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm('force')}>
          Force push…
        </Button>
        <Button size="sm" icon={Upload} loading={busy} onClick={() => void push(false)}>
          Push branch
        </Button>
        <Button size="sm" variant="primary" icon={CircleCheck} onClick={() => setConfirm('done')}>
          Mark done
        </Button>
      </div>
      {text === null ? (
        <Skeleton height={120} />
      ) : (
        <Textarea className={t.shipInput} aria-label="PR description (pr.md)" value={text} onChange={(e) => setText(e.target.value)} onBlur={save} />
      )}
      {output && <pre className={t.shipOutput}>{output}</pre>}
      <ConfirmDialog
        open={confirm === 'force'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Force push ${task.branch}?`}
        consequence="Runs git push --force-with-lease. It overwrites the remote branch if nobody else pushed to it since you last fetched."
        confirmLabel="Force push"
        danger
        onConfirm={() => push(true)}
      />
      <ConfirmDialog
        open={confirm === 'done'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Mark ${task.issueKey} done?`}
        consequence="The worktree is removed (git refuses if it has uncommitted changes). The branch, task folder, transcripts and metrics stay, and manifest.json is written. Merge the PR yourself; YANTRA never merges."
        confirmLabel="Mark done"
        onConfirm={async () => {
          try {
            await window.api.invoke['tasks:finish']({ id: task.id });
            toast({ tone: 'success', title: `${task.issueKey} done` });
            closeTask(task.id);
          } catch (e) {
            toast({ tone: 'error', title: 'Could not mark it done', description: errorMessage(e) });
          }
        }}
      />
    </section>
  );
}

export const minutes = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : ms < 3_600_000 ? `${Math.round(ms / 60_000)}m` : `${(ms / 3_600_000).toFixed(1)}h`);
export const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
export const dollars = (n: number) => `$${n.toFixed(2)}`;

/** Metrics sub-tab: one row per stage, then the task's three clocks. */
export function MetricsTab({ task }: { task: TaskDetail }) {
  const load = useCallback(() => window.api.invoke['metrics:task']({ taskId: task.id }), [task.id]);
  const m = useRefetch<TaskMetrics>(task.id, load);
  if (!m) return <Skeleton height={160} style={{ margin: 20 }} />;
  return (
    <div className={t.metrics}>
      <div className={t.clocks}>
        <span>Agent active {minutes(m.activeMs)}</span>
        <span>Waiting on you {minutes(m.waitingMs)}</span>
        <span>Wall clock {minutes(m.wallMs)}</span>
        <span>
          {tokens(m.tokens.input + m.tokens.output + m.tokens.cacheRead + m.tokens.cacheWrite)} tokens · est. {dollars(m.tokens.cost)}
        </span>
      </div>
      <table className={t.metricsTable}>
        <thead>
          <tr>
            <th>Stage</th>
            <th>Rounds</th>
            <th>Active</th>
            <th>Waiting</th>
            <th>In</th>
            <th>Out</th>
            <th>Cache r/w</th>
            <th>Est. cost</th>
            <th>Tools</th>
            <th>Blocked</th>
          </tr>
        </thead>
        <tbody>
          {m.stages.map((s) => (
            <tr key={s.key}>
              <td>{s.title}</td>
              <td>{s.rounds}</td>
              <td>{minutes(s.activeMs)}</td>
              <td>{minutes(s.waitingMs)}</td>
              <td>{tokens(s.tokens.input)}</td>
              <td>{tokens(s.tokens.output)}</td>
              <td>
                {tokens(s.tokens.cacheRead)} / {tokens(s.tokens.cacheWrite)}
              </td>
              <td>{dollars(s.tokens.cost)}</td>
              <td>{s.toolCalls}</td>
              <td>{s.blocked}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {m.transcripts.length > 0 && (
        <div className={t.transcripts}>
          Transcripts:{' '}
          {m.transcripts.map((p) => (
            <button key={p} type="button" className={`${t.linkButton} mono`} onClick={() => void window.api.invoke['shell:openPath']({ path: p })}>
              {p.split(/[\\/]/).pop()}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
