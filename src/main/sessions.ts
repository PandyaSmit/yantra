// The PTY manager (SPEC "Session engine"): every stage is a real interactive claude in a node-pty.
// Launch, resume, stop, a FIFO queue behind maxConcurrentSessions, and a 2 MB ring buffer per run
// so a closed and reopened Terminal tab redraws at once. Stage status comes from hooks (hooks.ts);
// this file only sets queued/running on launch and interrupted when a PTY ends early.
import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { LaunchResult, LiveSession, NeedsYou, Notice, RunInfo, SessionsSummary } from '@shared/sessions';
import type { Template } from '@shared/tasks';
import type { PreflightResult, StageStatus } from '@shared/types';
import type { ProjectLookup } from './board';
import { runChecks, type RunChecks } from './checks';
import type { Db } from './db/db';
import { aheadCount } from './git';
import { HookTailer } from './hooks';
import { claudeArgs, readPromptFile, renderPrompt, stageEnv, writeStageFiles } from './launch';
import { parseTemplate } from './templates';

export interface PtyLike {
  onData(cb: (data: string) => void): unknown;
  onExit(cb: (e: { exitCode: number }) => void): unknown;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}
export type SpawnFn = (file: string, args: string[], opts: { cwd: string; env: Record<string, string>; cols: number; rows: number }) => PtyLike;

export interface SessionEnv {
  db: Db;
  lookup: ProjectLookup;
  claudeBinary(): string;
  maxSessions(): number;
  /** Cached by the caller; re-run when it failed. */
  preflight(): Promise<PreflightResult>;
  hookWrapper: string;
  /** Where prompt files are looked up, first match wins. */
  promptDirs: string[];
  tailer: HookTailer;
  spawn: SpawnFn;
  data(runId: number, chunk: string): void;
  exited(runId: number, exitCode: number): void;
  changed(taskId: number): void;
  /** The set of live/queued sessions changed (Running view, status bar). */
  sessionsChanged(): void;
  notify(n: Notice): void;
  /** Defaults to the real runner (checks.ts). */
  runChecks?: RunChecks;
}

const RING = 2 * 1024 * 1024;
const BATCH_MS = 16;
const STOP_TIMEOUT_MS = 5000;
/** A non-zero exit this soon, before any SessionStart hook, is claude quitting at the trust question. */
const TRUST_WINDOW_MS = 30_000;

interface Live {
  runId: number;
  stageId: number;
  taskId: number;
  taskDir: string;
  pty: PtyLike;
  buffer: string;
  pending: string;
  flush: NodeJS.Timeout | null;
  startedAt: number;
  stopping: boolean;
  exited: boolean;
  /** Resolves once the exit is fully handled. */
  done: Promise<void>;
  resolveDone: () => void;
}

interface StageRow {
  id: number;
  task_id: number;
  stage_key: string;
  position: number;
  status: StageStatus;
  session_id: string | null;
  round: number;
  last_message: string | null;
}
interface TaskRow {
  id: number;
  project_slug: string;
  issue_key: string;
  title: string;
  template_yaml: string;
  status: string;
  base_sha: string | null;
  worktree_path: string;
  task_dir: string;
  setup_done_at: number | null;
}

const templates = new Map<string, Template>();
/** Parsed template snapshots, cached by their YAML text. */
export function templateOf(yaml: string): Template {
  let t = templates.get(yaml);
  if (!t) templates.set(yaml, (t = parseTemplate(yaml)));
  return t;
}
const stageTemplate = (task: TaskRow, key: string) => {
  const s = templateOf(task.template_yaml).stages.find((x) => x.key === key);
  if (!s) throw new Error(`Stage ${key} isn't in this task's template`);
  return s;
};

/** On boot: nothing survived the restart, so live stages become interrupted (never auto-restarted). */
export function markInterrupted(db: Db, now = Date.now()): number {
  return db.transaction(() => {
    db.prepare('UPDATE run SET ended_at = ? WHERE ended_at IS NULL').run(now);
    return db.prepare("UPDATE stage SET status = 'interrupted' WHERE status IN ('running', 'idle', 'queued')").run().changes;
  })();
}

