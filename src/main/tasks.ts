// Task creation (SPEC "Task creation flow"): row + stages, task folder, worktree + branch, setup
// commands. Every step is idempotent, so a half-failed start is finished by starting again, and
// starting a task that is already set up is a no-op.
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execa } from 'execa';
import { positionBetween, type TaskStatus } from '@shared/board';
import { taskBranch } from '@shared/naming';
import type { Project } from '@shared/schemas';
import type { CreationStep, StageInfo, TaskDetail, TaskProgress } from '@shared/tasks';
import type { StageStatus } from '@shared/types';
import * as board from './board';
import type { Db } from './db/db';
import { cleanClaudeEnv } from './env';
import { addWorktree, behindCount, branchExists, currentBranch, fetchRemote, headSha, removeWorktree, startPoint } from './git';
import { legalActions, sendBackTargets } from './machine';
import { fileHash, loadState } from './pipeline';
import { renderBrief, renderIssueMd, ensureTaskFolder } from './taskfs';
import { parseTemplate, type LoadedTemplate } from './templates';
import { trustFolder } from './trust';

export interface TaskEnv {
  db: Db;
  lookup: board.ProjectLookup;
  dataRoot: string;
  templates(): LoadedTemplate[];
  trustWorktrees(): boolean;
  progress(p: TaskProgress): void;
  log(issueId: number, taskId: number, chunk: string): void;
  changed(projectSlug: string, issueId: number, taskId: number): void;
  /** Override for tests; defaults to ~/.claude.json. */
  claudeJson?: string;
  /** The live run of a stage, if its PTY is up (from sessions.ts). */
  liveRun?(stageId: number): number | null;
  /** The stage is running its `pre` checks (from sessions.ts). */
  checking?(stageId: number): boolean;
}

interface TaskRow {
  id: number;
  issue_id: number;
  project_slug: string;
  issue_key: string;
  title: string;
  template: string;
  template_yaml: string;
  status: TaskStatus;
  branch: string;
  base_sha: string | null;
  worktree_path: string;
  task_dir: string;
  created_at: number;
  closed_at: number | null;
  setup_done_at: number | null;
}

/** Creations in flight, by issue id. A second start while one runs waits for the same promise. */
const inflight = new Map<number, Promise<TaskDetail>>();

const taskRow = (db: Db, id: number) => {
  const row = db.prepare('SELECT * FROM task WHERE id = ?').get(id) as TaskRow | undefined;
  if (!row) throw new Error('That task no longer exists');
  return row;
};
export const taskDir = (db: Db, id: number) => taskRow(db, id).task_dir;

/** The ids a task:changed event carries. */
export function taskRef(db: Db, id: number) {
  const row = taskRow(db, id);
  return { taskId: row.id, issueId: row.issue_id, projectSlug: row.project_slug };
}
const liveTaskOf = (db: Db, issueId: number) =>
  db.prepare("SELECT * FROM task WHERE issue_id = ? AND status <> 'abandoned'").get(issueId) as TaskRow | undefined;

