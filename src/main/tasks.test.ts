import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Project } from '@shared/schemas';
import type { TaskProgress } from '@shared/tasks';
import { addComment, attachFiles, createIssue, getCard, listBoard, upsertLabel, updateIssue } from './board';
import { openDb, type Db } from './db/db';
import { abandonDraft, createTask, getTask, refreshIssueSnapshot, type TaskEnv } from './tasks';
import { loadTemplates } from './templates';

const git = (cwd: string, ...args: string[]) => String(execFileSync('git', args, { cwd, stdio: 'pipe' })).trim();
const TEMPLATES = join(import.meta.dirname, '../../resources/templates');

/** A repo with one commit on main and a bare origin, in a fresh temp dir. */
function makeRepo(base: string, withRemote = true) {
  const repo = join(base, 'repo');
  git(base, 'init', '-q', '-b', 'main', repo);
  writeFileSync(join(repo, 'README.md'), 'hello\n');
  git(repo, 'add', '.');
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init');
  if (withRemote) {
    const origin = join(base, 'origin.git');
    git(base, 'init', '-q', '--bare', '-b', 'main', origin);
    git(repo, 'remote', 'add', 'origin', origin);
    git(repo, 'push', '-q', 'origin', 'main');
  }
  return repo;
}

let base: string;
let db: Db;
let project: Project;
let events: TaskProgress[];
let log: string;
let claudeJson: string;
let env: TaskEnv;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'yantra-task-'));
  db = openDb(':memory:');
  project = {
    slug: 'payments',
    name: 'Payments',
    key: 'PAY',
    color: 'indigo',
    repoPath: makeRepo(base),
    defaultBranch: 'main',
    remote: 'origin',
    sharedDirs: [],
    worktreeSetup: [],
  };
  events = [];
  log = '';
  claudeJson = join(base, '.claude.json');
  writeFileSync(claudeJson, JSON.stringify({ hasCompletedOnboarding: true, projects: { 'D:/other': { allowedTools: ['x'] } } }));
  env = {
    db,
    lookup: () => project,
    dataRoot: join(base, 'data'),
    templates: () => loadTemplates([TEMPLATES]).templates,
    trustWorktrees: () => true,
    progress: (p) => events.push(p),
    log: (_i, _t, chunk) => (log += chunk),
    changed: () => {},
    claudeJson,
  };
});

const newIssue = (title = 'Fix webhook retry storm', body = 'Retries pile up.') =>
  createIssue(db, project, { projectSlug: project.slug, title, body, column: 'todo' });