export class Sessions {
  private live = new Map<number, Live>();
  private ended = new Map<number, string>();
  private queue: number[] = [];
  /** The feedback file the next spawn of a stage passes in its prompt (Request changes, Send back). */
  private feedback = new Map<number, string>();
  /** Stages running their `pre` checks before they join the queue, and those stopped meanwhile. */
  private checking = new Set<number>();
  private cancelled = new Set<number>();

  constructor(private env: SessionEnv) {}

  private stage(id: number): StageRow {
    const s = this.env.db.prepare('SELECT * FROM stage WHERE id = ?').get(id) as StageRow | undefined;
    if (!s) throw new Error('That stage no longer exists');
    return s;
  }
  private task(id: number): TaskRow {
    const t = this.env.db.prepare('SELECT * FROM task WHERE id = ?').get(id) as TaskRow | undefined;
    if (!t) throw new Error('That task no longer exists');
    return t;
  }
  private setStatus(stageId: number, status: StageStatus) {
    this.env.db.prepare('UPDATE stage SET status = ?, awaiting_since = NULL WHERE id = ?').run(status, stageId);
  }

  /** The stage that runs now: the first one, in template order, that isn't approved or skipped. */
  currentStage(taskId: number): StageRow | undefined {
    return this.env.db
      .prepare("SELECT * FROM stage WHERE task_id = ? AND status NOT IN ('approved', 'skipped') ORDER BY position LIMIT 1")
      .get(taskId) as StageRow | undefined;
  }

  liveRunOf(stageId: number): number | null {
    for (const l of this.live.values()) if (l.stageId === stageId) return l.runId;
    return null;
  }

  /** Start on a draft: the task becomes active and its first stage launches. */
  async startTask(taskId: number): Promise<LaunchResult> {
    const task = this.task(taskId);
    if (task.status !== 'draft') throw new Error('This task has already started');
    const first = this.currentStage(taskId);
    if (!first) throw new Error('This task has no stages to run');
    return this.launch(first.id);
  }

  /** Launch (or resume) a stage by hand. Queued when every session slot is taken. */
  async launch(stageId: number): Promise<LaunchResult> {
    const stage = this.stage(stageId);
    const task = this.task(stage.task_id);
    if (task.status === 'draft' && task.setup_done_at === null) throw new Error("Setup didn't finish. Finish setup first.");
    if (!['draft', 'active'].includes(task.status)) throw new Error(`A ${task.status.replace(/_/g, ' ')} task doesn't run stages`);
    if (this.currentStage(task.id)?.id !== stage.id) throw new Error('Stages run in template order; this one is not next');
    // An ended session awaiting approval can be reopened to talk to it again (End session freed its slot).
    const reopen = stage.status === 'awaiting_approval' && this.liveRunOf(stage.id) === null;
    if (!['pending', 'interrupted'].includes(stage.status) && !reopen) throw new Error(`The ${stage.stage_key} stage is already ${stage.status.replace(/_/g, ' ')}`);
    return this.enqueue(stage.id);
  }

