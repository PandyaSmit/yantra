// The `yantra` CLI's commands. They run inside the app's main process (see cliServer.ts) and go
// through the same handlers as the UI, so the window, events and rules stay exactly the same.
import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { COLUMNS, PRIORITY_LABEL, type Card, type ColumnKey, type Priority } from '@shared/board';
import type { Channel, Req, Res } from '@shared/ipc';
import { PALETTE } from '@shared/palette';
import type { AppConfig, Project } from '@shared/schemas';
import type { FileNode, StageInfo, TaskDetail } from '@shared/tasks';
import { GUIDE, HELP } from './cliText';
import type { Db } from './db/db';

export interface CliEnv {
  call<C extends Channel>(channel: C, req: Req<C>): Promise<Res<C>>;
  db(): Db;
  config(): AppConfig;
  show(taskId?: number): void;
  quit(): void;
  sleep?(ms: number): Promise<void>;
}

export interface CliResult {
  out: string;
  code: number;
}

class Usage extends Error {}

const BOOL = new Set(['json', 'force', 'undo', 'all', 'no-enter', 'no-launch', 'stat']);
const ALIAS: Record<string, string> = { m: 'message', t: 'template', b: 'body', p: 'project', f: 'file' };

export function parseArgs(argv: string[]): { pos: string[]; flags: Record<string, string | true> } {
  const pos: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--') {
      pos.push(...argv.slice(i + 1));
      break;
    }
    const m = /^--([a-z][a-z-]*)(?:=([\s\S]*))?$/.exec(a) ?? /^-([a-z])$/.exec(a);
    if (!m) {
      pos.push(a);
      continue;
    }
    const name = ALIAS[m[1]!] ?? m[1]!;
    const next = argv[i + 1];
    if (m[2] !== undefined) flags[name] = m[2];
    else if (BOOL.has(name) || next === undefined || /^--?[a-z]/.test(next)) flags[name] = true;
    else flags[name] = argv[++i]!;
  }
  return { pos, flags };
}

const PRIORITY_NAMES: Record<string, Priority> = { none: 0, low: 1, medium: 2, med: 2, high: 3, urgent: 4 };
const KEYS: Record<string, string> = { enter: '\r', esc: '\x1b', tab: '\t', up: '\x1b[A', down: '\x1b[B', left: '\x1b[D', right: '\x1b[C', 'ctrl-c': '\x03', space: ' ' };
const ACTIVE = new Set(['queued', 'running']);

/** Strips colours and cursor codes from PTY output and keeps the last `n` non-blank lines. */
export function screenText(data: string, n: number): string {
  const plain = data
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Z0-9]|\x1b[=>78DEM]/g, '')
    .split('\n')
    .map((l) => (l.split('\r').filter((s) => s.trim()).pop() ?? '').replace(/\s+$/, ''))
    .filter((l) => l.trim());
  return plain.slice(-n).join('\n');
}

export async function runCli(env: CliEnv, argv: string[], cwd: string): Promise<CliResult> {
  const { pos, flags } = parseArgs(argv);
  const json = flags.json === true;
  try {
    const r = await dispatch(env, pos, flags, cwd);
    if (r === undefined) return { out: '', code: 0 };
    return { out: (json ? JSON.stringify(r.data ?? null, null, 2) : r.text) + '\n', code: r.code ?? 0 };
  } catch (e) {
    const usage = e instanceof Usage;
    return { out: `${usage ? 'Usage: ' : 'Error: '}${(e as Error).message}\n`, code: usage ? 2 : 1 };
  }
}

type Out = { text: string; data?: unknown; code?: number } | undefined;
const done = (text: string, data?: unknown): Out => ({ text, data: data ?? { ok: true, message: text } });

