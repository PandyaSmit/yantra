// config.json: load (validated, failing loudly), save (atomic), defaults.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { AppConfigSchema, type AppConfig } from '@shared/schemas';
import type { ConfigState } from '@shared/types';
import { findOnPath } from './preflight';
import { yantraHome } from './paths';

/** `claude` if it is on PATH, else where `claude install` puts it, else plain `claude`. */
export function defaultClaudeBinary(): string {
  if (findOnPath('claude')) return 'claude';
  const native = join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude');
  return existsSync(native) ? native : 'claude';
}

export function defaultConfig(): AppConfig {
  return {
    version: 1,
    claudeBinary: defaultClaudeBinary(),
    maxConcurrentSessions: 3,
    defaultTemplate: 'standard',
    theme: 'system',
    dataRoot: yantraHome(),
    trustWorktrees: true,
    // Placeholder prices per million tokens (USD). Fill in from Anthropic's pricing page; estimates only.
    priceTable: { 'claude-opus-*': { in: 15, out: 75, cacheRead: 1.5, cacheWrite: 18.75 } },
    projects: [],
  };
}

/** A missing file means first run (defaults, not yet written). A broken file is an error, never silently replaced. */
export function loadConfig(path: string): ConfigState {
  if (!existsSync(path)) return { ok: true, config: defaultConfig() };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    return { ok: false, path, error: 'config.json is not valid JSON', issues: [(e as Error).message] };
  }
  const parsed = AppConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      path,
      error: 'config.json does not match the expected shape',
      issues: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    };
  }
  return { ok: true, config: parsed.data };
}

/** Validate, then write to a temp file and rename, so a crash never leaves half a config. */
export function saveConfig(path: string, config: AppConfig): AppConfig {
  const valid = AppConfigSchema.parse(config);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(valid, null, 2) + '\n');
  renameSync(tmp, path);
  return valid;
}