  /**
   * Queues a stage the caller has checked may run (launch above, or the pipeline's reducer):
   * pre-flight, then its `pre` checks before a fresh start, then the FIFO queue. A feedback file
   * goes into the next spawn's prompt. Checks run in the background; this returns once queued.
   */
  async enqueue(stageId: number, opts: { feedbackFile?: string } = {}): Promise<LaunchResult> {
    const stage = this.stage(stageId);
    const task = this.task(stage.task_id);
    if (!existsSync(task.worktree_path)) throw new Error(`The worktree is missing: ${task.worktree_path}`);

    const preflight = await this.env.preflight();
    if (!preflight.ok) {
      // The pipeline already marked it queued; put it back to where Launch/Resume can pick it up.
      if (this.stage(stageId).status === 'queued') {
        this.setStatus(stageId, this.resumable(stage) ? 'interrupted' : 'pending');
        this.env.changed(task.id);
      }
      if (opts.feedbackFile) this.feedback.set(stageId, opts.feedbackFile);
      return { ok: false, preflight };
    }

    this.env.db.transaction(() => {
      if (task.status === 'draft') this.env.db.prepare("UPDATE task SET status = 'active' WHERE id = ?").run(task.id);
      this.setStatus(stage.id, 'queued');
    })();
    if (opts.feedbackFile) this.feedback.set(stageId, opts.feedbackFile);
    const version = preflight.binary.version;
    const commands = this.env.lookup(task.project_slug).pre ?? stageTemplate(task, stage.stage_key).pre ?? [];
    if (!this.resumable(stage) && commands.length) void this.checkThenQueue(stageId, commands, version);
    else {
      this.queue.push(stage.id);
      this.pump(version);
    }
    this.env.changed(task.id);
    this.env.sessionsChanged();
    return { ok: true };
  }

  private async checkThenQueue(stageId: number, commands: string[], version: string | null) {
    const stage = this.stage(stageId);
    const task = this.task(stage.task_id);
    const title = stageTemplate(task, stage.stage_key).title;
    this.checking.add(stageId);
    try {
      const r = await (this.env.runChecks ?? runChecks)({ commands, cwd: task.worktree_path, out: join(task.task_dir, 'checks.txt'), title: `${task.issue_key} ${title}` });
      this.env.notify({
        tone: r.failed ? 'info' : 'success',
        title: `${task.issue_key}: checks finished for ${title}`,
        description: `${r.passed} passed, ${r.failed} failed. ${title} reads them in checks.txt.`,
        taskId: task.id,
        os: true,
      });
    } catch (e) {
      this.env.notify({ tone: 'error', title: `${task.issue_key}: checks couldn't run`, description: (e as Error).message, taskId: task.id });
    } finally {
      this.checking.delete(stageId);
    }
    if (this.cancelled.delete(stageId) || this.stage(stageId).status !== 'queued') {
      this.env.changed(task.id);
      return;
    }
    this.queue.push(stageId);
    this.pump(version);
    this.env.changed(task.id);
    this.env.sessionsChanged();
  }

  isChecking(stageId: number): boolean {
    return this.checking.has(stageId);
  }

  /** Its session reached SessionStart, so the next launch resumes rather than starts. */
  private resumable(stage: StageRow): boolean {
    return stage.session_id !== null && this.sessionStarted(stage.session_id);
  }

  /** Starts queued stages while slots are free, FIFO. */
  private pump(version: string | null = null) {
    while (this.queue.length && this.live.size < this.env.maxSessions()) {
      const stageId = this.queue.shift()!;
      try {
        if (this.stage(stageId).status !== 'queued') continue;
        this.spawnRun(stageId, version);
      } catch (e) {
        const stage = this.env.db.prepare('SELECT task_id, session_id FROM stage WHERE id = ?').get(stageId) as { task_id: number; session_id: string | null } | undefined;
        if (!stage) continue;
        this.setStatus(stageId, stage.session_id ? 'interrupted' : 'pending');
        this.env.changed(stage.task_id);
        this.env.notify({ tone: 'error', title: 'Could not launch claude', description: (e as Error).message, taskId: stage.task_id });
      }
    }
  }

  /** Has this session id ever reached SessionStart? If not, there is nothing to resume. */
  private sessionStarted(sessionId: string): boolean {
    return !!this.env.db
      .prepare("SELECT 1 FROM event e JOIN run r ON r.id = e.run_id WHERE r.session_id = ? AND e.hook = 'SessionStart' LIMIT 1")
      .get(sessionId);
  }

