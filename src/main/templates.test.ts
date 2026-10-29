import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadTemplates, parseTemplate, templateInfo } from './templates';

const SHIPPED = join(import.meta.dirname, '../../resources/templates');

describe('shipped templates', () => {
  it('load and validate', () => {
    const { templates, errors } = loadTemplates([SHIPPED]);
    expect(errors).toEqual([]);
    expect(templates.map(templateInfo).map((t) => `${t.name}: ${t.stages.map((s) => s.key).join(',')}`).sort()).toEqual([
      'quickfix: code,review',
      'standard: research,plan,code,review',
    ]);
    const code = templates.find((t) => t.template.name === 'standard')!.template.stages[2]!;
    expect(code).toMatchObject({ write: ['worktree', 'task:implementation.md'], requireCommits: true });
  });
});

describe('parseTemplate', () => {
  it('names the problem', () => {
    expect(() => parseTemplate('name: x\nstages: [')).toThrow('Not valid YAML');
    expect(() => parseTemplate('name: x\nstages: []')).toThrow('at least one stage');
    const stage = '{key: code, title: Code, prompt: p.md, produces: i.md, gate: manual}';
    expect(() => parseTemplate(`name: x\nstages: [${stage}, ${stage}]`)).toThrow('"code" appears twice');
    expect(() => parseTemplate(`name: x\nstages: [{key: code, title: C, prompt: p, produces: i, gate: manual, write: ["/etc"]}]`)).toThrow('worktree');
  });
});

describe('loadTemplates', () => {
  it('lets a user template replace a shipped one by name and reports broken files', () => {
    const user = mkdtempSync(join(tmpdir(), 'yantra-tpl-'));
    writeFileSync(join(user, 'mine.yaml'), 'name: standard\ndescription: Mine\nstages: [{key: code, title: Code, prompt: p.md, produces: i.md, gate: manual}]');
    writeFileSync(join(user, 'broken.yaml'), 'name: [');
    const { templates, errors } = loadTemplates([SHIPPED, user]);
    expect(templates.find((t) => t.template.name === 'standard')!.template.description).toBe('Mine');
    expect(errors.map((e) => e.file)).toEqual(['broken.yaml']);
  });
});
