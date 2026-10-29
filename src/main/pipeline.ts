// The pipeline (SPEC "State machine"): reads a task's machine state from the database, runs an
// action through the reducer, and carries out its effects. Sessions end first, then the new
// state is saved, then files and the task-folder repo, then the next stage is queued.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { TaskStatus } from '@shared/board';
import type { LaunchResult } from '@shared/sessions';
import type { PipelineAction, Template } from '@shared/tasks';
import type { StageStatus } from '@shared/types';
import type { ProjectLookup } from './board';
import type { Db } from './db/db';
import { reduce, type Action, type StageState, type TaskState } from './machine';
import type { Sessions } from './sessions';
import { commitTaskRepo } from './taskfs';
import { parseTemplate } from './templates';

export interface PipelineEnv {
  db: Db;
  lookup: ProjectLookup;
  sessions: Pick<Sessions, 'liveRunOf' | 'stopAndWait' | 'enqueue'>;
  changed(taskId: number): void;
}

interface StageRow {
  id: number;
  stage_key: string;
  status: StageStatus;
  round: number;
  session_id: string | null;
  approved_hash: string | null;
  approved_at: number | null;
}
interface Loaded {
  state: TaskState;
  rows: StageRow[];
  template: Template;
  taskDir: string;
}

/** sha256 of a task-folder file, or null when it's missing. */
export function fileHash(taskDir: string, rel: string): string | null {
  const file = join(taskDir, rel);
  if (!existsSync(file)) return null;
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** The machine state of a task. `liveRun` says which stages have a PTY up. */
export function loadState(db: Db, lookup: ProjectLookup, taskId: number, liveRun: (stageId: number) => number | null): Loaded {
  const task = db.prepare('SELECT status, template_yaml, project_slug, task_dir FROM task WHERE id = ?').get(taskId) as
    | { status: TaskStatus; template_yaml: string; project_slug: string; task_dir: string }
    | undefined;
  if (!task) throw new Error('That task no longer exists');
  const template = parseTemplate(task.template_yaml);
  let projectPre: string[] | undefined;
  try {
    projectPre = lookup(task.project_slug).pre;
  } catch {
    // The project left YANTRA; the task's history still opens.
  }
  const rows = db
    .prepare('SELECT id, stage_key, status, round, session_id, approved_hash, approved_at FROM stage WHERE task_id = ? ORDER BY position')
    .all(taskId) as StageRow[];
  const started = db.prepare("SELECT 1 FROM event e JOIN run r ON r.id = e.run_id WHERE r.session_id = ? AND e.hook = 'SessionStart' LIMIT 1");
  const stages = rows.map(
    (r): StageState => ({
      key: r.stage_key,
      status: r.status,
      round: r.round,
      hasSession: r.session_id !== null && !!started.get(r.session_id),
      live: liveRun(r.id) !== null,
      hasChecks: (projectPre ?? template.stages.find((s) => s.key === r.stage_key)?.pre ?? []).length > 0,
      approvedHash: r.approved_hash,
    }),
  );
  return { state: { status: task.status, stages }, rows, template, taskDir: task.task_dir };
}

/** Approve, Request changes, Send back or Skip. Returns the next stage's launch result. */
export async function act(env: PipelineEnv, taskId: number, req: PipelineAction): Promise<LaunchResult> {
  const { db } = env;
  const { state, rows, template, taskDir } = loadState(db, env.lookup, taskId, (id) => env.sessions.liveRunOf(id));
  const titleOf = (key: string) => template.stages.find((s) => s.key === key)?.title ?? key;
  const idOf = (key: string) => rows.find((r) => r.stage_key === key)!.id;

  let action: Action;
  if (req.type === 'approve') {
    const st = template.stages.find((s) => s.key === req.stageKey);
    const hash = st && fileHash(taskDir, st.produces);
    if (st && !hash) throw new Error(`${st.produces} is missing, so there's nothing to approve`);
    action = { ...req, artifactHash: hash ?? '' };
  } else action = req;
  const { task: next, effects } = reduce(state, action);

  // 1. End sessions first, so their exit bookkeeping can't overwrite the statuses saved below.
  for (const e of effects) if (e.kind === 'kill') await env.sessions.stopAndWait(idOf(e.stageKey));

  // 2. The new state.
  const now = Date.now();
  db.transaction(() => {
    db.prepare('UPDATE task SET status = ? WHERE id = ?').run(next.status, taskId);
    const update = db.prepare(
      `UPDATE stage SET status = ?, round = ?, approved_hash = ?, approved_at = ?, session_id = ?,
         awaiting_since = CASE WHEN ? = 'awaiting_approval' THEN awaiting_since ELSE NULL END
       WHERE id = ?`,
    );
    next.stages.forEach((s, i) => {
      const row = rows[i]!;
      const approvedAt = s.approvedHash === null ? null : s.approvedHash === row.approved_hash ? row.approved_at : now;
      update.run(s.status, s.round, s.approvedHash, approvedAt, s.hasSession ? row.session_id : null, s.status, row.id);
    });
  })();

  // 3. Files, and one commit in the task-folder repo for the history.
  const notes: string[] = [];
  for (const e of effects) {
    if (e.kind === 'writeFeedback') {
      const file = join(taskDir, 'feedback', `${e.stageKey}-round-${e.round}.md`);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `# Feedback for ${titleOf(e.stageKey)}, round ${e.round}\n\n${e.text.trim()}\n`);
      notes.push(`Feedback for ${titleOf(e.stageKey)}, round ${e.round}`);
    } else if (e.kind === 'snapshotArtifact') {
      const s = next.stages.find((x) => x.key === e.stageKey)!;
      notes.push(`Approve ${titleOf(e.stageKey)} (round ${s.round})`);
    }
  }
  if (req.type === 'skip') notes.push(`Skip ${titleOf(req.stageKey)}`);
  if (req.type === 'sendBack') notes.unshift(`Send back to ${titleOf(req.toStageKey)}`);
  try {
    await commitTaskRepo(taskDir, notes.join('\n\n') || req.type);
  } catch (e) {
    console.error('Could not commit the task folder', e);
  }
  env.changed(taskId);

  // 4. The next stage.
  let result: LaunchResult = { ok: true };
  for (const e of effects) if (e.kind === 'spawn') result = await env.sessions.enqueue(idOf(e.stageKey), e.feedbackFile ? { feedbackFile: e.feedbackFile } : {});
  return result;
}