async function dispatch(env: CliEnv, pos: string[], flags: Record<string, string | true>, cwd: string): Promise<Out> {
  const [group = 'help', sub, ...rest] = pos;
  const str = (name: string): string | undefined => {
    const v = flags[name];
    if (v === true) throw new Usage(`--${name} needs a value`);
    return v;
  };
  const textOf = (inline: string, file: string): string | undefined => {
    const f = str(file);
    return f !== undefined ? readFileSync(resolve(cwd, f), 'utf8') : str(inline);
  };
  const need = (v: string | undefined, what: string): string => {
    if (!v) throw new Usage(what);
    return v;
  };

  const config = env.config();
  const project = (): Project => {
    const slug = str('project');
    if (slug) {
      const p = config.projects.find((x) => x.slug === slug || x.key === slug.toUpperCase());
      if (!p) throw new Error(`No project "${slug}". See yantra project list`);
      return p;
    }
    const here = resolve(cwd).toLowerCase() + sep;
    const inside = config.projects.filter((p) => here.startsWith(resolve(p.repoPath).toLowerCase() + sep));
    if (inside.length) return inside.sort((a, b) => b.repoPath.length - a.repoPath.length)[0]!;
    if (config.projects.length === 1) return config.projects[0]!;
    throw new Error(config.projects.length ? 'Which project? Pass --project <slug>' : 'No projects yet. Add one with yantra project add <repo-path>');
  };
  const issueId = (key: string | undefined): number => {
    const m = /^([A-Za-z]{2,5})-(\d+)$/.exec(need(key, 'give an issue key, like PAY-12'));
    const p = m && config.projects.find((x) => x.key === m[1]!.toUpperCase());
    if (!m || !p) throw new Error(`No issue ${key}`);
    const row = env.db().prepare('SELECT id FROM issue WHERE project_slug = ? AND number = ?').get(p.slug, Number(m[2])) as { id: number } | undefined;
    if (!row) throw new Error(`No issue ${key}`);
    return row.id;
  };
  const taskId = (key: string | undefined): number => {
    const row = env.db().prepare("SELECT id FROM task WHERE issue_id = ? AND status <> 'abandoned' ORDER BY id DESC LIMIT 1").get(issueId(key)) as { id: number } | undefined;
    if (!row) throw new Error(`${key} has no task. Start one with yantra task start ${key}`);
    return row.id;
  };
  const labelIds = async (slug: string): Promise<number[] | undefined> => {
    const names = str('label');
    if (names === undefined) return undefined;
    const board = await env.call('board:list', { projectSlug: slug });
    const ids: number[] = [];
    for (const name of names.split(',').map((s) => s.trim()).filter(Boolean)) {
      const found = board.labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
      ids.push(found ? found.id : (await env.call('labels:upsert', { projectSlug: slug, name, color: PALETTE[(board.labels.length + ids.length) % PALETTE.length]! })).id);
    }
    return ids;
  };
  const priority = (): Priority | undefined => {
    const v = str('priority');
    if (v === undefined) return undefined;
    const p = /^[0-4]$/.test(v) ? (Number(v) as Priority) : PRIORITY_NAMES[v.toLowerCase()];
    if (p === undefined) throw new Usage('--priority is none, low, medium, high or urgent');
    return p;
  };
  const getTask = (key: string | undefined) => env.call('tasks:get', { id: taskId(key) });
  const current = (t: TaskDetail): StageInfo => {
    const key = str('stage');
    const s = key ? t.stages.find((x) => x.key === key) : (t.stages.find((x) => x.status === 'awaiting_approval') ?? t.stages.find((x) => x.status !== 'approved' && x.status !== 'skipped'));
    if (!s) throw new Error(key ? `No stage "${key}" in ${t.template}` : `${t.issueKey} has no open stage (status ${t.status})`);
    return s;
  };
  const launched = (r: Res<'sessions:launch'>, t: string): Out => {
    if (r.ok) return done(t);
    const p = r.preflight;
    const why = [p.binary, p.auth, p.onboarding].filter((c) => !c.ok).map((c) => c.detail);
    return { text: `Claude could not start: ${why.join('; ')}. Open the app (yantra open) to fix it.`, data: { ok: false, problems: why }, code: 1 };
  };

  switch (group) {
    case 'help':
    case '--help':
      return { text: HELP.trimEnd() };
    case 'guide':
      return { text: GUIDE.trimEnd() };
    case 'status': {
      const s = await env.call('sessions:summary', undefined);
      const lines = [`${s.live}/${s.max} sessions live`];
      for (const x of s.sessions) lines.push(`  ${x.issueKey}  ${x.stageTitle}  ${x.status}${x.queuePosition ? ` #${x.queuePosition}` : ''}  ${x.title}`);
      if (s.needs.length) lines.push('Needs you:', ...s.needs.map((n) => `  ${n.issueKey}  ${n.stageTitle} r${n.round}  ${n.artifact ?? ''}  ${n.title}`));
      return { text: lines.join('\n'), data: s };
    }
    case 'open':
      env.show(sub ? taskId(sub) : undefined);
      return done('YANTRA window opened');
    case 'quit':
      setTimeout(() => env.quit(), 100);
      return done('YANTRA is quitting');
    case 'metrics': {
      const o = await env.call('metrics:overview', undefined);
      const tok = (t: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number }) => `${t.input + t.output + t.cacheRead + t.cacheWrite} tokens, est. $${t.cost.toFixed(2)}`;
      const lines = [`Today: ${tok(o.today.tokens)}, ${Math.round(o.today.activeMs / 60000)}m agent time`];
      for (const p of o.projects) lines.push(`  ${p.slug}: ${p.tasks} tasks, ${p.done} done, ${tok(p.tokens)}, ${Math.round(p.activeMs / 60000)}m`);
      return { text: lines.join('\n'), data: o };
    }
    case 'templates': {
      const { templates, errors } = await env.call('templates:list', undefined);
      const lines = templates.map((t) => `${t.name}: ${t.stages.map((s) => s.key).join(' -> ')}${t.description ? `  (${t.description})` : ''}`);
      lines.push(...errors.map((e) => `! ${e.file}: ${e.message}`));
      return { text: lines.join('\n'), data: { templates, errors } };
    }
    case 'project':
      return projectCmd();
    case 'issue':
      return issueCmd();
    case 'label':
      return labelCmd();
    case 'task':
      return taskCmd();
    default:
      throw new Usage(`unknown command "${group}". Run yantra help`);
  }

  async function projectCmd(): Promise<Out> {
    if (sub === 'list' || sub === undefined) {
      return { text: config.projects.map((p) => `${p.slug}  ${p.key}  ${p.defaultBranch}  ${p.repoPath}`).join('\n') || 'No projects yet', data: config.projects };
    }
    if (sub === 'remove') {
      await env.call('projects:remove', { slug: need(rest[0], 'project remove <slug>') });
      return done(`Removed ${rest[0]} (its issues and task folders stay)`);
    }
    if (sub !== 'add') throw new Usage('project list | add <repo-path> | remove <slug>');
    const info = await env.call('repo:inspect', { path: resolve(cwd, need(rest[0], 'project add <repo-path>')) });
    if (!info.ok || !info.root) throw new Error(info.error ?? 'Not a git repository');
    const p: Project = {
      slug: str('slug') ?? info.suggestedSlug,
      name: str('name') ?? info.suggestedName,
      key: (str('key') ?? info.suggestedKey).toUpperCase(),
      color: PALETTE[config.projects.length % PALETTE.length]!,
      repoPath: info.root,
      defaultBranch: need(str('branch') ?? info.defaultBranch ?? undefined, 'no default branch found; pass --branch'),
      remote: info.remotes.includes('origin') ? 'origin' : (info.remotes[0] ?? ''),
      sharedDirs: [],
      worktreeSetup: (str('setup') ?? '').split(';').map((s) => s.trim()).filter(Boolean),
    };
    await env.call('projects:upsert', p);
    return done(`Added ${p.name} (${p.key}) on ${p.defaultBranch}`, p);
  }

  async function issueCmd(): Promise<Out> {
    if (sub === 'list' || sub === undefined) {
      const p = project();
      const b = await env.call('board:list', { projectSlug: p.slug });
      const col = str('column');
      if (col && !(COLUMNS as readonly string[]).includes(col)) throw new Usage(`--column is one of ${COLUMNS.join(', ')}`);
      const cards = b.cards.filter((c) => (flags.all === true || !c.archived) && (!col || c.column === col));
      const label = (c: Card) => c.labelIds.map((id) => b.labels.find((l) => l.id === id)?.name).filter(Boolean).join(',');
      const lines = cards.map((c) => `${c.key.padEnd(8)} ${c.column.padEnd(11)} ${PRIORITY_LABEL[c.priority].padEnd(11)} ${c.title}${label(c) ? `  [${label(c)}]` : ''}${c.task ? `  (task ${c.task.status}${c.task.stage ? `: ${c.task.stage.key} ${c.task.stage.status}` : ''})` : ''}`);
      return { text: lines.join('\n') || 'No issues', data: cards };
    }
    if (sub === 'create') {
      const p = project();
      const column = (str('column') ?? 'backlog') as ColumnKey;
      const card = await env.call('issues:create', {
        projectSlug: p.slug,
        title: need(rest.join(' ') || str('title'), 'issue create <title>'),
        body: textOf('body', 'body-file') ?? '',
        column: column as 'backlog',
        priority: priority() ?? 0,
        labelIds: (await labelIds(p.slug)) ?? [],
      });
      return done(`Created ${card.key}: ${card.title}`, card);
    }
    const id = issueId(rest[0]);
    switch (sub) {
      case 'show': {
        const i = await env.call('issues:get', { id });
        const lines = [`${i.key}  ${i.title}`, `${i.column} · ${PRIORITY_LABEL[i.priority]}${i.task ? ` · task ${i.task.status}` : ''}`, '', i.body || '(no description)'];
        if (i.attachments.length) lines.push('', 'Attachments:', ...i.attachments.map((a) => `  ${a.fileName}`));
        if (i.comments.length) lines.push('', 'Comments:', ...i.comments.map((c) => `  - ${new Date(c.createdAt).toISOString().slice(0, 16)} ${c.body}`));
        return { text: lines.join('\n'), data: i };
      }
      case 'edit': {
        const card = await env.call('issues:update', { id, title: str('title'), body: textOf('body', 'body-file'), priority: priority(), labelIds: await labelIds(project().slug) });
        return done(`Updated ${card.key}`, card);
      }
      case 'move': {
        const to = need(rest[1], `issue move ${rest[0]} <${COLUMNS.join('|')}>`) as ColumnKey;
        if (to === 'in_progress') throw new Error(`Start a task instead: yantra task start ${rest[0]}`);
        await env.call('issues:move', { issueId: id, toColumn: to });
        return done(`Moved ${rest[0]} to ${to}`);
      }
      case 'archive':
        await env.call('issues:archive', { id, archived: flags.undo !== true });
        return done(flags.undo === true ? `Restored ${rest[0]}` : `Archived ${rest[0]}`);
      case 'comment':
        await env.call('comments:add', { issueId: id, body: need(rest.slice(1).join(' ') || textOf('message', 'file'), 'issue comment KEY <text>') });
        return done(`Commented on ${rest[0]}`);
      case 'attach':
        await env.call('issues:attach', { issueId: id, paths: rest.slice(1).map((f) => resolve(cwd, f)) });
        return done(`Attached ${rest.length - 1} file(s) to ${rest[0]}`);
      default:
        throw new Usage('issue list | create | show | edit | move | archive | comment | attach');
    }
  }

  async function labelCmd(): Promise<Out> {
    const p = project();
    const b = await env.call('board:list', { projectSlug: p.slug });
    const find = (name: string | undefined) => b.labels.find((l) => l.name.toLowerCase() === need(name, 'give a label name').toLowerCase());
    if (sub === 'list' || sub === undefined) return { text: b.labels.map((l) => `${l.name} (${l.color})`).join('\n') || 'No labels', data: b.labels };
    if (sub === 'set') {
      const color = str('color') ?? find(rest[0])?.color ?? PALETTE[b.labels.length % PALETTE.length]!;
      if (!(PALETTE as readonly string[]).includes(color)) throw new Usage(`--color is one of ${PALETTE.join(', ')}`);
      const l = await env.call('labels:upsert', { id: find(rest[0])?.id, projectSlug: p.slug, name: rest[0]!, color: color as (typeof PALETTE)[number] });
      return done(`Label ${l.name} saved`, l);
    }
    if (sub === 'delete') {
      const l = find(rest[0]);
      if (!l) throw new Error(`No label ${rest[0]}`);
      await env.call('labels:delete', { id: l.id });
      return done(`Deleted label ${l.name}`);
    }
    throw new Usage('label list | set <name> [--color c] | delete <name>');
  }

  async function taskCmd(): Promise<Out> {
    const key = rest[0];
    switch (sub) {
      case 'start': {
        const template = str('template') ?? (await env.call('templates:list', undefined)).templates[0]?.name;
        const t = await env.call('tasks:create', { issueId: issueId(key), template: need(template, 'no templates found') });
        if (flags['no-launch'] === true || t.status !== 'draft') return done(`${t.issueKey}: task ${t.status} on ${t.branch}`, t);
        return launched(await env.call('sessions:start', { taskId: t.id }), `${t.issueKey}: started ${t.stages[0]?.title ?? 'the first stage'} on ${t.branch}`);
      }
      case 'show':
        return show(await getTask(key));
      case 'wait': {
        const limit = Number(str('timeout') ?? 100) * 1000;
        const sleep = env.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
        const start = Date.now();
        for (;;) {
          const t = await getTask(key);
          const busy = t.creating || t.stages.some((s) => ACTIVE.has(s.status) || s.checking);
          if (!busy) return show(t);
          if (Date.now() - start >= limit) return { ...show(t)!, code: 3 };
          await sleep(1000);
        }
      }
      case 'approve':
      case 'reject':
      case 'skip': {
        const t = await getTask(key);
        const s = current(t);
        const feedback = sub === 'reject' ? need(textOf('message', 'file'), `task reject ${key} -m "what should change"`) : '';
        const action = sub === 'reject' ? { type: 'reject' as const, stageKey: s.key, feedback } : { type: sub, stageKey: s.key };
        return launched(await env.call('pipeline:act', { taskId: t.id, action }), `${t.issueKey}: ${sub === 'approve' ? 'approved' : sub === 'reject' ? 'sent back for another round of' : 'skipped'} ${s.title}`);
      }
      case 'send-back': {
        const t = await getTask(key);
        const to = need(rest[1], `task send-back ${key} <stage> -m "why"`);
        const r = await env.call('pipeline:act', { taskId: t.id, action: { type: 'sendBack', toStageKey: to, feedback: need(textOf('message', 'file'), 'give the reason with -m') } });
        return launched(r, `${t.issueKey}: sent back to ${to}`);
      }
      case 'resume': {
        const t = await getTask(key);
        return launched(await env.call(t.status === 'draft' ? 'sessions:start' : 'sessions:launch', t.status === 'draft' ? ({ taskId: t.id } as never) : ({ stageId: current(t).id } as never)), `${t.issueKey}: launched ${current(t).title}`);
      }
      case 'stop': {
        const t = await getTask(key);
        await env.call('sessions:stop', { stageId: current(t).id });
        return done(`${t.issueKey}: stopped ${current(t).title}`);
      }
      case 'screen': {
        const t = await getTask(key);
        const s = current(t);
        const runId = s.liveRunId ?? s.lastRun?.id;
        if (!runId) throw new Error(`${s.title} has not run yet`);
        const r = await env.call('sessions:attach', { runId });
        const text = screenText(r.data, Number(str('lines') ?? 40));
        return { text: `[${s.title} · ${s.status} · ${r.live ? 'live' : 'ended'}]\n${text}`, data: { stage: s.key, live: r.live, text } };
      }
      case 'type': {
        const t = await getTask(key);
        const runId = current(t).liveRunId;
        if (!runId) throw new Error(`${t.issueKey} has no live session. Run yantra task resume ${key}`);
        const k = str('key');
        if (k !== undefined) {
          const seq = KEYS[k.toLowerCase()];
          if (!seq) throw new Usage(`--key is one of ${Object.keys(KEYS).join(', ')}`);
          await env.call('pty:input', { runId, data: seq });
          return done(`Sent ${k}`);
        }
        await env.call('pty:input', { runId, data: need(rest.slice(1).join(' '), `task type ${key} <text>`) });
        if (flags['no-enter'] !== true) {
          await (env.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms))))(150);
          await env.call('pty:input', { runId, data: '\r' });
        }
        return done('Sent');
      }
      case 'files': {
        const tree = await env.call('tasks:files', { id: taskId(key) });
        const lines: string[] = [];
        const walk = (nodes: FileNode[], depth: number) => nodes.forEach((n) => (lines.push(`${'  '.repeat(depth)}${n.name}${n.kind === 'dir' ? '/' : ''}`), n.children && walk(n.children, depth + 1)));
        walk(tree, 0);
        return { text: lines.join('\n'), data: tree };
      }
      case 'cat': {
        const f = await env.call('tasks:readFile', { id: taskId(key), path: need(rest[1], `task cat ${key} <path>`) });
        return { text: f.kind === 'text' ? f.text.trimEnd() : `(${f.kind}, ${f.size} bytes)`, data: f };
      }
      case 'write': {
        const text = need(textOf('text', 'file'), `task write ${key} brief.md --text T | --file f`);
        await env.call('tasks:writeFile', { id: taskId(key), path: need(rest[1], 'which file?'), text });
        return done(`Saved ${rest[1]}`);
      }
      case 'add': {
        const names = await env.call('tasks:addResources', { id: taskId(key), paths: rest.slice(1).map((f) => resolve(cwd, f)) });
        return done(`Added to resources/: ${names.join(', ')}`, names);
      }
      case 'diff': {
        const d = await env.call('review:diff', { taskId: taskId(key), sha: str('sha') });
        const head = [...d.commits.map((c) => `${c.sha} ${c.subject}`), '', ...d.files.map((f) => `+${f.added} -${f.removed}  ${f.path}`)].join('\n');
        return { text: flags.stat === true ? head : `${head}\n\n${d.patch}`.trimEnd(), data: d };
      }
      case 'pr': {
        const id = taskId(key);
        const file = str('file');
        if (file) {
          await env.call('ship:savePr', { taskId: id, text: readFileSync(resolve(cwd, file), 'utf8') });
          return done('Saved pr.md');
        }
        const text = await env.call('ship:pr', { taskId: id });
        return { text: text.trimEnd(), data: { text } };
      }
      case 'push': {
        const r = await env.call('ship:push', { taskId: taskId(key), force: flags.force === true });
        return { text: r.output.trimEnd() || (r.ok ? 'Pushed' : 'Push failed'), data: r, code: r.ok ? 0 : 1 };
      }
      case 'done':
        await env.call('tasks:finish', { id: taskId(key), force: flags.force === true });
        return done(`${key} done. The branch stays; merge the PR yourself if you haven't`);
      case 'abandon':
        await env.call('tasks:abandon', { id: taskId(key), force: flags.force === true });
        return done(`${key} abandoned; the issue is back in Todo`);
      case 'metrics': {
        const m = await env.call('metrics:task', { taskId: taskId(key) });
        const mins = (ms: number) => `${Math.round(ms / 60000)}m`;
        const lines = [`active ${mins(m.activeMs)} · waiting ${mins(m.waitingMs)} · wall ${mins(m.wallMs)} · est. $${m.tokens.cost.toFixed(2)}`];
        for (const s of m.stages) lines.push(`  ${s.key.padEnd(10)} ${s.status.padEnd(18)} r${s.rounds}  ${mins(s.activeMs)}  in ${s.tokens.input} out ${s.tokens.output}  $${s.tokens.cost.toFixed(2)}`);
        return { text: lines.join('\n'), data: m };
      }
      default:
        throw new Usage('task start | show | wait | approve | reject | send-back | skip | resume | stop | screen | type | files | cat | write | add | diff | pr | push | done | abandon | metrics');
    }
  }
}

