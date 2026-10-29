import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { addResources, listTree, readTaskFile, removeResource, renderBrief, safePath, writeTaskFile } from './taskfs';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'yantra-fs-'));
});

describe('renderBrief', () => {
  it('prefills Goal from the body and keeps the SPEC sections', () => {
    const md = renderBrief({ key: 'PAY-3', title: 'Export CSV', body: '  Users want CSV.  ' });
    expect(md.startsWith('# PAY-3: Export CSV\n\n## Goal\n\nUsers want CSV.\n')).toBe(true);
    for (const h of ['## Must / must not', '## Acceptance criteria', '## Pointers (files, modules, people, links)', '## Notes']) expect(md).toContain(h);
    expect(renderBrief({ key: 'PAY-4', title: 'T', body: '' })).toContain('_What should be true when this is done?_');
  });
});

describe('safePath', () => {
  it('stays inside the folder and out of .git', () => {
    expect(safePath(dir, 'resources/a.png')).toBe(join(dir, 'resources', 'a.png'));
    for (const bad of ['../x', 'resources/../../x', '.git/config', '', join(dir, 'brief.md')]) expect(() => safePath(dir, bad)).toThrow();
  });
});

describe('listTree', () => {
  it('puts known files in pipeline order, hides dot entries, then folders, then the rest', () => {
    for (const f of ['zeta.txt', 'plan.md', 'brief.md', 'issue.md', '.stage-x']) writeFileSync(join(dir, f), 'x');
    mkdirSync(join(dir, 'resources'));
    mkdirSync(join(dir, 'misc'));
    mkdirSync(join(dir, '.git'));
    writeFileSync(join(dir, 'resources', 'b 10.png'), 'x');
    writeFileSync(join(dir, 'resources', 'b 9.png'), 'x');
    const tree = listTree(dir);
    expect(tree.map((n) => n.name)).toEqual(['brief.md', 'issue.md', 'resources', 'plan.md', 'misc', 'zeta.txt']);
    expect(tree[2]!.children!.map((n) => n.path)).toEqual(['resources/b 9.png', 'resources/b 10.png']);
  });
});

describe('readTaskFile', () => {
  it('returns text, images as data URLs, and flags binary files', () => {
    writeFileSync(join(dir, 'brief.md'), '﻿# Hi');
    writeFileSync(join(dir, 'shot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(join(dir, 'blob.bin'), Buffer.from([1, 0, 2]));
    expect(readTaskFile(dir, 'brief.md')).toMatchObject({ kind: 'text', text: '# Hi' });
    expect(readTaskFile(dir, 'shot.png')).toMatchObject({ kind: 'image', dataUrl: 'data:image/png;base64,iVBORw==' });
    expect(readTaskFile(dir, 'blob.bin')).toMatchObject({ kind: 'binary', size: 3 });
  });
});

describe('writeTaskFile', () => {
  it('only writes brief.md', () => {
    writeTaskFile(dir, 'brief.md', 'mine');
    expect(readFileSync(join(dir, 'brief.md'), 'utf8')).toBe('mine');
    expect(() => writeTaskFile(dir, 'plan.md', 'x')).toThrow("isn't editable");
  });
});

describe('resources', () => {
  it('copies with a free name and removes only under resources/', () => {
    const src = join(mkdtempSync(join(tmpdir(), 'yantra-src-')), 'spec.pdf');
    writeFileSync(src, 'pdf');
    expect(addResources(dir, [src, src])).toEqual(['spec.pdf', 'spec (2).pdf']);
    removeResource(dir, 'resources/spec.pdf');
    expect(listTree(dir)[0]!.children!.map((n) => n.name)).toEqual(['spec (2).pdf']);
    writeFileSync(join(dir, 'brief.md'), 'x');
    expect(() => removeResource(dir, 'brief.md')).toThrow('Only files in resources/');
    expect(() => addResources(dir, [dir])).toThrow('is a folder');
  });
});
