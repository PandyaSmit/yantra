// Review, ship and done (SPEC "Review, ship and done"). The app pushes only when I click Push,
// never force-pushes without the separate button, and never merges anything.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TaskDiff } from '@shared/metrics';
import type { ProjectLookup } from './board';
import type { Db } from './db/db';
import { currentBranch, removeWorktree, runGit } from './git';
import { reduce, type Action } from './machine';
import { loadState } from './pipeline';
import { commitTaskRepo } from './taskfs';

interface Row {
  id: number;
  issue_id: number;
  project_slug: string;
  issue_key: string;
  title: string;
  status: string;
  branch: string;
  base_sha: string | null;
  worktree_path: string;
  task_dir: string;
}
const row = (db: Db, id: number) => {
  const r = db.prepare('SELECT * FROM task WHERE id = ?').get(id) as Row | undefined;
  if (!r) throw new Error('That task no longer exists');
  return r;
};

/** base...HEAD (or one commit), with the commit list and per-file +/- counts. */
export async function taskDiff(db: Db, id: number, sha?: string): Promise<TaskDiff> {
  const t = row(db, id);
  if (!t.base_sha || !existsSync(t.worktree_path)) return { commits: [], files: [], patch: '' };
  const range = sha ? [`${sha}^!`] : [`${t.base_sha}...HEAD`];
  const [log, num, patch] = await Promise.all([
    runGit(t.worktree_path, ['log', '--format=%h%x09%s', `${t.base_sha}..HEAD`]),
    runGit(t.worktree_path, ['diff', '--numstat', ...range]),
    runGit(t.worktree_path, ['diff', '--no-color', ...range], 30_000),
  ]);
  return {
    commits: log.stdout ? log.stdout.split('\n').map((l) => ({ sha: l.split('\t')[0]!, subject: l.split('\t').slice(1).join('\t') })) : [],
    files: num.stdout
      ? num.stdout.split('\n').map((l) => {
          const [a, r, ...p] = l.split('\t');
          return { path: p.join('\t'), added: Number(a) || 0, removed: Number(r) || 0 };
        })
      : [],
    patch: patch.stdout,
  };
}

const read = (dir: string, f: string) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : '');
/** The Markdown section under a heading that matches `re`, without the heading. */
const section = (md: string, re: RegExp) => {
  const lines = md.split('\n');
  const at = lines.findIndex((l) => /^#{1,4}\s/.test(l) && re.test(l));
  if (at < 0) return '';
  const end = lines.findIndex((l, i) => i > at && /^#{1,4}\s/.test(l));
  return lines.slice(at + 1, end < 0 ? undefined : end).join('\n').trim();
};

/** pr.md if I saved one, else a draft from the artifacts. The first line is the title. */
export function prDraft(db: Db, id: number): string {
  const t = row(db, id);
  const saved = read(t.task_dir, 'pr.md');
  if (saved.trim()) return saved;
  const plan = read(t.task_dir, 'plan.md');
  const impl = read(t.task_dir, 'implementation.md');
  const approach = section(plan, /approach/i) || plan.split(/\n\s*\n/).find((p) => p.trim() && !p.startsWith('#'))?.trim() || '';
  const steps = section(plan, /steps/i)
    .split('\n')
    .filter((l) => /^\s*(\d+\.|[-*])\s/.test(l))
    .map((l) => `- [x] ${l.replace(/^\s*(\d+\.|[-*])\s+/, '')}`)
    .join('\n');
  const research = section(read(t.task_dir, 'research.md'), /problem|finding/i).split('\n').slice(0, 5).join('\n');
  const deviations = section(impl, /deviation/i) || impl.trim();
  const parts = [`${t.issue_key}: ${t.title}`, '', approach && `## Approach\n\n${approach}`, steps && `## Steps\n\n${steps}`, research && `## Research\n\n${research}`, deviations && `## Notes from implementation\n\n${deviations}`];
  return parts.filter((p) => p !== '').join('\n\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

export function savePr(db: Db, id: number, text: string): void {
  writeFileSync(join(row(db, id).task_dir, 'pr.md'), text);
}

function apply(db: Db, lookup: ProjectLookup, id: number, action: Action) {
  const { state } = loadState(db, lookup, id, () => null);
  return reduce(state, action).task.status;
}

/** Push branch (or Force push, with lease). On success a ready-to-ship task becomes pushed. */
export async function push(db: Db, lookup: ProjectLookup, id: number, force: boolean): Promise<{ ok: boolean; output: string }> {
  const t = row(db, id);
  if (t.status !== 'ready_to_ship' && t.status !== 'pushed') throw new Error('Approve every stage before pushing');
  const remote = lookup(t.project_slug).remote;
  if (!remote) throw new Error("This project has no remote to push to");
  const r = await runGit(t.worktree_path, ['push', ...(force ? ['--force-with-lease'] : []), '-u', remote, t.branch], 120_000);
  const output = [r.stdout, r.stderr].filter(Boolean).join('\n');
  if (r.ok && t.status === 'ready_to_ship') db.prepare("UPDATE task SET status = ?, pushed_at = ? WHERE id = ?").run(apply(db, lookup, id, { type: 'pushed' }), Date.now(), id);
  else if (r.ok) db.prepare('UPDATE task SET pushed_at = ? WHERE id = ?').run(Date.now(), id);
  return { ok: r.ok, output };
}

/** Mark done: remove the worktree (keep the branch), write manifest.json, commit the task folder. */
export async function finish(db: Db, lookup: ProjectLookup, id: number, force: boolean): Promise<void> {
  const t = row(db, id);
  const status = apply(db, lookup, id, { type: 'finish' });
  if ((await currentBranch(t.worktree_path)) === t.branch) await removeWorktree(lookup(t.project_slug).repoPath, t.worktree_path, force);
  const now = Date.now();
  db.prepare('UPDATE task SET status = ?, closed_at = ? WHERE id = ?').run(status, now, id);
  const manifest = {
    issue: db.prepare('SELECT * FROM issue WHERE id = ?').get(t.issue_id),
    task: db.prepare('SELECT id, issue_key, title, template, status, branch, base_sha, created_at, pushed_at, closed_at FROM task WHERE id = ?').get(id),
    stages: db.prepare('SELECT stage_key, status, round, approved_hash, approved_at FROM stage WHERE task_id = ? ORDER BY position').all(id),
    totals: db.prepare('SELECT SUM(u.input_tokens) input, SUM(u.output_tokens) output, SUM(u.cache_read) cacheRead, SUM(u.cache_write) cacheWrite FROM usage u JOIN run r ON r.id = u.run_id JOIN stage s ON s.id = r.stage_id WHERE s.task_id = ?').get(id),
  };
  writeFileSync(join(t.task_dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await commitTaskRepo(t.task_dir, 'Done').catch(() => {});
}
