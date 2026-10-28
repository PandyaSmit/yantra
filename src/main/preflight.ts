// Pre-flight: is the claude CLI present, logged in and past first-run onboarding? Stages never
// launch unless this passes, so onboarding/login screens never appear inside a stage terminal.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import { execa } from 'execa';
import type { PreflightResult } from '@shared/types';
import { cleanClaudeEnv } from './env';

/** Resolve a bare command name against PATH (with Windows extensions), or null. */
export function findOnPath(command: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const exts = process.platform === 'win32' ? (env.PATHEXT || '.EXE;.CMD;.BAT').split(';').concat('') : [''];
  for (const dir of (env.PATH || env.Path || '').split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = join(dir, command + ext.toLowerCase());
      if (existsSync(p)) return p;
    }
  }
  return null;
}

/** "2.1.312 (Claude Code)" → "2.1.312". */
export function parseVersion(stdout: string): string | null {
  return /(\d+\.\d+\.\d+)/.exec(stdout)?.[1] ?? null;
}

export interface AuthStatus {
  loggedIn: boolean;
  email: string | null;
  plan: string | null;
  method: string | null;
}

/** `claude auth status` prints JSON on stdout (exit code 1 when logged out). */
export function parseAuthStatus(stdout: string): AuthStatus | null {
  try {
    const j = JSON.parse(stdout) as Record<string, unknown>;
    if (typeof j.loggedIn !== 'boolean') return null;
    const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
    return { loggedIn: j.loggedIn, email: str(j.email), plan: str(j.subscriptionType), method: str(j.authMethod) };
  } catch {
    return null;
  }
}

/** Reads `hasCompletedOnboarding` from ~/.claude.json. Missing file or flag → false. */
export function readOnboarded(file = join(homedir(), '.claude.json')): boolean {
  try {
    return (JSON.parse(readFileSync(file, 'utf8')) as { hasCompletedOnboarding?: unknown }).hasCompletedOnboarding === true;
  } catch {
    return false;
  }
}

export async function runPreflight(claudeBinary: string): Promise<PreflightResult> {
  const bin = isAbsolute(claudeBinary) || /[\\/]/.test(claudeBinary) ? claudeBinary : findOnPath(claudeBinary);
  const result: PreflightResult = {
    ok: false,
    checkedAt: Date.now(),
    binary: { ok: false, detail: '', path: bin, version: null },
    auth: { ok: false, detail: 'Not checked', email: null, plan: null },
    onboarding: { ok: false, detail: 'Not checked' },
  };

  if (!bin || !existsSync(bin)) {
    result.binary.detail = bin ? `Not found at ${bin}` : `"${claudeBinary}" is not on PATH`;
    return result;
  }
  const env = cleanClaudeEnv();
  const run = (args: string[]) => execa(bin, args, { env, extendEnv: false, reject: false, timeout: 20_000 });

  const version = await run(['--version']);
  result.binary.version = parseVersion(String(version.stdout));
  result.binary.ok = version.exitCode === 0 && result.binary.version !== null;
  result.binary.detail = result.binary.ok
    ? `Claude Code ${result.binary.version}`
    : `Could not run it: ${String(version.stderr || version.stdout || version.shortMessage).split('\n')[0]}`;
  if (!result.binary.ok) return result;

  const auth = parseAuthStatus(String((await run(['auth', 'status'])).stdout));
  result.auth.ok = auth?.loggedIn === true;
  result.auth.email = auth?.email ?? null;
  result.auth.plan = auth?.plan ?? null;
  result.auth.detail = !auth
    ? 'Could not read login status'
    : auth.loggedIn
      ? [auth.email, auth.plan && `${auth.plan} plan`].filter(Boolean).join(' · ') || 'Logged in'
      : 'Not logged in';

  result.onboarding.ok = readOnboarded();
  result.onboarding.detail = result.onboarding.ok ? 'First-run setup done' : 'First-run setup not finished';

  result.ok = result.binary.ok && result.auth.ok && result.onboarding.ok;
  return result;
}