  private spawnRun(stageId: number, version: string | null) {
    const { db } = this.env;
    const stage = this.stage(stageId);
    const task = this.task(stage.task_id);
    const project = this.env.lookup(task.project_slug);
    const tpl = templateOf(task.template_yaml);
    const st = stageTemplate(task, stage.stage_key);

    const resume = this.resumable(stage);
    const sessionId = resume ? stage.session_id! : randomUUID();
    // A fresh start sends the stage prompt; a feedback round sends it again with the feedback file
    // (into the same session when there is one); a plain resume after a crash sends nothing.
    const feedback = this.feedback.get(stageId);
    this.feedback.delete(stageId);
    const prompt =
      resume && !feedback
        ? undefined
        : renderPrompt(readPromptFile(st.prompt, this.env.promptDirs), {
            taskDir: task.task_dir,
            worktree: task.worktree_path,
            issueKey: task.issue_key,
            title: task.title,
            round: stage.round,
            feedbackFile: feedback ? join(task.task_dir, feedback) : '',
            baseSha: task.base_sha ?? '',
          });
    const now = Date.now();
    const runId = Number(
      db
        .prepare('INSERT INTO run (stage_id, session_id, kind, started_at, claude_version) VALUES (?, ?, ?, ?, ?)')
        .run(stage.id, sessionId, feedback ? 'feedback' : resume ? 'resume' : 'start', now, version).lastInsertRowid,
    );
    const files = writeStageFiles(task.task_dir, stage.stage_key, this.env.hookWrapper, {
      stage: stage.stage_key,
      taskDir: task.task_dir,
      worktree: task.worktree_path,
      write: st.write,
      deny: tpl.deny,
    });
    this.env.tailer.watch(task.task_dir);

    const args = claudeArgs({
      mode: resume ? 'resume' : 'start',
      sessionId,
      prompt,
      stage: st,
      addDirs: [task.task_dir, ...project.sharedDirs],
      settings: files.settings,
    });
    let pty: PtyLike;
    try {
      pty = this.env.spawn(this.env.claudeBinary(), args, {
        cwd: task.worktree_path,
        env: stageEnv({ taskDir: task.task_dir, worktree: task.worktree_path, stage: stage.stage_key, runId, policy: files.policy }),
        cols: 120,
        rows: 32,
      });
    } catch (e) {
      db.prepare('UPDATE run SET ended_at = ?, exit_code = -1 WHERE id = ?').run(Date.now(), runId);
      throw e;
    }
    db.prepare("UPDATE stage SET status = 'running', session_id = ? WHERE id = ?").run(sessionId, stage.id);

    let resolveDone = () => {};
    const done = new Promise<void>((r) => (resolveDone = r));
    const live: Live = { runId, stageId, taskId: task.id, taskDir: task.task_dir, pty, buffer: '', pending: '', flush: null, startedAt: now, stopping: false, exited: false, done, resolveDone };
    this.live.set(runId, live);
    pty.onData((d) => this.onData(live, d));
    pty.onExit(({ exitCode }) => void this.onExit(live, exitCode));
    this.env.changed(task.id);
  }

  private onData(l: Live, d: string) {
    l.buffer += d;
    if (l.buffer.length > RING) l.buffer = l.buffer.slice(l.buffer.length - RING);
    // Stop session: /exit with background work running asks "Exit and stop tasks?" (option 1, the default).
    if (l.stopping && /Background work is running/i.test(d)) l.pty.write('\r');
    l.pending += d;
    if (!l.flush)
      l.flush = setTimeout(() => {
        l.flush = null;
        const chunk = l.pending;
        l.pending = '';
        if (chunk) this.env.data(l.runId, chunk);
      }, BATCH_MS);
  }