export async function getTask(env: Pick<TaskEnv, 'db' | 'lookup' | 'liveRun' | 'checking'>, id: number): Promise<TaskDetail> {
  const row = taskRow(env.db, id);
  const project = env.lookup(row.project_slug);
  const template = parseTemplate(row.template_yaml);
  const byKey = new Map(template.stages.map((s) => [s.key, s]));
  const machine = loadState(env.db, env.lookup, id, (stageId) => env.liveRun?.(stageId) ?? null).state;
  const lastRun = env.db.prepare('SELECT id, exit_code, exit_note, ended_at FROM run WHERE stage_id = ? ORDER BY id DESC LIMIT 1');
  const stages = (
    env.db.prepare('SELECT id, stage_key, status, round, last_message, approved_hash, approved_at FROM stage WHERE task_id = ? ORDER BY position').all(id) as {
      id: number;
      stage_key: string;
      status: StageStatus;
      round: number;
      last_message: string | null;
      approved_hash: string | null;
      approved_at: number | null;
    }[]
  ).map((s): StageInfo => {
    const run = lastRun.get(s.id) as { id: number; exit_code: number | null; exit_note: string | null; ended_at: number | null } | undefined;
    const artifact = byKey.get(s.stage_key)?.produces ?? '';
    return {
      id: s.id,
      key: s.stage_key,
      title: byKey.get(s.stage_key)?.title ?? s.stage_key,
      status: s.status,
      round: s.round,
      artifact,
      approvedAt: s.approved_at,
      modified: s.status === 'approved' && s.approved_hash !== null && fileHash(row.task_dir, artifact) !== s.approved_hash,
      checking: env.checking?.(s.id) ?? false,
      lastMessage: s.last_message,
      liveRunId: env.liveRun?.(s.id) ?? null,
      lastRun: run ? { id: run.id, exitCode: run.exit_code, exitNote: run.exit_note, endedAt: run.ended_at } : null,
    };
  });
  const upstream = project.remote ? `${project.remote}/${project.defaultBranch}` : project.defaultBranch;
  return {
    id: row.id,
    issueId: row.issue_id,
    projectSlug: row.project_slug,
    issueKey: row.issue_key,
    title: row.title,
    template: row.template,
    status: row.status,
    branch: row.branch,
    baseSha: row.base_sha,
    worktreePath: row.worktree_path,
    taskDir: row.task_dir,
    createdAt: row.created_at,
    closedAt: row.closed_at,
    setupDoneAt: row.setup_done_at,
    creating: inflight.has(row.issue_id),
    stages,
    legal: legalActions(machine),
    sendBackTargets: sendBackTargets(machine).reverse(),
    defaultBranch: project.defaultBranch,
    behind: row.status === 'abandoned' || row.status === 'done' ? null : await behindCount(row.worktree_path, upstream),
  };
}

/** Folder name, branch and paths for a new task: KEY, then KEY-2, KEY-3… when an earlier task took them. */
async function pickNames(env: TaskEnv, project: Project, key: string, title: string) {
  const used = env.db.prepare('SELECT branch, worktree_path, task_dir FROM task WHERE project_slug = ?').all(project.slug) as Pick<
    TaskRow,
    'branch' | 'worktree_path' | 'task_dir'
  >[];
  const taken = new Set(used.flatMap((u) => [u.branch, u.worktree_path, u.task_dir]));
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? '' : `-${n}`;
    const branch = taskBranch(key, title) + suffix;
    const worktree = join(env.dataRoot, 'worktrees', project.slug, key + suffix);
    const taskDir = join(env.dataRoot, 'tasks', project.slug, key + suffix);
    if ([branch, worktree, taskDir].some((x) => taken.has(x)) || existsSync(worktree) || existsSync(taskDir)) continue;
    if (await branchExists(project.repoPath, branch)) continue;
    return { branch, worktree, taskDir };
  }
}

/**
 * Starts a task on an issue (status draft) and runs the creation steps. If the issue already has
 * a live task, its unfinished steps run instead; if it is fully set up, nothing happens.
 */
export function createTask(env: TaskEnv, req: { issueId: number; template: string }): Promise<TaskDetail> {
  const running = inflight.get(req.issueId);
  if (running) return running;
  const p = create(env, req)
    .then((task) => ({ ...task, creating: false }))
    .finally(() => {
      inflight.delete(req.issueId);
      // Announce the end (success or not) only now, so open views refetch with creating = false.
      const row = liveTaskOf(env.db, req.issueId);
      if (row) env.changed(row.project_slug, row.issue_id, row.id);
    });
  inflight.set(req.issueId, p);
  return p;
}

