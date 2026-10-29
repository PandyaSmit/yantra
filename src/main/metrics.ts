// Metrics (SPEC "Metrics"): tokens from Claude's own transcripts (main file + subagents/*.jsonl,
// deduped by message.id, <synthetic> skipped), time from hook timestamps. Costs are estimates.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { Price } from '@shared/schemas';
import type { MetricsOverview, StageMetrics, TaskMetrics, Tokens } from '@shared/metrics';
import type { Db } from './db/db';
import { templateOf } from './sessions';

export interface UsageRow {
  messageId: string;
  model: string | null;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  sidechain: boolean;
  ts: number | null;
}

/** Assistant usage in one transcript file, one row per API response. Unknown lines are skipped. */
export function parseTranscript(text: string, sidechain = false): UsageRow[] {
  const rows = new Map<string, UsageRow>();
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    let line: { type?: string; isSidechain?: boolean; timestamp?: string; message?: { id?: string; model?: string; usage?: Record<string, number> } };
    try {
      line = JSON.parse(raw);
    } catch {
      continue;
    }
    const m = line.message;
    if (line.type !== 'assistant' || !m?.id || !m.usage || m.model === '<synthetic>') continue;
    rows.set(m.id, {
      messageId: m.id,
      model: m.model ?? null,
      input: m.usage.input_tokens ?? 0,
      output: m.usage.output_tokens ?? 0,
      cacheRead: m.usage.cache_read_input_tokens ?? 0,
      cacheWrite: m.usage.cache_creation_input_tokens ?? 0,
      sidechain: sidechain || line.isSidechain === true,
      ts: line.timestamp ? Date.parse(line.timestamp) : null,
    });
  }
  return [...rows.values()];
}

/** A session transcript plus every `<session>/subagents/*.jsonl` next to it. */
export function readRunUsage(transcript: string): UsageRow[] {
  if (!existsSync(transcript)) return [];
  const rows = parseTranscript(readFileSync(transcript, 'utf8'));
  const sub = join(dirname(transcript), basename(transcript, '.jsonl'), 'subagents');
  if (existsSync(sub))
    for (const f of readdirSync(sub).filter((n) => n.endsWith('.jsonl'))) rows.push(...parseTranscript(readFileSync(join(sub, f), 'utf8'), true));
  return rows;
}

/** Upserts a run's usage (on Stop and SessionEnd). Re-reading is safe: rows are keyed by message id. */
export function ingestRun(db: Db, runId: number): void {
  const run = db.prepare('SELECT transcript_path, transcript FROM run WHERE id = ?').get(runId) as { transcript_path: string | null; transcript: string | null } | undefined;
  const file = [run?.transcript_path, run?.transcript].find((f): f is string => !!f && existsSync(f));
  if (!file) return;
  const up = db.prepare(
    `INSERT INTO usage (message_id, run_id, model, input_tokens, output_tokens, cache_read, cache_write, is_sidechain, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(message_id) DO UPDATE SET output_tokens = excluded.output_tokens, input_tokens = excluded.input_tokens, cache_read = excluded.cache_read, cache_write = excluded.cache_write`,
  );
  db.transaction(() => {
    for (const u of readRunUsage(file)) up.run(u.messageId, runId, u.model, u.input, u.output, u.cacheRead, u.cacheWrite, u.sidechain ? 1 : 0, u.ts);
  })();
}

/** Price per million tokens: an exact model id, else the first glob (`claude-opus-*`) that matches. */
export function priceFor(prices: Record<string, Price>, model: string | null): Price | null {
  if (!model) return null;
  if (prices[model]) return prices[model]!;
  for (const [k, p] of Object.entries(prices)) if (k.includes('*') && new RegExp(`^${k.split('*').map(escape).join('.*')}$`).test(model)) return p;
  return null;
}
const escape = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

const ZERO: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
function tokensWhere(db: Db, prices: Record<string, Price>, where: string, ...args: unknown[]): Tokens {
  const rows = db
    .prepare(
      `SELECT u.model, SUM(u.input_tokens) i, SUM(u.output_tokens) o, SUM(u.cache_read) cr, SUM(u.cache_write) cw
       FROM usage u JOIN run r ON r.id = u.run_id JOIN stage s ON s.id = r.stage_id JOIN task t ON t.id = s.task_id WHERE ${where} GROUP BY u.model`,
    )
    .all(...args) as { model: string | null; i: number; o: number; cr: number; cw: number }[];
  return rows.reduce((acc, r) => {
    const p = priceFor(prices, r.model);
    const cost = p ? (r.i * p.in + r.o * p.out + r.cr * p.cacheRead + r.cw * p.cacheWrite) / 1e6 : 0;
    return { input: acc.input + r.i, output: acc.output + r.o, cacheRead: acc.cacheRead + r.cr, cacheWrite: acc.cacheWrite + r.cw, cost: acc.cost + cost };
  }, ZERO);
}

