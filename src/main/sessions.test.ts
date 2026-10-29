import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Project } from '@shared/schemas';
import type { Notice } from '@shared/sessions';
import type { PreflightResult } from '@shared/types';
import { createIssue } from './board';
import type { ChecksInput } from './checks';
import { openDb, type Db } from './db/db';
import { applyHookLine, HookTailer } from './hooks';
import { claudeArgs, renderPrompt, settingsJson, writeHookWrapper } from './launch';
import { act, fileHash } from './pipeline';
import { artifactReady, markInterrupted, Sessions, type PtyLike, type SessionEnv } from './sessions';
import { createTask, getTask, type TaskEnv } from './tasks';
import { loadTemplates } from './templates';

const git = (cwd: string, ...args: string[]) => String(execFileSync('git', args, { cwd, stdio: 'pipe' })).trim();
const RESOURCES = join(import.meta.dirname, '../../resources');

class FakePty implements PtyLike {
  written: string[] = [];
  killed = false;
  /** Exit as soon as /exit is submitted, like claude does (the pipeline waits for it). */
  autoExit = false;
  private dataCb: (d: string) => void = () => {};
  private exitCb: (e: { exitCode: number }) => void = () => {};
  constructor(
    public file: string,
    public args: string[],
    public opts: { cwd: string; env: Record<string, string> },
  ) {}
  onData(cb: (d: string) => void) {
    this.dataCb = cb;
  }
  onExit(cb: (e: { exitCode: number }) => void) {
    this.exitCb = cb;
  }
  write(d: string) {
    this.written.push(d);
    if (this.autoExit && d === '\r' && this.written.at(-2) === '/exit') setTimeout(() => this.exit(0), 5);
  }
  resize() {}
  kill() {
    this.killed = true;
  }
  emit(d: string) {
    this.dataCb(d);
  }
  exit(code: number) {
    this.exitCb({ exitCode: code });
  }
}

const OK: PreflightResult = {
  ok: true,
  checkedAt: 0,
  binary: { ok: true, detail: '', path: 'claude', version: '2.1.312' },
  auth: { ok: true, detail: '', email: null, plan: null },
  onboarding: { ok: true, detail: '' },
};

let base: string;
let db: Db;
let project: Project;
let taskEnv: TaskEnv;
let ptys: FakePty[];
let notices: Notice[];
let tailer: HookTailer;
let sessions: Sessions;
let max: number;
let preflight: PreflightResult;
let autoExit: boolean;
let checks: ChecksInput[];

function makeSessions() {
  const env: SessionEnv = {
    db,
    lookup: () => project,
    claudeBinary: () => 'claude.exe',
    maxSessions: () => max,
    preflight: async () => preflight,
    hookWrapper: 'C:\\Program Files\\Yantra\\bin\\hook.cmd',
    promptDirs: [RESOURCES],
    tailer,
    spawn: (file, args, opts) => {
      const p = new FakePty(file, args, opts);
      p.autoExit = autoExit;
      ptys.push(p);
      return p;
    },
    runChecks: async (input) => {
      checks.push(input);
      writeFileSync(input.out, `$ ${input.commands.join('\n$ ')}\n[exit 0]\n`);
      return { passed: input.commands.length, failed: 0 };
    },
    data: () => {},
    exited: () => {},
    changed: () => {},
    sessionsChanged: () => {},
    notify: (n) => notices.push(n),
  };
  return new Sessions(env);
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'yantra-sess-'));
  const repo = join(base, 'repo');
  git(base, 'init', '-q', '-b', 'main', repo);
  writeFileSync(join(repo, 'README.md'), 'hello\n');
  git(repo, 'add', '.');
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init');
  db = openDb(':memory:');
  project = { slug: 'toy', name: 'Toy', key: 'TOY', color: 'indigo', repoPath: repo, defaultBranch: 'main', remote: '', sharedDirs: [join(base, 'notes')], worktreeSetup: [] };
  taskEnv = {
    db,
    lookup: () => project,
    dataRoot: join(base, 'data'),
    templates: () => loadTemplates([join(RESOURCES, 'templates')]).templates,
    trustWorktrees: () => false,
    progress: () => {},
    log: () => {},
    changed: () => {},
  };
  ptys = [];
  notices = [];
  max = 3;
  preflight = OK;
  autoExit = false;
  checks = [];
  tailer = new HookTailer((_f, line) =>
    applyHookLine(
      { db, artifactReady: (id) => artifactReady(db, id), notify: (n) => notices.push(n), changed: () => {}, sessionEnded: () => {} },
      line,
    ),
  );
  sessions = makeSessions();
});