async function create(env: TaskEnv, req: { issueId: number; template: string }): Promise<TaskDetail> {
  const { db } = env;
  let row = liveTaskOf(db, req.issueId);
  if (!row) {
    const card = board.getCard(db, env.lookup, req.issueId);
    if (card.archived) throw new Error(`${card.key} is archived. Unarchive it first.`);
    const project = env.lookup(card.projectSlug);
    const loaded = env.templates().find((t) => t.template.name === req.template);
    if (!loaded) throw new Error(`There's no template called "${req.template}"`);
    const names = await pickNames(env, project, card.key, card.title);
    const now = Date.now();
    const id = db.transaction(() => {
      const { lastInsertRowid } = db
        .prepare(
          `INSERT INTO task (issue_id, project_slug, issue_key, title, template, template_yaml, status, branch, worktree_path, task_dir, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
        )
        .run(card.id, project.slug, card.key, card.title, loaded.template.name, loaded.yaml, names.branch, names.worktree, names.taskDir, now);
      const taskId = Number(lastInsertRowid);
      const stage = db.prepare("INSERT INTO stage (task_id, stage_key, position, status) VALUES (?, ?, ?, 'pending')");
      loaded.template.stages.forEach((s, i) => stage.run(taskId, s.key, i + 1));
      db.prepare('UPDATE issue SET updated_at = ? WHERE id = ?').run(now, card.id);
      return taskId;
    })();
    row = taskRow(db, id);
    env.changed(row.project_slug, row.issue_id, row.id); // the card moves to In Progress as "Draft" right away
  }
  if (row.setup_done_at !== null) return getTask(env, row.id);
  await runSteps(env, row);
  return getTask(env, row.id);
}

async function runSteps(env: TaskEnv, row: TaskRow): Promise<void> {
  const project = env.lookup(row.project_slug);
  const report = (step: CreationStep, state: TaskProgress['state'], detail?: string) =>
    env.progress({ issueId: row.issue_id, taskId: row.id, step, state, detail });
  const step = async (name: CreationStep, fn: () => Promise<string | undefined>) => {
    report(name, 'running');
    try {
      const detail = await fn();
      report(name, detail === 'skipped' ? 'skipped' : 'done', detail === 'skipped' ? undefined : detail);
    } catch (e) {
      const message = (e as Error).message;
      report(name, 'failed', message);
      throw new Error(message);
    }
  };

  await step('folder', async () => {
    const issue = board.getIssue(env.db, env.lookup, env.dataRoot, row.issue_id);
    await ensureTaskFolder({
      dir: row.task_dir,
      issueMd: renderIssueMd(issue, board.listLabels(env.db, row.project_slug)),
      briefMd: renderBrief(issue),
      attachments: issue.attachments,
    });
    return row.task_dir;
  });

  await step('worktree', async () => {
    const notes: string[] = [];
    if ((await currentBranch(row.worktree_path)) !== row.branch) {
      if (existsSync(row.worktree_path)) throw new Error(`${row.worktree_path} exists but isn't this task's worktree. Move it away and retry.`);
      if (!existsSync(project.repoPath)) throw new Error(`Repository folder not found: ${project.repoPath}`);
      if (project.remote) {
        const err = await fetchRemote(project.repoPath, project.remote);
        if (err) notes.push(`Fetch from ${project.remote} failed (${err}); branched from what's already here`);
      }
      const from = await startPoint(project.repoPath, project.remote, project.defaultBranch);
      if (!from) throw new Error(`Branch ${project.defaultBranch} doesn't exist in ${project.repoPath}`);
      mkdirSync(dirname(row.worktree_path), { recursive: true });
      await addWorktree(project.repoPath, row.worktree_path, row.branch, from);
      notes.unshift(`${row.branch} from ${from}`);
    } else notes.push(`${row.branch} (already there)`);
    if (row.base_sha === null) {
      const sha = await headSha(row.worktree_path);
      if (!sha) throw new Error('Could not read the new branch');
      env.db.prepare('UPDATE task SET base_sha = ? WHERE id = ?').run(sha, row.id);
    }
    if (env.trustWorktrees()) {
      const r = trustFolder(row.worktree_path, env.claudeJson);
      if (r === 'no-config') notes.push("Not pre-trusted: ~/.claude.json doesn't exist yet");
    }
    return notes.join('. ');
  });

  await step('setup', async () => {
    const commands = project.worktreeSetup;
    if (!commands.length) return 'skipped';
    const logFile = join(row.task_dir, 'log', 'setup.log');
    const write = (text: string) => {
      appendFileSync(logFile, text);
      env.log(row.issue_id, row.id, text);
    };
    write(`# Setup for ${row.issue_key}, ${new Date().toISOString()}\n`);
    for (const command of commands) {
      write(`\n$ ${command}\n`);
      const sub = execa(command, {
        shell: true,
        cwd: row.worktree_path,
        env: cleanClaudeEnv(),
        extendEnv: false,
        stdin: 'ignore',
        all: true,
        buffer: false,
        reject: false,
        timeout: 15 * 60_000,
      });
      sub.all?.on('data', (d: Buffer) => write(d.toString()));
      const r = await sub;
      write(`[exit ${r.exitCode ?? 'killed'}]\n`);
      if (r.exitCode !== 0) throw new Error(r.timedOut ? `"${command}" took longer than 15 minutes` : `"${command}" exited with ${r.exitCode ?? 'a signal'}`);
    }
    return `${commands.length} command${commands.length === 1 ? '' : 's'} finished`;
  });

  env.db.prepare('UPDATE task SET setup_done_at = ? WHERE id = ?').run(Date.now(), row.id);
}

