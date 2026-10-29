import { describe, expect, it } from 'vitest';
import type { Channel } from '@shared/ipc';
import type { AppConfig } from '@shared/schemas';
import { parseArgs, runCli, screenText, type CliEnv } from './cli';

describe('cli args', () => {
  it('reads positionals, values, aliases and booleans', () => {
    expect(parseArgs(['task', 'reject', 'PAY-1', '-m', 'fix it', '--json', '--timeout=5'])).toEqual({
      pos: ['task', 'reject', 'PAY-1'],
      flags: { message: 'fix it', json: true, timeout: '5' },
    });
    expect(parseArgs(['issue', 'create', '--', '--odd title'])).toEqual({ pos: ['issue', 'create', '--odd title'], flags: {} });
  });

  it('turns PTY output into plain lines', () => {
    expect(screenText('\x1b[2J\x1b[1;1H\x1b[32mhello\x1b[0m\r\nprogress 10%\rprogress 90%\n\n\x1b]0;title\x07Do you trust this folder?\n', 2)).toBe('progress 90%\nDo you trust this folder?');
  });
});

describe('cli commands', () => {
  const project = { slug: 'pay', key: 'PAY', name: 'Payments', repoPath: 'D:\\repos\\pay', defaultBranch: 'main' };
  const calls: [Channel, unknown][] = [];
  const env: CliEnv = {
    call: (async (channel: Channel, req: unknown) => {
      calls.push([channel, req]);
      if (channel === 'board:list') return { projectSlug: 'pay', labels: [{ id: 7, name: 'bug', color: 'red' }], cards: [] };
      if (channel === 'labels:upsert') return { id: 8, name: 'perf', color: 'blue' };
      if (channel === 'issues:create') return { key: 'PAY-3', title: (req as { title: string }).title };
      throw new Error(`unexpected ${channel}`);
    }) as CliEnv['call'],
    db: () => {
      throw new Error('no db');
    },
    config: () => ({ projects: [project] }) as unknown as AppConfig,
    show: () => {},
    quit: () => {},
  };

  it('creates an issue in the project of the current folder, reusing and creating labels', async () => {
    const r = await runCli(env, ['issue', 'create', 'Fix', 'retries', '--priority', 'high', '--label', 'Bug,perf', '--column', 'todo'], 'D:\\repos\\pay\\src');
    expect(r).toEqual({ out: 'Created PAY-3: Fix retries\n', code: 0 });
    expect(calls.find(([c]) => c === 'issues:create')?.[1]).toEqual({ projectSlug: 'pay', title: 'Fix retries', body: '', column: 'todo', priority: 3, labelIds: [7, 8] });
  });

  it('reports usage and errors with exit codes', async () => {
    expect((await runCli(env, ['nope'], 'C:\\')).code).toBe(2);
    expect(await runCli(env, ['issue', 'show', 'XYZ-1'], 'C:\\')).toEqual({ out: 'Error: No issue XYZ-1\n', code: 1 });
  });
});
