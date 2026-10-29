// Hook events (SPEC "Event handling in main"): tail each task's log/hooks.jsonl from a byte offset,
// write `event` rows, and drive stage status. State never comes from the terminal screen.
import { closeSync, existsSync, mkdirSync, openSync, readSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import { z } from 'zod';
import type { Notice } from '@shared/sessions';
import type { StageStatus } from '@shared/types';
import type { Db } from './db/db';

/** One line of hooks.jsonl, as resources/hook.cjs writes it. Unknown fields are allowed. */
export const HookLineSchema = z.looseObject({
  ts: z.number(),
  runId: z.number().int().nullable(),
  stage: z.string().nullable(),
  event: z.string(),
  sessionId: z.string().nullable().optional(),
  transcriptPath: z.string().nullable().optional(),
  tool: z.string().nullable().optional(),
  summary: z.string().optional(),
  blocked: z.boolean().default(false),
  reason: z.string().optional(),
  agentId: z.string().optional(),
  source: z.string().nullable().optional(),
  endReason: z.string().nullable().optional(),
  notification: z.boolean().optional(),
  backgroundRunning: z.boolean().optional(),
  lastMessage: z.string().optional(),
});
export type HookLine = z.infer<typeof HookLineSchema>;

export interface HookEnv {
  db: Db;
  /** The stage's `produces` file exists and is non-empty, and its requireCommits gate (if any) is met. */
  artifactReady(stageId: number): Promise<boolean>;
  notify(n: Notice): void;
  changed(taskId: number): void;
  /** SessionEnd: copy the transcript into the task folder. */
  sessionEnded(runId: number, transcriptPath: string | null): void;
}

interface RunCtx {
  run_id: number;
  ended_at: number | null;
  stage_id: number;
  stage_key: string;
  status: StageStatus;
  task_id: number;
  issue_key: string;
}

/** Statuses a hook may move: a stage holding (or about to hold) a live session. */
const LIVE: StageStatus[] = ['queued', 'running', 'idle', 'awaiting_approval'];

export async function applyHookLine(env: HookEnv, line: HookLine): Promise<void> {
  const { db } = env;
  const ctx =
    line.runId === null
      ? undefined
      : (db
          .prepare(
            `SELECT r.id AS run_id, r.ended_at, s.id AS stage_id, s.stage_key, s.status, t.id AS task_id, t.issue_key
             FROM run r JOIN stage s ON s.id = r.stage_id JOIN task t ON t.id = s.task_id WHERE r.id = ?`,
          )
          .get(line.runId) as RunCtx | undefined);

  db.prepare('INSERT INTO event (run_id, ts, hook, tool, summary, blocked) VALUES (?, ?, ?, ?, ?, ?)').run(
    ctx?.run_id ?? null,
    line.ts,
    line.event,
    line.tool ?? null,
    eventSummary(line),
    line.blocked ? 1 : 0,
  );
  if (!ctx) return;

  if (line.blocked) {
    env.notify({ tone: 'error', title: `${ctx.issue_key} ${ctx.stage_key}: blocked by the fence`, description: `${line.summary ?? line.tool ?? ''}`.trim() || line.reason, taskId: ctx.task_id, os: true });
  }

  // Lines from a run that already ended (late SessionEnd) never move the stage.
  const current = ctx.ended_at === null && LIVE.includes(ctx.status);
  const set = (status: StageStatus) => {
    if (status === ctx.status) return;
    db.prepare('UPDATE stage SET status = ?, awaiting_since = ? WHERE id = ?').run(status, status === 'awaiting_approval' ? line.ts : null, ctx.stage_id);
    env.changed(ctx.task_id);
  };

  switch (line.event) {
    case 'SessionStart':
      db.prepare('UPDATE run SET transcript_path = ? WHERE id = ?').run(line.transcriptPath ?? null, ctx.run_id);
      // A fresh start has its prompt on the way (running); a resume waits at the input box until
      // someone types (or a feedback prompt arrives, which is a UserPromptSubmit).
      if (current) set(line.source === 'resume' ? 'idle' : 'running');
      break;
    case 'UserPromptSubmit':
      // A <task-notification> prompt is the CLI waking the agent after a background subagent: still agent time.
      if (current) set('running');
      break;
    case 'Stop': {
      if (line.agentId) break; // a subagent finishing is not the stage's turn ending
      if (line.lastMessage !== undefined) {
        db.prepare('UPDATE stage SET last_message = ? WHERE id = ?').run(line.lastMessage, ctx.stage_id);
        if (!current) env.changed(ctx.task_id);
      }
      if (!current) break;
      // Background subagents still running: a new turn follows when they finish.
      if (line.backgroundRunning) set('running');
      else if (await env.artifactReady(ctx.stage_id)) {
        const was = ctx.status;
        set('awaiting_approval');
        if (was !== 'awaiting_approval') env.notify({ tone: 'success', title: `${ctx.issue_key}: ${ctx.stage_key} is ready for you`, description: 'Its artifact is written. Review it in Files, then approve or request changes.', taskId: ctx.task_id, os: true });
      } else set('idle');
      if (line.lastMessage !== undefined) env.changed(ctx.task_id);
      break;
    }
    case 'SessionEnd':
      env.sessionEnded(ctx.run_id, line.transcriptPath ?? null);
      break;
  }
}

function eventSummary(line: HookLine): string | null {
  if (line.event === 'SessionStart') return line.source ?? null;
  if (line.event === 'SessionEnd') return line.endReason ?? null;
  if (line.event === 'UserPromptSubmit') return line.notification ? 'task-notification' : null;
  if (line.event === 'Stop' && line.agentId) return 'subagent'; // metrics: doesn't end the stage's turn
  if (line.blocked && line.reason) return `${line.summary ?? ''} — ${line.reason}`.slice(0, 600);
  return line.summary || null;
}

/** Tails hooks.jsonl files from a byte offset and hands each complete line on, in order. */
export class HookTailer {
  private files = new Map<string, { offset: number; rest: string; chain: Promise<void> }>();
  private watcher: FSWatcher | null = null;
  private poll: NodeJS.Timeout | null = null;

  constructor(private onLine: (file: string, line: HookLine) => Promise<void>, private onError: (e: unknown) => void = () => {}) {}

  static fileFor = (taskDir: string) => join(taskDir, 'log', 'hooks.jsonl');

  /** Starts tailing a task's hook log from its current end (older lines were handled before). */
  watch(taskDir: string): void {
    const file = HookTailer.fileFor(taskDir);
    if (this.files.has(file)) return;
    mkdirSync(dirname(file), { recursive: true });
    if (!existsSync(file)) writeFileSync(file, '');
    this.files.set(file, { offset: statSync(file).size, rest: '', chain: Promise.resolve() });
    if (!this.watcher) {
      this.watcher = watch(file, { ignoreInitial: true });
      this.watcher.on('change', (f) => void this.read(f));
      this.watcher.on('error', this.onError);
      // Belt and braces: file events on Windows can coalesce or be missed.
      this.poll = setInterval(() => this.files.forEach((_s, f) => void this.read(f)), 1000);
    } else this.watcher.add(file);
  }

  /** Reads and handles everything appended so far; resolves when those lines are applied. */
  flush(taskDir: string): Promise<void> {
    return this.read(HookTailer.fileFor(taskDir));
  }

  private read(file: string): Promise<void> {
    const st = this.files.get(file);
    if (!st) return Promise.resolve();
    let size: number;
    try {
      size = statSync(file).size;
    } catch {
      return st.chain;
    }
    if (size < st.offset) st.offset = 0; // truncated by hand
    if (size === st.offset) return st.chain;
    const buf = Buffer.alloc(size - st.offset);
    const fd = openSync(file, 'r');
    try {
      readSync(fd, buf, 0, buf.length, st.offset);
    } finally {
      closeSync(fd);
    }
    st.offset = size;
    const text = st.rest + buf.toString('utf8');
    const lines = text.split('\n');
    st.rest = lines.pop() ?? '';
    for (const raw of lines) {
      if (!raw.trim()) continue;
      st.chain = st.chain.then(async () => {
        try {
          const parsed = HookLineSchema.safeParse(JSON.parse(raw));
          if (parsed.success) await this.onLine(file, parsed.data);
          else this.onError(new Error(`Unreadable hook line in ${file}: ${raw.slice(0, 200)}`));
        } catch (e) {
          this.onError(e);
        }
      });
    }
    return st.chain;
  }

  async close(): Promise<void> {
    if (this.poll) clearInterval(this.poll);
    await this.watcher?.close();
    this.watcher = null;
    this.files.clear();
  }
}