/** Agent-active time: UserPromptSubmit → the stage's own Stop (a subagent's Stop doesn't close it). */
function activeMs(db: Db, where: string, ...args: unknown[]): number {
  const events = db
    .prepare(
      `SELECT e.run_id, e.ts, e.hook, e.summary FROM event e JOIN run r ON r.id = e.run_id JOIN stage s ON s.id = r.stage_id JOIN task t ON t.id = s.task_id
       WHERE e.hook IN ('UserPromptSubmit', 'Stop', 'SessionEnd') AND ${where} ORDER BY e.run_id, e.ts`,
    )
    .all(...args) as { run_id: number; ts: number; hook: string; summary: string | null }[];
  let total = 0;
  let open: { run: number; ts: number } | null = null;
  for (const e of events) {
    if (open && open.run !== e.run_id) open = null;
    if (e.hook === 'UserPromptSubmit') open ??= { run: e.run_id, ts: e.ts };
    else if (open && e.summary !== 'subagent') {
      total += e.ts - open.ts;
      open = null;
    }
  }
  return total;
}

export function taskMetrics(db: Db, prices: Record<string, Price>, taskId: number, now = Date.now()): TaskMetrics {
  const task = db.prepare('SELECT template_yaml, created_at, closed_at FROM task WHERE id = ?').get(taskId) as { template_yaml: string; created_at: number; closed_at: number | null };
  const titles = new Map(templateOf(task.template_yaml).stages.map((s) => [s.key, s.title]));
  const stages = db.prepare('SELECT id, stage_key, status, round, awaiting_since, approved_at FROM stage WHERE task_id = ? ORDER BY position').all(taskId) as {
    id: number;
    stage_key: string;
    status: string;
    round: number;
    awaiting_since: number | null;
    approved_at: number | null;
  }[];
  const rows: StageMetrics[] = stages.map((s) => {
    const counts = db
      .prepare("SELECT SUM(e.hook = 'PreToolUse') tools, SUM(e.blocked) blocked, MAX(CASE WHEN e.hook = 'Stop' AND IFNULL(e.summary, '') <> 'subagent' THEN e.ts END) last_stop FROM event e JOIN run r ON r.id = e.run_id WHERE r.stage_id = ?")
      .get(s.id) as { tools: number | null; blocked: number | null; last_stop: number | null };
    // Waiting on me: from the turn that finished the artifact to my approval (or now, while it waits).
    const waitingMs = s.status === 'awaiting_approval' && s.awaiting_since ? now - s.awaiting_since : s.approved_at && counts.last_stop ? Math.max(0, s.approved_at - counts.last_stop) : 0;
    return {
      key: s.stage_key,
      title: titles.get(s.stage_key) ?? s.stage_key,
      status: s.status,
      rounds: s.round,
      activeMs: activeMs(db, 's.id = ?', s.id),
      waitingMs,
      tokens: tokensWhere(db, prices, 's.id = ?', s.id),
      toolCalls: counts.tools ?? 0,
      blocked: counts.blocked ?? 0,
    };
  });
  const sum = (f: (s: StageMetrics) => number) => rows.reduce((a, s) => a + f(s), 0);
  return {
    stages: rows,
    activeMs: sum((s) => s.activeMs),
    waitingMs: sum((s) => s.waitingMs),
    wallMs: (task.closed_at ?? now) - task.created_at,
    tokens: tokensWhere(db, prices, 't.id = ?', taskId),
    transcripts: (db.prepare('SELECT r.transcript FROM run r JOIN stage s ON s.id = r.stage_id WHERE s.task_id = ? AND r.transcript IS NOT NULL ORDER BY r.id').all(taskId) as { transcript: string }[]).map((r) => r.transcript),
  };
}

export function overview(db: Db, prices: Record<string, Price>, now = Date.now()): MetricsOverview {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  const since = day.getTime();
  const today = { tokens: tokensWhere(db, prices, 'u.ts >= ?', since), activeMs: activeMsSince(db, since) };
  const projects = (db.prepare('SELECT project_slug AS slug, COUNT(*) AS tasks, SUM(status = \'done\') AS done FROM task WHERE status <> \'abandoned\' GROUP BY project_slug').all() as { slug: string; tasks: number; done: number }[]).map((p) => ({
    ...p,
    tokens: tokensWhere(db, prices, 't.project_slug = ?', p.slug),
    activeMs: activeMs(db, 't.project_slug = ?', p.slug),
  }));
  const done = (db.prepare("SELECT id, project_slug, issue_key, title, template, closed_at, created_at FROM task WHERE status = 'done' ORDER BY closed_at DESC").all() as {
    id: number;
    project_slug: string;
    issue_key: string;
    title: string;
    template: string;
    closed_at: number;
    created_at: number;
  }[]).map((t) => ({
    taskId: t.id,
    projectSlug: t.project_slug,
    issueKey: t.issue_key,
    title: t.title,
    template: t.template,
    closedAt: t.closed_at,
    wallMs: t.closed_at - t.created_at,
    tokens: tokensWhere(db, prices, 't.id = ?', t.id),
    activeMs: activeMs(db, 't.id = ?', t.id),
  }));
  return { today, projects, done };
}

const activeMsSince = (db: Db, since: number) => activeMs(db, 'e.ts >= ?', since);
