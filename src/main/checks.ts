// Checks (SPEC rule 5): a stage's `pre` commands run in the worktree before it spawns. Output and
// exit codes go to checks.txt for the stage to read. Failing checks never block the stage.
import { appendFileSync, writeFileSync } from 'node:fs';
import { execa } from 'execa';
import { cleanClaudeEnv } from './env';

export interface ChecksInput {
  commands: string[];
  cwd: string;
  /** checks.txt in the task folder. */
  out: string;
  title: string;
}
export interface ChecksResult {
  passed: number;
  failed: number;
}
export type RunChecks = (input: ChecksInput) => Promise<ChecksResult>;

const TIMEOUT_MS = 10 * 60_000;

export const runChecks: RunChecks = async ({ commands, cwd, out, title }) => {
  writeFileSync(out, `# Checks for ${title}\n# ${new Date().toISOString()} in ${cwd}\n`);
  const result = { passed: 0, failed: 0 };
  for (const command of commands) {
    appendFileSync(out, `\n$ ${command}\n`);
    const sub = execa(command, { shell: true, cwd, env: cleanClaudeEnv(), extendEnv: false, stdin: 'ignore', all: true, buffer: false, reject: false, timeout: TIMEOUT_MS });
    sub.all?.on('data', (d: Buffer) => appendFileSync(out, d.toString()));
    const r = await sub;
    const ok = r.exitCode === 0;
    result[ok ? 'passed' : 'failed'] += 1;
    appendFileSync(out, r.timedOut ? `[timed out after ${TIMEOUT_MS / 60_000} minutes]\n` : `[exit ${r.exitCode ?? 'killed'}]\n`);
  }
  appendFileSync(out, `\n# ${result.passed} passed, ${result.failed} failed\n`);
  return result;
};
