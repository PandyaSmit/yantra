import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanClaudeEnv } from './env';
import { parseAuthStatus, parseVersion, readOnboarded, runPreflight } from './preflight';

describe('parseVersion', () => {
  it('reads the semver from `claude --version`', () => {
    expect(parseVersion('2.1.312 (Claude Code)\n')).toBe('2.1.312');
    expect(parseVersion('nope')).toBeNull();
  });
});

describe('parseAuthStatus', () => {
  it('reads a logged-in status (shape from claude 2.1.312)', () => {
    const out = JSON.stringify({
      loggedIn: true,
      authMethod: 'claude.ai',
      apiProvider: 'firstParty',
      email: 'me@example.com',
      subscriptionType: 'pro',
    });
    expect(parseAuthStatus(out)).toEqual({ loggedIn: true, email: 'me@example.com', plan: 'pro', method: 'claude.ai' });
  });
  it('reads a logged-out status', () => {
    expect(parseAuthStatus('{"loggedIn": false, "authMethod": "none"}')?.loggedIn).toBe(false);
  });
  it('returns null for anything that is not the status JSON', () => {
    expect(parseAuthStatus('Error: something')).toBeNull();
    expect(parseAuthStatus('{"foo": 1}')).toBeNull();
  });
});

describe('readOnboarded', () => {
  it('is true only when the flag is exactly true', () => {
    const dir = mkdtempSync(join(tmpdir(), 'yantra-pf-'));
    const f = join(dir, '.claude.json');
    expect(readOnboarded(f)).toBe(false);
    writeFileSync(f, '{"hasCompletedOnboarding": true}');
    expect(readOnboarded(f)).toBe(true);
    writeFileSync(f, '{"hasCompletedOnboarding": "yes"}');
    expect(readOnboarded(f)).toBe(false);
  });
});

describe('cleanClaudeEnv', () => {
  it('drops CLAUDE* vars and ELECTRON_RUN_AS_NODE, keeps the rest', () => {
    const env = cleanClaudeEnv({
      PATH: '/bin',
      CLAUDECODE: '1',
      CLAUDE_CODE_SESSION_ID: 'x',
      claude_lower: 'y',
      ELECTRON_RUN_AS_NODE: '1',
      ANTHROPIC_API_KEY: 'kept',
    });
    expect(env).toEqual({ PATH: '/bin', ANTHROPIC_API_KEY: 'kept' });
  });
});

describe('runPreflight', () => {
  it('fails the binary check, and skips the rest, when the binary is missing', async () => {
    const r = await runPreflight(join(tmpdir(), 'definitely-not-claude.exe'));
    expect(r.ok).toBe(false);
    expect(r.binary.ok).toBe(false);
    expect(r.binary.detail).toMatch(/Not found/);
    expect(r.auth.detail).toBe('Not checked');
  });
});
