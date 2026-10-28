// Git, via the real git binary. Phase 1 only needs to inspect a repo for project setup.
import { basename } from 'node:path';
import { execa } from 'execa';
import { displayName, slugify, suggestKey } from '@shared/naming';
import type { RepoInfo } from '@shared/types';

async function git(cwd: string, args: string[]): Promise<string | null> {
  const r = await execa('git', ['-C', cwd, ...args], { reject: false, timeout: 15_000 });
  return r.exitCode === 0 ? String(r.stdout).trim() : null;
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
