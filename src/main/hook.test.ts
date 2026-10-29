import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const HOOK = resolve(__dirname, '../../resources/hook.cjs');
const hook = createRequire(import.meta.url)(HOOK) as {
  decide(payload: unknown, policy: unknown, platform?: string): { blocked: boolean; reason?: string };
  logLine(payload: unknown, env: Record<string, string>, decision: { blocked: boolean; reason?: string }, now?: number): Record<string, unknown>;
  normalizeCommand(cmd: string): string;
};
const fixture = (name: string) => JSON.parse(readFileSync(resolve(__dirname, '../../fixtures/hooks', `${name}.json`), 'utf8'));

const DENY = ['git push', 'git merge', 'git rebase', 'gh pr merge', 'glab mr merge', 'git reset --hard', 'git checkout main'];
const win = {
  taskDir: 'D:\\Yantra\\tasks\\toy\\TOY-1',
  worktree: 'D:\\Yantra\\worktrees\\toy\\TOY-1',
  deny: DENY,
};
const research = { ...win, stage: 'research', write: ['task:research.md'] };
const code = { ...win, stage: 'code', write: ['worktree', 'task:implementation.md'] };

const pre = (tool: string, input: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  hook_event_name: 'PreToolUse',
  tool_name: tool,
  tool_input: input,
  cwd: win.worktree,
  ...extra,
});

describe('hook policy: shell commands', () => {
  it('blocks the captured PowerShell git push', () => {
    const d = hook.decide(fixture('PreToolUse-1'), code, 'win32');
    expect(d.blocked).toBe(true);
    expect(d.reason).toMatch(/git push/);
  });

  it.each([
    ['Bash', 'git push origin main'],
    ['Bash', 'GIT  PUSH -u origin yantra/TOY-1'],
    ['Bash', 'git -C ../repo push'],
    ['Bash', 'git -c core.x=1 --no-pager push'],
    ['Bash', 'sh -c "git push --force"'],
    ['PowerShell', 'cmd /c "git push"'],
    ['PowerShell', "powershell -Command 'git merge main'"],
    ['PowerShell', 'git.exe push'],
    ['Bash', 'cd x && git "push"'],
    ['Bash', 'gh pr merge 12 --squash'],
    ['Bash', 'git reset   --hard HEAD~1'],
    ['PowerShell', 'g^it push'],
  ])('%s: %s is blocked', (tool, command) => {
    expect(hook.decide(pre(tool, { command }), code, 'win32').blocked).toBe(true);
  });

  it.each(['git status', 'git commit -m "TOY-1: step"', 'git log --oneline', 'npm test', 'git checkout -b other'])('%s is allowed', (command) => {
    expect(hook.decide(pre('PowerShell', { command }), code, 'win32').blocked).toBe(false);
  });

  it('uses the template deny list, not a fixed one', () => {
    expect(hook.decide(pre('Bash', { command: 'git push' }), { ...code, deny: [] }, 'win32').blocked).toBe(false);
    expect(hook.decide(pre('Bash', { command: 'rm -rf /' }), { ...code, deny: ['rm -rf'] }, 'win32').blocked).toBe(true);
  });
});