afterEach(async () => {
  await tailer.close();
});

async function newTask(title = 'Fix retry storm', template = 'standard') {
  const issueId = createIssue(db, project, { projectSlug: project.slug, title, column: 'todo' });
  return createTask(taskEnv, { issueId, template });
}
const stageRow = (taskId: number, key: string) =>
  db.prepare('SELECT * FROM stage WHERE task_id = ? AND stage_key = ?').get(taskId, key) as {
    id: number;
    status: string;
    session_id: string | null;
    awaiting_since: number | null;
    last_message: string | null;
  };
const runRow = (id: number) => db.prepare('SELECT * FROM run WHERE id = ?').get(id) as { exit_code: number; exit_note: string | null; kind: string; session_id: string; transcript_path: string | null };
const hook = (taskDir: string, runId: number, event: string, extra: Record<string, unknown> = {}) =>
  appendFileSync(join(taskDir, 'log', 'hooks.jsonl'), JSON.stringify({ ts: Date.now(), runId, stage: 'research', event, blocked: false, ...extra }) + '\n');
const runIdOf = (p: FakePty) => Number(p.opts.env.YANTRA_RUN_ID);

describe('launching a stage', () => {
  it('starts a draft: task active, first stage running, claude spawned with the SPEC argv and env', async () => {
    const task = await newTask();
    process.env.CLAUDECODE = '1';
    try {
      expect(await sessions.startTask(task.id)).toEqual({ ok: true });
    } finally {
      delete process.env.CLAUDECODE;
    }
    const pty = ptys[0]!;
    const stage = stageRow(task.id, 'research');
    expect(stage.status).toBe('running');
    expect((await getTask(taskEnv, task.id)).status).toBe('active');

    expect(pty.file).toBe('claude.exe');
    expect(pty.opts.cwd).toBe(task.worktreePath);
    expect(pty.args[0]).toMatch(/^You are the RESEARCH stage for TOY-1: Fix retry storm\.\nTask folder: /);
    expect(pty.args[0]).not.toMatch(/\{\{|Revise based on/);
    expect(pty.args.slice(1, 5)).toEqual(['--session-id', stage.session_id, '--append-system-prompt', 'You are the RESEARCH agent in YANTRA. Stay in your lane.']);
    expect(pty.args).toEqual(expect.arrayContaining(['--add-dir', task.taskDir, '--no-chrome', '--permission-mode', 'acceptEdits']));
    expect(pty.args[pty.args.indexOf(task.taskDir) + 2]).toBe(project.sharedDirs[0]);
    expect(pty.args).not.toContain('--bare');

    const env = pty.opts.env;
    expect(env).toMatchObject({ YANTRA_TASK_DIR: task.taskDir, YANTRA_WORKTREE: task.worktreePath, YANTRA_STAGE: 'research', CLAUDE_CODE_ENABLE_TELEMETRY: '0', TERM: 'xterm-256color' });
    expect(env.CLAUDECODE).toBeUndefined();
    const settings = JSON.parse(readFileSync(pty.args[pty.args.indexOf('--settings') + 1]!, 'utf8'));
    expect(settings.hooks.PreToolUse[0]).toEqual({ matcher: '*', hooks: [{ type: 'command', command: '"C:/Program Files/Yantra/bin/hook.cmd"' }] });
    expect(Object.keys(settings.hooks)).toEqual(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionEnd']);
    expect(JSON.parse(readFileSync(env.YANTRA_POLICY!, 'utf8'))).toMatchObject({ stage: 'research', write: ['task:research.md'], deny: expect.arrayContaining(['git push']) });
    expect(runRow(runIdOf(pty))).toMatchObject({ kind: 'start', session_id: stage.session_id });
  });

  it("doesn't launch when pre-flight fails, and leaves the draft alone", async () => {
    const task = await newTask();
    preflight = { ...OK, ok: false, auth: { ...OK.auth, ok: false } };
    expect(await sessions.startTask(task.id)).toEqual({ ok: false, preflight });
    expect(ptys).toHaveLength(0);
    expect((await getTask(taskEnv, task.id)).status).toBe('draft');
  });

  it('only launches the next stage in template order, and only once', async () => {
    const task = await newTask();
    await expect(sessions.launch(stageRow(task.id, 'plan').id)).rejects.toThrow(/template order/);
    await sessions.startTask(task.id);
    await expect(sessions.launch(stageRow(task.id, 'research').id)).rejects.toThrow(/already running/);
    await expect(sessions.startTask(task.id)).rejects.toThrow(/already started/);
  });

  it('queues beyond maxConcurrentSessions and starts FIFO when a slot frees', async () => {
    max = 1;
    const a = await newTask('A');
    const b = await newTask('B');
    const c = await newTask('C');
    await sessions.startTask(a.id);
    await sessions.startTask(b.id);
    await sessions.startTask(c.id);
    expect(ptys).toHaveLength(1);
    expect(stageRow(b.id, 'research').status).toBe('queued');
    expect(sessions.summary().sessions.map((s) => [s.issueKey, s.queuePosition])).toEqual([
      ['TOY-1', null],
      ['TOY-2', 1],
      ['TOY-3', 2],
    ]);
    hook(a.taskDir, runIdOf(ptys[0]!), 'SessionStart');
    ptys[0]!.exit(0);
    await new Promise((r) => setTimeout(r, 50));
    expect(ptys).toHaveLength(2);
    expect(ptys[1]!.opts.cwd).toBe(b.worktreePath);
    expect(stageRow(c.id, 'research').status).toBe('queued');
  });
});

describe('hook events drive the stage', () => {
  it('running → stays running with background work → idle → awaiting approval once the artifact exists', async () => {
    const task = await newTask();
    await sessions.startTask(task.id);
    const runId = runIdOf(ptys[0]!);
    const flush = () => tailer.flush(task.taskDir);

    hook(task.taskDir, runId, 'SessionStart', { source: 'startup', transcriptPath: 'C:/t/x.jsonl' });
    hook(task.taskDir, runId, 'UserPromptSubmit');
    hook(task.taskDir, runId, 'PreToolUse', { tool: 'PowerShell', summary: 'git push origin main', blocked: true, reason: 'no' });
    hook(task.taskDir, runId, 'Stop', { backgroundRunning: true, lastMessage: 'waiting on the subagent' });
    await flush();
    expect(stageRow(task.id, 'research')).toMatchObject({ status: 'running', last_message: 'waiting on the subagent' });
    expect(runRow(runId).transcript_path).toBe('C:/t/x.jsonl');
    expect(notices).toEqual([expect.objectContaining({ tone: 'error', title: 'TOY-1 research: blocked by the fence', description: 'git push origin main' })]);
    const events = db.prepare('SELECT hook, tool, blocked FROM event WHERE run_id = ? ORDER BY id').all(runId);
    expect(events).toEqual([
      { hook: 'SessionStart', tool: null, blocked: 0 },
      { hook: 'UserPromptSubmit', tool: null, blocked: 0 },
      { hook: 'PreToolUse', tool: 'PowerShell', blocked: 1 },
      { hook: 'Stop', tool: null, blocked: 0 },
    ]);

    // The subagent finishes: a <task-notification> turn, then a Stop with nothing in the background.
    hook(task.taskDir, runId, 'UserPromptSubmit', { notification: true });
    hook(task.taskDir, runId, 'Stop', { backgroundRunning: false });
    await flush();
    expect(stageRow(task.id, 'research').status).toBe('idle');

    writeFileSync(join(task.taskDir, 'research.md'), '# Research\n');
    hook(task.taskDir, runId, 'Stop', { backgroundRunning: false, lastMessage: 'RESEARCH READY' });
    await flush();
    const s = stageRow(task.id, 'research');
    expect(s.status).toBe('awaiting_approval');
    expect(s.awaiting_since).toBeGreaterThan(0);
    expect(notices.at(-1)).toMatchObject({ tone: 'success', title: 'TOY-1: research is ready for you' });

    // Typing more into the session puts it back to running.
    hook(task.taskDir, runId, 'UserPromptSubmit');
    await flush();
    expect(stageRow(task.id, 'research')).toMatchObject({ status: 'running', awaiting_since: null });
  });

  it("a subagent's own Stop doesn't end the stage's turn", async () => {
    const task = await newTask();
    await sessions.startTask(task.id);
    const runId = runIdOf(ptys[0]!);
    hook(task.taskDir, runId, 'Stop', { agentId: 'a1', backgroundRunning: false });
    await tailer.flush(task.taskDir);
    expect(stageRow(task.id, 'research').status).toBe('running');
  });

  it('requireCommits holds Code at idle until the branch has a commit', async () => {
    const task = await newTask('Quick', 'quickfix');
    await sessions.startTask(task.id);
    const runId = runIdOf(ptys[0]!);
    writeFileSync(join(task.taskDir, 'implementation.md'), 'did it\n');
    hook(task.taskDir, runId, 'Stop', { backgroundRunning: false });
    await tailer.flush(task.taskDir);
    expect(stageRow(task.id, 'code').status).toBe('idle');

    writeFileSync(join(task.worktreePath, 'fix.js'), '1\n');
    git(task.worktreePath, 'add', '.');
    git(task.worktreePath, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'TOY-1: fix');
    hook(task.taskDir, runId, 'Stop', { backgroundRunning: false });
    await tailer.flush(task.taskDir);
    expect(stageRow(task.id, 'code').status).toBe('awaiting_approval');
  });
});

describe('when the PTY ends', () => {
  it('a quick non-zero exit before SessionStart is the trust prompt: note, toast, stage back to not started', async () => {
    const task = await newTask();
    await sessions.startTask(task.id);
    const first = stageRow(task.id, 'research').session_id;
    const runId = runIdOf(ptys[0]!);
    ptys[0]!.exit(1);
    await new Promise((r) => setTimeout(r, 50));
    expect(runRow(runId)).toMatchObject({ exit_code: 1, exit_note: 'trust_prompt' });
    expect(stageRow(task.id, 'research')).toMatchObject({ status: 'pending', session_id: null });
    expect(ptys[0]!.killed).toBe(true);
    expect(notices.at(-1)?.title).toBe('TOY-1: Claude exited at the trust prompt');
    expect((await getTask(taskEnv, task.id)).stages[0]!.lastRun).toMatchObject({ exitNote: 'trust_prompt' });

    // Retry starts a fresh session with the prompt again.
    await sessions.launch(stageRow(task.id, 'research').id);
    expect(ptys[1]!.args[0]).toMatch(/^You are the RESEARCH stage/);
    expect(stageRow(task.id, 'research').session_id).not.toBe(first);
  });

  it('an exit after SessionStart interrupts the stage; Resume continues the same session with no prompt', async () => {
    const task = await newTask();
    await sessions.startTask(task.id);
    const sessionId = stageRow(task.id, 'research').session_id!;
    hook(task.taskDir, runIdOf(ptys[0]!), 'SessionStart', { source: 'startup' });
    ptys[0]!.emit('hello from claude');
    ptys[0]!.exit(0);
    await new Promise((r) => setTimeout(r, 50));
    expect(stageRow(task.id, 'research').status).toBe('interrupted');
    expect(sessions.attach(runIdOf(ptys[0]!))).toEqual({ data: 'hello from claude', live: false });
    expect(readFileSync(join(task.taskDir, 'log', `terminal-${runIdOf(ptys[0]!)}.log`), 'utf8')).toBe('hello from claude');

    await sessions.launch(stageRow(task.id, 'research').id);
    const resumed = ptys[1]!;
    expect(resumed.args.slice(0, 3)).toEqual(['--resume', sessionId, '--add-dir']);
    expect(runRow(runIdOf(resumed))).toMatchObject({ kind: 'resume', session_id: sessionId });
    // Resumed without a prompt, claude waits at the input box: idle, not running.
    hook(task.taskDir, runIdOf(resumed), 'SessionStart', { source: 'resume' });
    await tailer.flush(task.taskDir);
    expect(stageRow(task.id, 'research').status).toBe('idle');
    expect(sessions.runs(task.id).map((r) => [r.kind, r.live])).toEqual([
      ['resume', true],
      ['start', false],
    ]);
    // A later resume that dies before SessionStart (say, at the trust prompt) keeps the session.
    await sessions.stop(stageRow(task.id, 'research').id);
    ptys[1]!.exit(0);
    await new Promise((r) => setTimeout(r, 50));
    await sessions.launch(stageRow(task.id, 'research').id);
    ptys[2]!.exit(1);
    await new Promise((r) => setTimeout(r, 50));
    expect(stageRow(task.id, 'research')).toMatchObject({ status: 'interrupted', session_id: sessionId });
  });

  it('Stop session: Esc, /exit, confirms the background-work question, and notes the stop', async () => {
    const task = await newTask();
    await sessions.startTask(task.id);
    const pty = ptys[0]!;
    hook(task.taskDir, runIdOf(pty), 'SessionStart', { source: 'startup' });
    await tailer.flush(task.taskDir);
    await sessions.stop(stageRow(task.id, 'research').id);
    expect(pty.written).toEqual(['\x1b', '/exit', '\r']);
    pty.emit('Background work is running\r\n❯ 1. Exit and stop tasks');
    expect(pty.written.at(-1)).toBe('\r');
    pty.exit(0);
    await new Promise((r) => setTimeout(r, 50));
    expect(runRow(runIdOf(pty)).exit_note).toBe('stopped');
    expect(stageRow(task.id, 'research').status).toBe('interrupted');
    expect(sessions.summary()).toMatchObject({ sessions: [], live: 0 });
  });

  it('on boot, live stages become interrupted', async () => {
    const task = await newTask();
    await sessions.startTask(task.id);
    expect(markInterrupted(db)).toBe(1);
    expect(stageRow(task.id, 'research').status).toBe('interrupted');
    expect(db.prepare('SELECT COUNT(*) AS n FROM run WHERE ended_at IS NULL').get()).toEqual({ n: 0 });
  });

  it('quitting saves each live run’s output before killing it', async () => {
    const task = await newTask();
    await sessions.startTask(task.id);
    ptys[0]!.emit('mid-turn output');
    sessions.killAll();
    expect(ptys[0]!.killed).toBe(true);
    expect(makeSessions().attach(runIdOf(ptys[0]!)).data).toBe('mid-turn output');
  });

  it('replays a past run from its saved log in a later app session', async () => {
    const task = await newTask();
    await sessions.startTask(task.id);
    const runId = runIdOf(ptys[0]!);
    ptys[0]!.emit('\x1b[1mbold\x1b[0m');
    ptys[0]!.exit(0);
    await new Promise((r) => setTimeout(r, 50));
    expect(makeSessions().attach(runId)).toEqual({ data: '\x1b[1mbold\x1b[0m', live: false });
  });
});

describe('the pipeline', () => {
  const pipe = () => ({ db, lookup: () => project, sessions, changed: () => {} });
  const settle = () => new Promise((r) => setTimeout(r, 60));
  /** Bring the newest PTY's stage to awaiting approval: SessionStart, the artifact, a Stop. */
  async function ready(task: { taskDir: string; worktreePath: string }, artifact: string, opts: { commit?: boolean } = {}) {
    const pty = ptys.at(-1)!;
    hook(task.taskDir, runIdOf(pty), 'SessionStart', { source: 'startup' });
    writeFileSync(join(task.taskDir, artifact), `# ${artifact}\n`);
    if (opts.commit) {
      writeFileSync(join(task.worktreePath, `f${ptys.length}.js`), '1\n');
      git(task.worktreePath, 'add', '.');
      git(task.worktreePath, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'TOY-1: step');
    }
    hook(task.taskDir, runIdOf(pty), 'Stop', { backgroundRunning: false });
    await tailer.flush(task.taskDir);
  }

  beforeEach(() => {
    autoExit = true;
  });

  it('approve: hash and commit the artifact, end the session, launch the next stage fresh', async () => {
    const task = await newTask();
    await sessions.startTask(task.id);
    await ready(task, 'research.md');
    expect(stageRow(task.id, 'research').status).toBe('awaiting_approval');

    expect(await act(pipe(), task.id, { type: 'approve', stageKey: 'research' })).toEqual({ ok: true });
    const research = db.prepare("SELECT * FROM stage WHERE task_id = ? AND stage_key = 'research'").get(task.id) as { status: string; approved_hash: string; approved_at: number };
    expect(research).toMatchObject({ status: 'approved', approved_hash: fileHash(task.taskDir, 'research.md') });
    expect(research.approved_at).toBeGreaterThan(0);
    expect(ptys[0]!.written).toEqual(['/exit', '\r']);
    expect(ptys).toHaveLength(2);
    expect(ptys[1]!.args[0]).toMatch(/^You are the PLAN stage/);
    expect(stageRow(task.id, 'plan').status).toBe('running');
    expect(git(task.taskDir, 'log', '-1', '--format=%s')).toBe('Approve Research (round 1)');

    const detail = await getTask({ ...taskEnv, liveRun: (id) => sessions.liveRunOf(id) }, task.id);
    expect(detail.stages[0]).toMatchObject({ modified: false, artifact: 'research.md' });
    expect(detail.legal).toEqual(['sendBack', 'skip', 'abandon']);
    expect(detail.sendBackTargets).toEqual(['research']);
    // Editing an approved artifact by hand shows "modified since approval".
    writeFileSync(join(task.taskDir, 'research.md'), '# research.md\nedited\n');
    expect((await getTask(taskEnv, task.id)).stages[0]!.modified).toBe(true);
  });

  it('nothing advances without a click: Stop on a ready artifact only waits for me', async () => {
    const task = await newTask();
    await sessions.startTask(task.id);
    await ready(task, 'research.md');
    await settle();
    expect(ptys).toHaveLength(1);
    expect(stageRow(task.id, 'plan').status).toBe('pending');
    expect(sessions.summary().needs).toEqual([expect.objectContaining({ issueKey: 'TOY-1', stageTitle: 'Research', artifact: 'research.md', round: 1 })]);
  });

  it('request changes: feedback file, round 2, the same session resumes with the prompt and the file', async () => {
    const task = await newTask();
    await sessions.startTask(task.id);
    const sessionId = stageRow(task.id, 'research').session_id;
    await ready(task, 'research.md');
    await act(pipe(), task.id, { type: 'reject', stageKey: 'research', feedback: 'Cover the 429 path too.' });

    expect(readFileSync(join(task.taskDir, 'feedback', 'research-round-2.md'), 'utf8')).toBe('# Feedback for Research, round 2\n\nCover the 429 path too.\n');
    const again = ptys[1]!;
    expect(again.args.slice(0, 2)).toEqual(['--resume', sessionId]);
    expect(again.args[2]).toContain(`Revise based on ${join(task.taskDir, 'feedback', 'research-round-2.md')}.`);
    expect(runRow(runIdOf(again))).toMatchObject({ kind: 'feedback', session_id: sessionId });
    expect(db.prepare("SELECT round FROM stage WHERE task_id = ? AND stage_key = 'research'").get(task.id)).toEqual({ round: 2 });
    expect(git(task.taskDir, 'log', '-1', '--format=%s')).toBe('Feedback for Research, round 2');
    await expect(act(pipe(), task.id, { type: 'reject', stageKey: 'research', feedback: 'x' })).rejects.toThrow(/isn't waiting for approval/);
  });

  it('quickfix end to end: checks before Review, send back to Code, review again, ready to ship', async () => {
    const task = await newTask('Quick', 'quickfix');
    await sessions.startTask(task.id);
    await ready(task, 'implementation.md', { commit: true });
    await act(pipe(), task.id, { type: 'approve', stageKey: 'code' });
    await settle();

    // Review's pre commands ran in the worktree, into checks.txt, before claude started.
    expect(checks).toEqual([expect.objectContaining({ commands: ['npm test', 'npm run lint', 'npx tsc --noEmit'], cwd: task.worktreePath, out: join(task.taskDir, 'checks.txt') })]);
    expect(notices.at(-1)).toMatchObject({ title: 'TOY-1: checks finished for Review', os: true });
    expect(ptys[1]!.args[0]).toMatch(/^You are the REVIEW stage/);
    await ready(task, 'review.md');
    const reviewSession = stageRow(task.id, 'review').session_id;

    await act(pipe(), task.id, { type: 'sendBack', toStageKey: 'code', feedback: 'Add a test for the retry cap.' });
    expect(stageRow(task.id, 'review')).toMatchObject({ status: 'pending', session_id: null });
    expect(stageRow(task.id, 'code').status).toBe('running');
    expect(ptys[2]!.args.slice(0, 2)).toEqual(['--resume', stageRow(task.id, 'code').session_id]);
    expect(ptys[2]!.args[2]).toContain('Address every comment in');
    expect(git(task.taskDir, 'log', '-1', '--format=%B').trim()).toBe('Send back to Code\n\nFeedback for Code, round 2');

    await ready(task, 'implementation.md', { commit: true });
    await act(pipe(), task.id, { type: 'approve', stageKey: 'code' });
    await settle();
    expect(checks).toHaveLength(2);
    // Review starts over in a new session.
    expect(ptys[3]!.args[0]).toMatch(/^You are the REVIEW stage/);
    expect(stageRow(task.id, 'review').session_id).not.toBe(reviewSession);
    await ready(task, 'review.md');
    await act(pipe(), task.id, { type: 'approve', stageKey: 'review' });
    const done = await getTask(taskEnv, task.id);
    expect(done.status).toBe('ready_to_ship');
    expect(done.stages.map((s) => [s.key, s.status, s.round])).toEqual([
      ['code', 'approved', 2],
      ['review', 'approved', 1],
    ]);
    expect(done.legal).toEqual(['sendBack', 'pushed', 'finish', 'abandon']);
    expect(done.sendBackTargets).toEqual(['review', 'code']);
  });

  it('skip moves on, and a stage stopped during its checks never joins the queue', async () => {
    const task = await newTask('Quick', 'quickfix');
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const slow = makeSessions();
    (slow as unknown as { env: SessionEnv }).env.runChecks = async () => {
      await gate;
      return { passed: 0, failed: 1 };
    };
    sessions = slow;
    await sessions.startTask(task.id);
    await act(pipe(), task.id, { type: 'skip', stageKey: 'code' });
    expect(stageRow(task.id, 'code').status).toBe('skipped');
    expect(stageRow(task.id, 'review').status).toBe('queued');
    expect(sessions.isChecking(stageRow(task.id, 'review').id)).toBe(true);
    await sessions.stop(stageRow(task.id, 'review').id);
    release();
    await settle();
    expect(ptys).toHaveLength(1);
    expect(stageRow(task.id, 'review').status).toBe('pending');
  });

  it('a failed pre-flight on the next stage leaves it launchable and says why', async () => {
    const task = await newTask();
    await sessions.startTask(task.id);
    await ready(task, 'research.md');
    preflight = { ...OK, ok: false, auth: { ...OK.auth, ok: false } };
    expect(await act(pipe(), task.id, { type: 'approve', stageKey: 'research' })).toEqual({ ok: false, preflight });
    expect(stageRow(task.id, 'plan').status).toBe('pending');
    expect((await getTask(taskEnv, task.id)).legal).toContain('launchStage');
  });
});

describe('launch helpers', () => {
  const vars = { taskDir: 'T', worktree: 'W', issueKey: 'K-1', title: 'X', round: 2, feedbackFile: '', baseSha: 'abc' };
  it('renders placeholders and the feedback block', () => {
    expect(renderPrompt('{{issueKey}} r{{round}} {{unknown}}\n{{#feedback}}See {{feedbackFile}}.{{/feedback}}', vars)).toBe('K-1 r2 {{unknown}}');
    expect(renderPrompt('{{#feedback}}See {{feedbackFile}}.{{/feedback}}', { ...vars, feedbackFile: 'feedback/r2.md' })).toBe('See feedback/r2.md.');
  });
  it('puts the positional prompt first and passes --model only when set', () => {
    const stage = { key: 'code', title: 'Code', prompt: 'p', reads: [], write: [], produces: 'x', requireCommits: false, gate: 'manual' as const };
    const args = claudeArgs({ mode: 'start', sessionId: 'S', prompt: 'go', stage, addDirs: ['A', 'B'], settings: 'set.json' });
    expect(args).toEqual(['go', '--session-id', 'S', '--append-system-prompt', 'You are the CODE agent in YANTRA. Stay in your lane.', '--add-dir', 'A', '--add-dir', 'B', '--settings', 'set.json', '--permission-mode', 'acceptEdits', '--no-chrome']);
    expect(claudeArgs({ mode: 'resume', sessionId: 'S', stage: { ...stage, model: 'sonnet' }, addDirs: [], settings: 's' }).slice(-2)).toEqual(['--model', 'sonnet']);
  });
  it('writes the Windows hook wrapper with the Electron path', () => {
    const file = writeHookWrapper(join(base, 'bin'), 'C:\\E\\electron.exe', 'C:\\R\\hook.cjs', 'win32');
    expect(readFileSync(file, 'utf8')).toBe('@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"C:\\E\\electron.exe" "C:\\R\\hook.cjs"\r\nexit /b %ERRORLEVEL%\r\n');
    expect(existsSync(join(base, 'bin', 'hook.cmd'))).toBe(true);
    expect(settingsJson('C:\\nospace\\hook.cmd').hooks.Stop?.[0]?.hooks[0]?.command).toBe('C:/nospace/hook.cmd');
  });
});