describe('createTask', () => {
  it('creates the folder, worktree and branch, and a draft with pending stages', async () => {
    const issueId = newIssue();
    const task = await createTask(env, { issueId, template: 'standard' });

    expect(task.status).toBe('draft');
    expect(task.branch).toBe('yantra/PAY-1-fix-webhook-retry-storm');
    expect(task.stages.map((s) => `${s.key}:${s.status}`)).toEqual(['research:pending', 'plan:pending', 'code:pending', 'review:pending']);
    expect(task.setupDoneAt).not.toBeNull();
    expect(task.creating).toBe(false);
    expect(getCard(db, env.lookup, issueId).column).toBe('in_progress');

    for (const f of ['brief.md', 'issue.md', 'resources', 'feedback', 'log', '.git']) expect(existsSync(join(task.taskDir, f))).toBe(true);
    expect(readFileSync(join(task.taskDir, 'brief.md'), 'utf8')).toContain('## Goal\n\nRetries pile up.');
    expect(git(task.taskDir, 'log', '--oneline')).toContain('Task created');

    expect(git(task.worktreePath, 'branch', '--show-current')).toBe(task.branch);
    expect(task.baseSha).toBe(git(project.repoPath, 'rev-parse', 'origin/main'));
    expect(task.behind).toBe(0);
    expect(events.filter((e) => e.state !== 'running').map((e) => `${e.step}:${e.state}`)).toEqual(['folder:done', 'worktree:done', 'setup:skipped']);
  });

  it('announces the end only once creation is no longer in flight', async () => {
    const seen: Promise<{ creating: boolean }>[] = [];
    env.changed = (_s, _i, taskId) => void seen.push(getTask(env, taskId)); // reads `creating` at the moment of the event
    await createTask(env, { issueId: newIssue(), template: 'standard' });
    const views = await Promise.all(seen);
    expect(views[0]!.creating).toBe(true);
    expect(views.at(-1)!.creating).toBe(false);
  });

  it('is a no-op the second time, and concurrent starts share one creation', async () => {
    const issueId = newIssue();
    const [a, b] = await Promise.all([createTask(env, { issueId, template: 'standard' }), createTask(env, { issueId, template: 'quickfix' })]);
    expect(a.id).toBe(b.id);
    const brief = join(a.taskDir, 'brief.md');
    writeFileSync(brief, 'my edits');
    events = [];
    const again = await createTask(env, { issueId, template: 'quickfix' });
    expect(again.id).toBe(a.id);
    expect(again.template).toBe('standard');
    expect(events).toEqual([]);
    expect(readFileSync(brief, 'utf8')).toBe('my edits');
    expect((db.prepare('SELECT COUNT(*) AS n FROM task').get() as { n: number }).n).toBe(1);
  });

  it('snapshots the issue, labels, comments and attachments', async () => {
    const issueId = newIssue();
    const label = upsertLabel(db, { projectSlug: project.slug, name: 'bug', color: 'red' });
    updateIssue(db, { id: issueId, priority: 3, labelIds: [label.id] });
    addComment(db, { issueId, body: 'Seen in prod' });
    const src = join(base, 'trace.log');
    writeFileSync(src, 'boom');
    attachFiles(db, env.lookup, env.dataRoot, issueId, [src]);

    const task = await createTask(env, { issueId, template: 'quickfix' });
    const issueMd = readFileSync(join(task.taskDir, 'issue.md'), 'utf8');
    expect(issueMd).toContain('# PAY-1: Fix webhook retry storm');
    expect(issueMd).toContain('**Priority:** High');
    expect(issueMd).toContain('**Labels:** bug');
    expect(issueMd).toContain('Seen in prod');
    expect(readFileSync(join(task.taskDir, 'resources', 'trace.log'), 'utf8')).toBe('boom');

    updateIssue(db, { id: issueId, title: 'Renamed' });
    refreshIssueSnapshot(env, task.id);
    expect(readFileSync(join(task.taskDir, 'issue.md'), 'utf8')).toContain('# PAY-1: Renamed');
  });

  it('pre-trusts the worktree in ~/.claude.json and leaves the rest of it alone', async () => {
    const task = await createTask(env, { issueId: newIssue(), template: 'standard' });
    const j = JSON.parse(readFileSync(claudeJson, 'utf8'));
    expect(j.projects[task.worktreePath.replace(/\\/g, '/')]).toEqual({ hasTrustDialogAccepted: true });
    expect(j.projects['D:/other']).toEqual({ allowedTools: ['x'] });
    expect(j.hasCompletedOnboarding).toBe(true);
  });

  it("doesn't touch ~/.claude.json with the setting off", async () => {
    env.trustWorktrees = () => false;
    const before = readFileSync(claudeJson, 'utf8');
    await createTask(env, { issueId: newIssue(), template: 'standard' });
    expect(readFileSync(claudeJson, 'utf8')).toBe(before);
  });

  it('branches from the local default branch when there is no remote, and notes a failed fetch', async () => {
    mkdirSync(join(base, 'local'));
    project = { ...project, repoPath: makeRepo(join(base, 'local'), false), remote: '' };
    const task = await createTask(env, { issueId: newIssue(), template: 'standard' });
    expect(task.baseSha).toBe(git(project.repoPath, 'rev-parse', 'main'));

    project = { ...project, remote: 'nowhere' };
    await createTask(env, { issueId: newIssue('Second'), template: 'standard' });
    expect(events.find((e) => e.step === 'worktree' && e.state === 'done' && e.detail?.includes('Fetch from nowhere failed'))).toBeTruthy();
  });

  it('streams setup output to log/setup.log, stops on a failure, and finishes on retry', async () => {
    project = { ...project, worktreeSetup: ['echo first-step', 'exit 3'] };
    const issueId = newIssue();
    await expect(createTask(env, { issueId, template: 'standard' })).rejects.toThrow('"exit 3" exited with 3');
    const draft = db.prepare('SELECT * FROM task').get() as { id: number; setup_done_at: number | null; task_dir: string };
    expect(draft.setup_done_at).toBeNull();
    expect(log).toContain('first-step');
    expect(readFileSync(join(draft.task_dir, 'log', 'setup.log'), 'utf8')).toContain('[exit 3]');
    expect(getCard(db, env.lookup, issueId).task?.status).toBe('draft');

    project = { ...project, worktreeSetup: ['echo fixed'] };
    events = [];
    const task = await createTask(env, { issueId, template: 'standard' });
    expect(task.id).toBe(draft.id);
    expect(task.setupDoneAt).not.toBeNull();
    expect(events.find((e) => e.step === 'worktree' && e.state === 'done')?.detail).toContain('already there');
  });

  it('refuses an archived issue or an unknown template without creating anything', async () => {
    const issueId = newIssue();
    await expect(createTask(env, { issueId, template: 'nope' })).rejects.toThrow('no template called "nope"');
    db.prepare('UPDATE issue SET archived = 1').run();
    await expect(createTask(env, { issueId, template: 'standard' })).rejects.toThrow('archived');
    expect((db.prepare('SELECT COUNT(*) AS n FROM task').get() as { n: number }).n).toBe(0);
  });
});

describe('abandonDraft', () => {
  it('removes the worktree, keeps branch and folder, and sends the issue to Todo; a new task gets fresh names', async () => {
    const issueId = newIssue();
    const first = await createTask(env, { issueId, template: 'standard' });
    await abandonDraft(env, first.id);

    expect(existsSync(first.worktreePath)).toBe(false);
    expect(existsSync(join(first.taskDir, 'brief.md'))).toBe(true);
    expect(git(project.repoPath, 'branch', '--list', first.branch)).toContain(first.branch);
    expect(listBoard(db, project).cards[0]).toMatchObject({ column: 'todo', task: null });
    expect((await getTask(env, first.id)).status).toBe('abandoned');

    const second = await createTask(env, { issueId, template: 'standard' });
    expect(second.id).not.toBe(first.id);
    expect(second.branch).toBe(`${first.branch}-2`);
    expect(second.taskDir).toBe(`${first.taskDir}-2`);
  });

  it('refuses a dirty worktree unless forced', async () => {
    const task = await createTask(env, { issueId: newIssue(), template: 'standard' });
    writeFileSync(join(task.worktreePath, 'scratch.txt'), 'wip');
    await expect(abandonDraft(env, task.id)).rejects.toThrow(/untracked|modified/);
    expect((await getTask(env, task.id)).status).toBe('draft');
    await abandonDraft(env, task.id, true);
    expect(existsSync(task.worktreePath)).toBe(false);
  });
});
