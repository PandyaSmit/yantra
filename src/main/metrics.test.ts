import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseTranscript, priceFor, readRunUsage } from './metrics';

const ROOT = join(import.meta.dirname, '../..');
const FIXTURE = join(ROOT, 'fixtures/transcripts/main.jsonl');

describe('transcript usage', () => {
  it('dedupes by message id and reads subagent files (SPEC: 736 main, 166 subagent output tokens)', () => {
    const rows = readRunUsage(FIXTURE);
    const out = (side: boolean) => rows.filter((r) => r.sidechain === side).reduce((a, r) => a + r.output, 0);
    expect(out(false)).toBe(736);
    expect(out(true)).toBe(166);
    expect(new Set(rows.map((r) => r.messageId)).size).toBe(rows.length);
  });

  it('skips <synthetic> messages and junk lines', () => {
    const line = (id: string, model: string) => JSON.stringify({ type: 'assistant', message: { id, model, usage: { input_tokens: 1, output_tokens: 5 } } });
    expect(parseTranscript([line('a', 'claude-opus-5-5'), line('a', 'claude-opus-5-5'), line('b', '<synthetic>'), '{oops', JSON.stringify({ type: 'system' })].join('\n'))).toHaveLength(1);
  });

  it('prices by exact id or glob', () => {
    const p = { in: 1, out: 2, cacheRead: 0, cacheWrite: 0 };
    expect(priceFor({ 'claude-opus-*': p }, 'claude-opus-5-5')).toBe(p);
    expect(priceFor({ 'claude-opus-*': p }, 'claude-sonnet-5-5')).toBeNull();
  });
});

describe('the app never merges', () => {
  it('has no merge or rebase calls outside the hook deny lists', () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const f = join(d, n);
        if (statSync(f).isDirectory()) walk(f);
        else if (/\.(ts|tsx|cjs)$/.test(n) && !n.endsWith('.test.ts')) files.push(f);
      }
    };
    walk(join(ROOT, 'src'));
    walk(join(ROOT, 'resources'));
    // Deny lists and docs that name these commands are the only allowed mentions.
    const allowed = ['src/main/launch.ts', 'resources/hook.cjs'];
    const bad = files
      .filter((f) => !allowed.includes(relative(ROOT, f).replace(/\\/g, '/')))
      .filter((f) => /git merge|git rebase|\/merge\b|auto_merge|merge_when_pipeline_succeeds/.test(readFileSync(f, 'utf8')));
    expect(bad.map((f) => relative(ROOT, f))).toEqual([]);
  });
});