describe('hook policy: file writes', () => {
  it('lets research write research.md (the captured Write, case and slashes differing)', () => {
    const p = { ...fixture('PostToolUse-3'), hook_event_name: 'PreToolUse', tool_input: { file_path: 'd:/yantra/TASKS/toy/toy-1/research.md' } };
    expect(hook.decide(p, research, 'win32').blocked).toBe(false);
  });

  it('keeps research.md and plan.md to their owners', () => {
    const d = hook.decide(pre('Write', { file_path: join(win.taskDir, 'research.md') }), { ...code, write: ['worktree', 'task:research.md'] }, 'win32');
    expect(d).toEqual({ blocked: true, reason: expect.stringMatching(/belongs to the research stage/) });
    expect(hook.decide(pre('Edit', { file_path: `${win.taskDir}\\plan.md` }), research, 'win32').blocked).toBe(true);
  });

  it('lets code write the worktree and implementation.md, nothing else', () => {
    expect(hook.decide(pre('Edit', { file_path: 'src\\add.js' }), code, 'win32').blocked).toBe(false);
    expect(hook.decide(pre('MultiEdit', { file_path: `${win.worktree}\\a\\b.ts` }), code, 'win32').blocked).toBe(false);
    expect(hook.decide(pre('Write', { file_path: `${win.taskDir}\\implementation.md` }), code, 'win32').blocked).toBe(false);
    expect(hook.decide(pre('Write', { file_path: `${win.taskDir}\\review.md` }), code, 'win32').blocked).toBe(true);
    expect(hook.decide(pre('Write', { file_path: '..\\TOY-2\\x.js' }), code, 'win32').blocked).toBe(true);
    expect(hook.decide(pre('Write', { file_path: 'D:\\Yantra\\worktrees\\toy\\TOY-10\\x.js' }), code, 'win32').blocked).toBe(true);
  });

  it('blocks research from editing code', () => {
    const d = hook.decide(pre('Edit', { file_path: `${win.worktree}\\add.js` }), research, 'win32');
    expect(d.blocked).toBe(true);
    expect(d.reason).toMatch(/may only write .*research\.md/);
  });

  it('checks NotebookEdit by notebook_path', () => {
    expect(hook.decide(pre('NotebookEdit', { notebook_path: 'C:\\elsewhere\\n.ipynb' }), code, 'win32').blocked).toBe(true);
  });

  it("allows Claude's own scratchpad folder", () => {
    const scratch = 'C:\\Users\\user\\AppData\\Local\\Temp\\claude\\x\\scratchpad';
    expect(hook.decide(pre('Write', { file_path: `${scratch}\\notes.txt` }, { scratchpad_dir: scratch }), research, 'win32').blocked).toBe(false);
  });

  it('compares case-sensitively on POSIX', () => {
    const posix = { stage: 'research', taskDir: '/y/tasks/T-1', worktree: '/y/wt/T-1', write: ['task:research.md'], deny: [] };
    expect(hook.decide(pre('Write', { file_path: '/y/tasks/T-1/research.md' }, { cwd: '/y/wt/T-1' }), posix, 'linux').blocked).toBe(false);
    expect(hook.decide(pre('Write', { file_path: '/y/tasks/t-1/research.md' }, { cwd: '/y/wt/T-1' }), posix, 'linux').blocked).toBe(true);
  });

  it('never blocks reads, other tools or other events', () => {
    expect(hook.decide(fixture('PreToolUse-3'), research, 'win32').blocked).toBe(false); // Glob
    expect(hook.decide(fixture('PreToolUse-2'), research, 'win32').blocked).toBe(false); // Agent
    expect(hook.decide({ ...fixture('PostToolUse-1'), tool_name: 'PowerShell', tool_input: { command: 'git push' } }, code, 'win32').blocked).toBe(false);
  });
});

describe('hook log line', () => {
  const env = { YANTRA_RUN_ID: '7', YANTRA_STAGE: 'research' };
  it('flags Stop with a running background subagent', () => {
    const l = hook.logLine(fixture('Stop-1'), env, { blocked: false }, 1);
    expect(l).toMatchObject({ ts: 1, runId: 7, stage: 'research', event: 'Stop', backgroundRunning: true });
    expect(l.lastMessage).toMatch(/subagent is still counting/);
    expect(hook.logLine(fixture('Stop-2'), env, { blocked: false }).backgroundRunning).toBe(false);
  });
  it('tags task-notification prompts', () => {
    expect(hook.logLine(fixture('UserPromptSubmit-2'), env, { blocked: false }).notification).toBe(true);
    expect(hook.logLine(fixture('UserPromptSubmit-1'), env, { blocked: false }).notification).toBe(false);
  });
  it('records session start source, end reason and subagent tool calls', () => {
    expect(hook.logLine(fixture('SessionStart-2'), env, { blocked: false })).toMatchObject({ source: 'resume', transcriptPath: expect.stringMatching(/\.jsonl$/) });
    expect(hook.logLine(fixture('SessionEnd-1'), env, { blocked: false }).endReason).toBe('prompt_input_exit');
    expect(hook.logLine(fixture('PostToolUse-2'), env, { blocked: false })).toMatchObject({ tool: 'Glob', agentId: 'a589319faae68fdc3', summary: '**/*.js' });
  });
});

describe('hook.cjs as a process', () => {
  const run = (payload: string, policy: unknown) => {
    const dir = mkdtempSync(join(tmpdir(), 'yantra-hook-'));
    const policyFile = join(dir, 'policy.json');
    writeFileSync(policyFile, JSON.stringify(policy));
    const r = spawnSync(process.execPath, [HOOK], {
      input: payload,
      env: { ...process.env, YANTRA_TASK_DIR: dir, YANTRA_POLICY: policyFile, YANTRA_RUN_ID: '3', YANTRA_STAGE: 'code' },
      encoding: 'utf8',
    });
    const lines = readFileSync(join(dir, 'log', 'hooks.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    return { status: r.status, stderr: r.stderr, lines };
  };

  it('strips a BOM, blocks with exit 2 and logs the block', () => {
    const r = run('\uFEFF' + JSON.stringify(fixture('PreToolUse-1')), code);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/^YANTRA: "git push" is not allowed/);
    expect(r.lines).toEqual([expect.objectContaining({ event: 'PreToolUse', tool: 'PowerShell', blocked: true, runId: 3, summary: 'git push origin main' })]);
  });

  it('exits 0 silently when allowed', () => {
    const r = run(JSON.stringify(fixture('Stop-3')), code);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.lines[0]).toMatchObject({ event: 'Stop', blocked: false });
  });
});
