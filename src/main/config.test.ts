import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppConfigSchema, fieldErrors, ProjectSchema, type Project } from '@shared/schemas';
import { defaultConfig, loadConfig, saveConfig } from './config';

const project = (over: Partial<Project> = {}): Project => ({
  slug: 'payments-api',
  name: 'Payments API',
  key: 'PAY',
  color: 'indigo',
  repoPath: 'D:/code/payments-api',
  defaultBranch: 'main',
  remote: 'origin',
  sharedDirs: [],
  worktreeSetup: [],
  ...over,
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'yantra-config-'));
});

describe('loadConfig', () => {
  it('returns valid defaults when the file does not exist', () => {
    const state = loadConfig(join(dir, 'config.json'));
    expect(state.ok).toBe(true);
    if (state.ok) {
      expect(AppConfigSchema.safeParse(state.config).success).toBe(true);
      expect(state.config.projects).toEqual([]);
      expect(state.config.maxConcurrentSessions).toBe(3);
    }
  });

  it('fails loudly on invalid JSON instead of replacing the file', () => {
    const path = join(dir, 'config.json');
    writeFileSync(path, '{ not json');
    const state = loadConfig(path);
    expect(state.ok).toBe(false);
    expect(readFileSync(path, 'utf8')).toBe('{ not json');
  });

  it('reports every schema problem with its path', () => {
    const path = join(dir, 'config.json');
    writeFileSync(path, JSON.stringify({ ...defaultConfig(), maxConcurrentSessions: 0, projects: [project({ key: 'pay' })] }));
    const state = loadConfig(path);
    expect(state.ok).toBe(false);
    if (!state.ok) {
      expect(state.issues.some((i) => i.startsWith('maxConcurrentSessions'))).toBe(true);
      expect(state.issues.some((i) => i.startsWith('projects.0.key'))).toBe(true);
    }
  });
});

describe('saveConfig', () => {
  it('round-trips through load', () => {
    const path = join(dir, 'nested', 'config.json');
    const cfg = { ...defaultConfig(), projects: [project()] };
    saveConfig(path, cfg);
    const state = loadConfig(path);
    expect(state.ok && state.config.projects[0]?.key).toBe('PAY');
  });

  it('refuses duplicate slugs or keys', () => {
    const path = join(dir, 'config.json');
    const dupKey = { ...defaultConfig(), projects: [project(), project({ slug: 'other' })] };
    expect(() => saveConfig(path, dupKey)).toThrow(/Duplicate project key/);
    const dupSlug = { ...defaultConfig(), projects: [project(), project({ key: 'OTH' })] };
    expect(() => saveConfig(path, dupSlug)).toThrow(/Duplicate project slug/);
  });
});

describe('ProjectSchema', () => {
  it('gives form-friendly messages', () => {
    const r = ProjectSchema.safeParse(project({ name: ' ', key: 'P', slug: 'Bad Slug' }));
    expect(r.success).toBe(false);
    if (!r.success) {
      const errs = fieldErrors(r.error);
      expect(errs.name).toBe('Give the project a name');
      expect(errs.key).toMatch(/2 to 5 uppercase/);
      expect(errs.slug).toBeDefined();
    }
  });
});