  private async onExit(l: Live, exitCode: number) {
    if (l.exited) return;
    l.exited = true;
    // ConPTY keeps a handle open after the child exits: always kill and drop the reference.
    try {
      l.pty.kill();
    } catch {
      // "AttachConsole failed" after exit is harmless.
    }
    if (l.flush) clearTimeout(l.flush);
    if (l.pending) this.env.data(l.runId, l.pending);
    // Apply every hook line the session wrote before deciding what its exit means.
    await this.env.tailer.flush(l.taskDir).catch(() => {});
    const { db } = this.env;
    const sawStart = !!db.prepare("SELECT 1 FROM event WHERE run_id = ? AND hook = 'SessionStart' LIMIT 1").get(l.runId);
    const trust = !l.stopping && exitCode !== 0 && !sawStart && Date.now() - l.startedAt < TRUST_WINDOW_MS;
    const note = l.stopping ? 'stopped' : trust ? 'trust_prompt' : null;
    db.prepare('UPDATE run SET ended_at = COALESCE(ended_at, ?), exit_code = ?, exit_note = ? WHERE id = ?').run(Date.now(), exitCode, note, l.runId);
    const stage = this.stage(l.stageId);
    if (['running', 'idle', 'queued'].includes(stage.status)) {
      // A session that never started has nothing to resume: back to not started. A resume that
      // died early (trust prompt, crash) keeps the session it was resuming.
      const resumable = sawStart || this.resumable(stage);
      this.setStatus(l.stageId, resumable ? 'interrupted' : 'pending');
      if (!resumable && stage.session_id) db.prepare('UPDATE stage SET session_id = NULL WHERE id = ?').run(l.stageId);
    }
    this.live.delete(l.runId);
    this.ended.set(l.runId, l.buffer);
    try {
      writeFileSync(join(l.taskDir, 'log', `terminal-${l.runId}.log`), l.buffer);
    } catch {
      // The task folder may be gone; the buffer is still in memory.
    }
    if (trust) {
      const t = this.task(l.taskId);
      this.env.notify({ tone: 'error', title: `${t.issue_key}: Claude exited at the trust prompt`, description: 'Answer "Yes, I trust this folder" next time, or turn on "Trust new worktrees automatically".', taskId: l.taskId });
    }
    this.env.exited(l.runId, exitCode);
    this.env.changed(l.taskId);
    l.resolveDone();
    this.pump();
    this.env.sessionsChanged();
  }

  /**
   * Stop session / End session: interrupt a running turn (Esc), type /exit, confirm the
   * "Background work is running" question if it appears, and kill after 5 s. A queued stage just
   * leaves the queue. Nothing is lost: the session resumes by id.
   */
  async stop(stageId: number): Promise<void> {
    if (this.checking.has(stageId)) {
      // Still running its checks: don't join the queue when they finish.
      this.cancelled.add(stageId);
      const s = this.stage(stageId);
      this.setStatus(stageId, s.session_id && this.sessionStarted(s.session_id) ? 'interrupted' : 'pending');
      this.env.changed(s.task_id);
      this.env.sessionsChanged();
      return;
    }
    const queued = this.queue.indexOf(stageId);
    if (queued >= 0) {
      this.queue.splice(queued, 1);
      const s = this.stage(stageId);
      this.setStatus(stageId, s.session_id && this.sessionStarted(s.session_id) ? 'interrupted' : 'pending');
      this.env.changed(s.task_id);
      this.env.sessionsChanged();
      return;
    }
    const runId = this.liveRunOf(stageId);
    if (runId === null) throw new Error('That stage has no live session');
    const l = this.live.get(runId)!;
    if (l.stopping) return;
    l.stopping = true;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    if (this.stage(stageId).status === 'running') {
      l.pty.write('\x1b');
      await wait(400);
    }
    l.pty.write('/exit');
    await wait(300);
    l.pty.write('\r');
    setTimeout(() => {
      if (l.exited) return;
      try {
        l.pty.kill();
      } catch {
        // already gone
      }
      // Some platforms don't report an exit after kill(); finish the bookkeeping anyway.
      setTimeout(() => void this.onExit(l, -1), 1000);
    }, STOP_TIMEOUT_MS);
  }