/** Rewrites issue.md from the board ("Refresh from board"). */
export function refreshIssueSnapshot(env: Pick<TaskEnv, 'db' | 'lookup' | 'dataRoot'>, id: number): void {
  const row = taskRow(env.db, id);
  const issue = board.getIssue(env.db, env.lookup, env.dataRoot, row.issue_id);
  writeFileSync(join(row.task_dir, 'issue.md'), renderIssueMd(issue, board.listLabels(env.db, row.project_slug)));
}

/**
 * Abandons a task: ends its sessions, removes its worktree (git refuses if it has changes, unless
 * `force`), keeps the branch and the task folder as history, and puts the issue back at the end of Todo.
 * Nothing is pushed.
 */
export async function abandonDraft(env: TaskEnv, id: number, force = false, stopSessions?: () => Promise<void>): Promise<void> {
  const row = taskRow(env.db, id);
  if (row.status === 'done' || row.status === 'abandoned') throw new Error(`A ${row.status} task can't be abandoned`);
  if (inflight.has(row.issue_id)) throw new Error('Wait for setup to finish first');
  await stopSessions?.();
  const project = env.lookup(row.project_slug);
  if ((await currentBranch(row.worktree_path)) === row.branch) await removeWorktree(project.repoPath, row.worktree_path, force);
  const now = Date.now();
  env.db.transaction(() => {
    env.db.prepare("UPDATE task SET status = 'abandoned', closed_at = ? WHERE id = ?").run(now, id);
    env.db.prepare("UPDATE stage SET status = 'interrupted' WHERE task_id = ? AND status IN ('queued', 'running', 'idle')").run(id);
    // Back to the end of Todo, where deriveColumn puts an issue whose task was abandoned.
    const last = env.db
      .prepare("SELECT MAX(position) AS p FROM issue WHERE project_slug = ? AND column_key = 'todo' AND id <> ?")
      .get(row.project_slug, row.issue_id) as { p: number | null };
    env.db
      .prepare("UPDATE issue SET column_key = 'todo', position = ?, updated_at = ? WHERE id = ?")
      .run(positionBetween(last.p ?? undefined, undefined), now, row.issue_id);
  })();
  env.changed(row.project_slug, row.issue_id, id);
}