const MARK: Record<string, string> = { approved: '✓', skipped: '–', awaiting_approval: '?', running: '●', queued: '…', idle: '◌', interrupted: '!', pending: '○' };

/** A task as text, with the commands that make sense next. */
function show(t: TaskDetail): Out {
  const lines = [`${t.issueKey}  ${t.title}`, `${t.status} · ${t.template} · ${t.branch}${t.behind ? ` · ${t.behind} behind ${t.defaultBranch}` : ''}`];
  for (const s of t.stages) lines.push(`  ${MARK[s.status] ?? ' '} ${s.key.padEnd(10)} ${(s.checking ? 'checking' : s.status).padEnd(18)} r${s.round}  ${s.artifact}${s.modified ? ' (edited since approval)' : ''}`);
  const s = t.stages.find((x) => x.status === 'awaiting_approval') ?? t.stages.find((x) => x.status !== 'approved' && x.status !== 'skipped');
  if (s?.lastMessage) lines.push('', `Last message from ${s.title}:`, s.lastMessage.trim());
  const k = t.issueKey;
  const next: string[] = [];
  if (s?.status === 'awaiting_approval') next.push(`yantra task cat ${k} ${s.artifact}`, `yantra task approve ${k}`, `yantra task reject ${k} -m "..."`);
  else if (s?.status === 'idle') next.push(`yantra task screen ${k}`, `yantra task type ${k} "..."`);
  else if (s?.status === 'interrupted' || (t.status === 'draft' && t.legal.includes('startTask'))) next.push(`yantra task resume ${k}`);
  else if (s && ACTIVE.has(s.status)) next.push(`yantra task wait ${k}`);
  if (t.status === 'ready_to_ship') next.push(`yantra task diff ${k} --stat`, `yantra task pr ${k}`, `yantra task push ${k}`);
  if (t.status === 'pushed') next.push(`(merge the PR yourself) yantra task done ${k}`);
  if (next.length) lines.push('', 'Next:', ...next.map((n) => `  ${n}`));
  return { text: lines.join('\n'), data: t };
}