  /** Stop and wait until the PTY has exited and its exit is recorded (or it left the queue). */
  async stopAndWait(stageId: number): Promise<void> {
    const runId = this.liveRunOf(stageId);
    const l = runId === null ? undefined : this.live.get(runId);
    if (!l && !this.checking.has(stageId) && !this.queue.includes(stageId)) return;
    await this.stop(stageId);
    if (l) await Promise.race([l.done, new Promise((r) => setTimeout(r, STOP_TIMEOUT_MS + 3000))]);
  }

  input(runId: number, data: string): void {
    this.live.get(runId)?.pty.write(data);
  }

  resize(runId: number, cols: number, rows: number): void {
    const l = this.live.get(runId);
    if (!l || cols < 2 || rows < 2) return;
    try {
      l.pty.resize(Math.floor(cols), Math.floor(rows));
    } catch {
      // resizing a PTY that just exited throws
    }
  }

  /** Output so far: the live ring buffer, a finished run's buffer, or its saved log from an earlier app session. */
  attach(runId: number): { data: string; live: boolean } {
    const l = this.live.get(runId);
    if (l) return { data: l.buffer, live: true };
    const ended = this.ended.get(runId);
    if (ended !== undefined) return { data: ended, live: false };
    const row = this.env.db
      .prepare('SELECT t.task_dir FROM run r JOIN stage s ON s.id = r.stage_id JOIN task t ON t.id = s.task_id WHERE r.id = ?')
      .get(runId) as { task_dir: string } | undefined;
    const file = row && join(row.task_dir, 'log', `terminal-${runId}.log`);
    return { data: file && existsSync(file) ? readFileSync(file, 'utf8') : '', live: false };
  }

  runs(taskId: number): RunInfo[] {
    const task = this.task(taskId);
    const titles = new Map(templateOf(task.template_yaml).stages.map((s) => [s.key, s.title]));
    const rows = this.env.db
      .prepare(
        `SELECT r.id, r.stage_id, s.stage_key, r.kind, r.session_id, r.started_at, r.ended_at, r.exit_code, r.exit_note
         FROM run r JOIN stage s ON s.id = r.stage_id WHERE s.task_id = ? ORDER BY r.id DESC`,
      )
      .all(taskId) as {
      id: number;
      stage_id: number;
      stage_key: string;
      kind: RunInfo['kind'];
      session_id: string;
      started_at: number;
      ended_at: number | null;
      exit_code: number | null;
      exit_note: string | null;
    }[];
    return rows.map((r) => ({
      id: r.id,
      stageId: r.stage_id,
      stageKey: r.stage_key,
      stageTitle: titles.get(r.stage_key) ?? r.stage_key,
      kind: r.kind,
      sessionId: r.session_id,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      exitCode: r.exit_code,
      exitNote: r.exit_note,
      live: this.live.has(r.id),
    }));
  }

