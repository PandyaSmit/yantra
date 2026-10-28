import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inspectRepo, pickDefaultBranch } from './git';

describe('pickDefaultBranch', () => {
  it("prefers the remote's HEAD", () => {
    expect(pickDefaultBranch('origin/develop', 'feature', ['main'])).toBe('develop');
  });
  it('then the current branch, then main/master', () => {
    expect(pickDefaultBranch(null, 'trunk', ['main'])).toBe('trunk');
    expect(pickDefaultBranch(null, null, ['dev', 'master'])).toBe('master');
    expect(pickDefaultBranch(null, null, [])).toBeNull();
  });
});

describe('inspectRepo', () => {
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' });

  it('describes a git repo with a remote', async () => {
    const base = mkdtempSync(join(tmpdir(), 'yantra-git-'));
    const origin = join(base, 'origin.git');
    const repo = join(base, 'Payments API');
    git(base, 'init', '--bare', '-b', 'main', origin);
    git(base, 'init', '-b', 'main', repo);
    writeFileSync(join(repo, 'a.txt'), 'a');
    git(repo, 'add', '.');
    git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-m', 'init');
    git(repo, 'remote', 'add', 'origin', origin);

    const info = await inspectRepo(repo, ['PAY']);
    expect(info.ok).toBe(true);
    expect(info.defaultBranch).toBe('main');
    expect(info.remotes).toEqual(['origin']);
    expect(info.suggestedName).toBe('Payments API');
    expect(info.suggestedSlug).toBe('payments-api');
    expect(info.suggestedKey).toBe('PA');
  });

  it('says so when the folder is not a repo', async () => {
    const info = await inspectRepo(mkdtempSync(join(tmpdir(), 'yantra-nogit-')));
    expect(info.ok).toBe(false);
    expect(info.error).toBe('Not a git repository');
  });
});
