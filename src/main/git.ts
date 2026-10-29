// Git, via the real git binary: repo inspection for project setup, and task worktrees.
// Nothing here merges, rebases or pushes into the base branch (SPEC hard rule).
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { execa } from 'execa';
import { displayName, slugify, suggestKey } from '@shared/naming';
import type { RepoInfo } from '@shared/types';

export interface GitResult {
  ok: boolean;
  stdout: string;
  /** stderr, or the spawn error when git itself could not run. */
  stderr: string;
}

export async function runGit(cwd: string, args: string[], timeout = 15_000): Promise<GitResult> {
  const r = await execa('git', ['-C', cwd, ...args], { reject: false, timeout });
  return { ok: r.exitCode === 0, stdout: String(r.stdout).trim(), stderr: String(r.stderr || r.shortMessage || '').trim() };
}

async function git(cwd: string, args: string[]): Promise<string | null> {
  const r = await runGit(cwd, args);
  return r.ok ? r.stdout : null;
}

/** The first line of git's complaint, without the "fatal: " prefix. */
export const gitError = (r: GitResult) => r.stderr.split('\n').find(Boolean)?.replace(/^(fatal|error): /, '') ?? 'git failed';

export async function refExists(repo: string, ref: string): Promise<boolean> {
  return (await runGit(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])).ok;
}

export const branchExists = (repo: string, branch: string) => refExists(repo, `refs/heads/${branch}`);

/** `git fetch <remote>`. Returns null on success, else why it failed (offline, no such remote…). */
export async function fetchRemote(repo: string, remote: string): Promise<string | null> {
  const r = await runGit(repo, ['fetch', '--quiet', remote], 60_000);
  return r.ok ? null : gitError(r);
}

/** What a new task branch starts from: <remote>/<default> when that exists, else the local default branch. */
export async function startPoint(repo: string, remote: string, defaultBranch: string): Promise<string | null> {
  if (remote && (await refExists(repo, `refs/remotes/${remote}/${defaultBranch}`))) return `${remote}/${defaultBranch}`;
  if (await branchExists(repo, defaultBranch)) return defaultBranch;
  return null;
}

/** The branch checked out in `dir`, or null if it isn't a git checkout. */
export const currentBranch = (dir: string) => (existsSync(dir) ? git(dir, ['symbolic-ref', '--quiet', '--short', 'HEAD']) : Promise.resolve(null));

/**
 * Creates the worktree at `path` on `branch`. A new branch starts at `from`; an existing branch
 * (left by an earlier, half-finished attempt) is checked out as it is. Stale registrations of
 * deleted worktree folders are pruned first, or git refuses the path.
 */
export async function addWorktree(repo: string, path: string, branch: string, from: string): Promise<void> {
  await runGit(repo, ['worktree', 'prune']);
  const args = (await branchExists(repo, branch)) ? ['worktree', 'add', path, branch] : ['worktree', 'add', '-b', branch, path, from];
  const r = await runGit(repo, args, 120_000);
  if (!r.ok) throw new Error(gitError(r));
}

/** `git worktree remove`; without `force` git refuses when there are modified or untracked files. */
export async function removeWorktree(repo: string, path: string, force = false): Promise<void> {
  const r = await runGit(repo, ['worktree', 'remove', ...(force ? ['--force'] : []), path], 60_000);
  if (!r.ok) throw new Error(gitError(r));
}

export const headSha = (dir: string) => git(dir, ['rev-parse', 'HEAD']);

/** Commits on `upstream` that `dir`'s HEAD doesn't have. */
export async function behindCount(dir: string, upstream: string): Promise<number | null> {
  const n = existsSync(dir) ? await git(dir, ['rev-list', '--count', `HEAD..${upstream}`]) : null;
  return n === null ? null : Number(n);
}

/** Commits on `dir`'s HEAD since `base` (a stage's requireCommits gate). */
export async function aheadCount(dir: string, base: string): Promise<number | null> {
  const n = existsSync(dir) ? await git(dir, ['rev-list', '--count', `${base}..HEAD`]) : null;
  return n === null ? null : Number(n);
}

/** Pick the default branch: the remote's HEAD, else the current branch, else main/master if present. */
export function pickDefaultBranch(remoteHead: string | null, current: string | null, locals: string[]): string | null {
  if (remoteHead) return remoteHead.replace(/^[^/]+\//, '');
  if (current) return current;
  return locals.find((b) => b === 'main') ?? locals.find((b) => b === 'master') ?? locals[0] ?? null;
}

export async function inspectRepo(path: string, takenKeys: string[] = []): Promise<RepoInfo> {
  const root = await git(path, ['rev-parse', '--show-toplevel']);
  const name = displayName(basename(root ?? path));
  const base: RepoInfo = {
    ok: false,
    error: null,
    root: root ? root.replace(/\//g, process.platform === 'win32' ? '\\' : '/') : null,
    defaultBranch: null,
    remotes: [],
    suggestedName: name,
    suggestedSlug: slugify(name),
    suggestedKey: suggestKey(name, takenKeys),
  };
  if (!root) return { ...base, error: 'Not a git repository' };

  const remotes = ((await git(path, ['remote'])) ?? '').split('\n').filter(Boolean);
  const remote = remotes.includes('origin') ? 'origin' : remotes[0];
  const remoteHead = remote ? await git(path, ['symbolic-ref', '--short', `refs/remotes/${remote}/HEAD`]) : null;
  const current = await git(path, ['branch', '--show-current']);
  const locals = ((await git(path, ['branch', '--format=%(refname:short)'])) ?? '').split('\n').filter(Boolean);

  return { ...base, ok: true, remotes, defaultBranch: pickDefaultBranch(remoteHead, current, locals) };
}