  /** Every stage that is queued, running or idle, or holds a live session (awaiting approval). */
  summary(): SessionsSummary {
    const rows = this.env.db
      .prepare(
        `SELECT s.id AS stage_id, s.stage_key, s.status, s.last_message, s.awaiting_since, s.round,
                t.id AS task_id, t.issue_key, t.title, t.project_slug, t.template_yaml
         FROM stage s JOIN task t ON t.id = s.task_id
         WHERE s.status IN ('queued', 'running', 'idle', 'awaiting_approval') AND t.status IN ('draft', 'active') ORDER BY s.id`,
      )
      .all() as {
      stage_id: number;
      stage_key: string;
      status: StageStatus;
      last_message: string | null;
      awaiting_since: number | null;
      round: number;
      task_id: number;
      issue_key: string;
      title: string;
      project_slug: string;
      template_yaml: string;
    }[];
    const stageOf = (r: (typeof rows)[number]) => templateOf(r.template_yaml).stages.find((s) => s.key === r.stage_key);
    const needs: NeedsYou[] = rows
      .filter((r) => r.status === 'awaiting_approval')
      .map((r) => ({
        taskId: r.task_id,
        stageId: r.stage_id,
        issueKey: r.issue_key,
        title: r.title,
        projectSlug: r.project_slug,
        stageKey: r.stage_key,
        stageTitle: stageOf(r)?.title ?? r.stage_key,
        artifact: stageOf(r)?.produces ?? null,
        round: r.round,
        awaitingSince: r.awaiting_since,
        lastMessage: r.last_message,
      }))
      .sort((a, b) => (a.awaitingSince ?? 0) - (b.awaitingSince ?? 0));
    const sessions: LiveSession[] = rows.flatMap((r) => {
      const runId = this.liveRunOf(r.stage_id);
      if (r.status === 'awaiting_approval' && runId === null) return []; // waiting on me, but holds no slot
      const title = stageOf(r)?.title ?? r.stage_key;
      const q = this.queue.indexOf(r.stage_id);
      return [
        {
          taskId: r.task_id,
          stageId: r.stage_id,
          issueKey: r.issue_key,
          title: r.title,
          projectSlug: r.project_slug,
          stageKey: r.stage_key,
          stageTitle: title,
          status: r.status,
          runId,
          startedAt: runId === null ? null : (this.live.get(runId)?.startedAt ?? null),
          lastMessage: r.last_message,
          queuePosition: q >= 0 ? q + 1 : null,
        },
      ];
    });
    return { sessions, needs, live: this.live.size, max: this.env.maxSessions() };
  }

  /** Quit: save each run's output, then kill every PTY. The stages are marked interrupted on the next boot. */
  killAll(): void {
    for (const l of this.live.values()) {
      l.exited = true;
      try {
        writeFileSync(join(l.taskDir, 'log', `terminal-${l.runId}.log`), l.buffer);
      } catch {
        // the task folder may be gone
      }
      try {
        l.pty.kill();
      } catch {
        // already gone
      }
    }
    this.live.clear();
  }
}

/** The produces file is there and non-empty, and requireCommits (if set) is met. */
export async function artifactReady(db: Db, stageId: number): Promise<boolean> {
  const row = db
    .prepare('SELECT s.stage_key, t.template_yaml, t.task_dir, t.worktree_path, t.base_sha FROM stage s JOIN task t ON t.id = s.task_id WHERE s.id = ?')
    .get(stageId) as { stage_key: string; template_yaml: string; task_dir: string; worktree_path: string; base_sha: string | null } | undefined;
  if (!row) return false;
  const st = templateOf(row.template_yaml).stages.find((s) => s.key === row.stage_key);
  if (!st) return false;
  const file = join(row.task_dir, st.produces);
  try {
    if (!existsSync(file) || statSync(file).size === 0 || !readFileSync(file, 'utf8').trim()) return false;
  } catch {
    return false;
  }
  if (st.requireCommits) return row.base_sha !== null && ((await aheadCount(row.worktree_path, row.base_sha)) ?? 0) > 0;
  return true;
}

/** SessionEnd: copy the transcript (and its subagents/ folder) into the task's log/. */
export function copyTranscript(db: Db, runId: number, transcriptPath: string | null): string | null {
  const row = db
    .prepare('SELECT r.transcript_path, r.session_id, t.task_dir FROM run r JOIN stage s ON s.id = r.stage_id JOIN task t ON t.id = s.task_id WHERE r.id = ?')
    .get(runId) as { transcript_path: string | null; session_id: string; task_dir: string } | undefined;
  const src = transcriptPath ?? row?.transcript_path;
  if (!row || !src || !existsSync(src)) return null;
  const dest = join(row.task_dir, 'log', basename(src));
  cpSync(src, dest);
  const subagents = join(dirname(src), row.session_id, 'subagents');
  if (existsSync(subagents)) cpSync(subagents, join(row.task_dir, 'log', row.session_id, 'subagents'), { recursive: true });
  db.prepare('UPDATE run SET transcript = ? WHERE id = ?').run(dest, runId);
  return dest;
}
