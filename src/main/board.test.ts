import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Project } from '@shared/schemas';
import {
  addComment,
  attachFiles,
  createIssue,
  deleteLabel,
  freeName,
  getIssue,
  issueIndex,
  listBoard,
  moveIssue,
  removeAttachment,
  setArchived,
  updateIssue,
  upsertLabel,
} from './board';
import { openDb, type Db } from './db/db';

const project = (slug: string, key: string): Project => ({
  slug,
  name: slug,
  key,
  color: 'indigo',
  repoPath: 'x',
  defaultBranch: 'main',
  remote: '',
  sharedDirs: [],
  worktreeSetup: [],
});
const PAY = project('payments', 'PAY');
const INF = project('infra', 'INF');
const lookup = (slug: string) => (slug === PAY.slug ? PAY : INF);

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
});

const column = (col: string, p = PAY) =>
  listBoard(db, p)
    .cards.filter((c) => c.column === col)
    .map((c) => c.title);

const addTask = (issueId: number, status: string) =>
  db
    .prepare(
      "INSERT INTO task (issue_id, project_slug, issue_key, title, template, template_yaml, status, branch, worktree_path, task_dir, created_at) VALUES (?, 'payments', 'PAY-x', 't', 'standard', '', ?, 'b', 'w', 'd', 0)",
    )
    .run(issueId, status);

describe('createIssue', () => {
  it('numbers issues per project and appends to the column', () => {
    const a = createIssue(db, PAY, { projectSlug: PAY.slug, title: 'A' });
    createIssue(db, PAY, { projectSlug: PAY.slug, title: 'B' });
    createIssue(db, INF, { projectSlug: INF.slug, title: 'X' });
    const board = listBoard(db, PAY);
    expect(board.cards.map((c) => c.key)).toEqual(['PAY-1', 'PAY-2']);
    expect(column('backlog')).toEqual(['A', 'B']);
    expect(listBoard(db, INF).cards[0]!.key).toBe('INF-1');
    expect(getIssue(db, lookup, '/data', a).attachmentsDir).toBe(join('/data', 'issues', 'payments', 'PAY-1', 'attachments'));
  });

  it('never reuses a number, and refuses In Progress', () => {
    createIssue(db, PAY, { projectSlug: PAY.slug, title: 'A' });
    db.prepare('DELETE FROM issue').run();
    createIssue(db, PAY, { projectSlug: PAY.slug, title: 'B' });
    expect(listBoard(db, PAY).cards[0]!.key).toBe('PAY-2');
    expect(() => createIssue(db, PAY, { projectSlug: PAY.slug, title: 'C', column: 'in_progress' as 'todo' })).toThrow();
  });

  it('validates the title and labels', () => {
    expect(() => createIssue(db, PAY, { projectSlug: PAY.slug, title: '   ' })).toThrow(/title/);
    const other = upsertLabel(db, { projectSlug: INF.slug, name: 'ops', color: 'red' });
    expect(() => createIssue(db, PAY, { projectSlug: PAY.slug, title: 'A', labelIds: [other.id] })).toThrow(/another project/);
  });
});

describe('moveIssue', () => {
  let ids: number[];
  beforeEach(() => {
    ids = ['A', 'B', 'C'].map((title) => createIssue(db, PAY, { projectSlug: PAY.slug, title, column: 'todo' }));
  });

  it('reorders within a column using neighbours', () => {
    moveIssue(db, { issueId: ids[2]!, toColumn: 'todo', beforeId: ids[0] });
    expect(column('todo')).toEqual(['C', 'A', 'B']);
    moveIssue(db, { issueId: ids[2]!, toColumn: 'todo', afterId: ids[0], beforeId: ids[1] });
    expect(column('todo')).toEqual(['A', 'C', 'B']);
    moveIssue(db, { issueId: ids[0]!, toColumn: 'todo' });
    expect(column('todo')).toEqual(['C', 'B', 'A']);
  });

  it('moves between columns and survives reopening the database', () => {
    const dir = mkdtempSync(join(tmpdir(), 'yantra-board-'));
    const file = join(dir, 'y.db');
    const disk = openDb(file);
    const [a, b] = ['A', 'B'].map((title) => createIssue(disk, PAY, { projectSlug: PAY.slug, title, column: 'todo' }));
    moveIssue(disk, { issueId: b!, toColumn: 'done' });
    moveIssue(disk, { issueId: a!, toColumn: 'done', beforeId: b });
    disk.close();
    const reopened = openDb(file);
    expect(listBoard(reopened, PAY).cards.map((c) => `${c.column}:${c.title}`)).toEqual(['done:A', 'done:B']);
    reopened.close();
  });

  it('renormalizes the column when the gap gets below 1e-6, keeping order', () => {
    const setPos = db.prepare('UPDATE issue SET position = ? WHERE id = ?');
    setPos.run(1, ids[0]);
    setPos.run(1 + 1e-7, ids[1]);
    moveIssue(db, { issueId: ids[2]!, toColumn: 'todo', afterId: ids[0], beforeId: ids[1] });
    expect(column('todo')).toEqual(['A', 'C', 'B']);
    expect(listBoard(db, PAY).cards.map((c) => c.position)).toEqual([1, 1.5, 2]);
  });

  it('keeps order through many inserts at the same spot', () => {
    for (let i = 0; i < 60; i++) {
      const id = createIssue(db, PAY, { projectSlug: PAY.slug, title: `N${i}`, column: 'todo' });
      moveIssue(db, { issueId: id, toColumn: 'todo', afterId: ids[0], beforeId: listBoard(db, PAY).cards[1]!.id });
    }
    const titles = column('todo');
    expect(titles[0]).toBe('A');
    expect(titles[1]).toBe('N59');
    expect(titles.slice(-2)).toEqual(['B', 'C']);
  });

  it('ignores neighbours from another column and appends', () => {
    const other = createIssue(db, PAY, { projectSlug: PAY.slug, title: 'Z', column: 'done' });
    moveIssue(db, { issueId: ids[0]!, toColumn: 'todo', beforeId: other });
    expect(column('todo')).toEqual(['B', 'C', 'A']);
  });

  it('needs a task for In Progress, and locks task cards to their column', () => {
    expect(() => moveIssue(db, { issueId: ids[0]!, toColumn: 'in_progress' })).toThrow(/Start a task/);
    addTask(ids[0]!, 'active');
    expect(column('in_progress')).toEqual(['A']);
    expect(() => moveIssue(db, { issueId: ids[0]!, toColumn: 'done' })).toThrow(/Column follows the task/);
    expect(() => moveIssue(db, { issueId: ids[0]!, toColumn: 'in_progress' })).not.toThrow();
  });

  it('returns an abandoned task\'s issue to the stored column', () => {
    addTask(ids[0]!, 'abandoned');
    expect(column('todo')).toEqual(['A', 'B', 'C']);
    expect(getIssue(db, lookup, '/d', ids[0]!).tasks.map((t) => t.status)).toEqual(['abandoned']);
  });
});

describe('labels, comments, archive, index', () => {
  it('upserts labels with unique names per project and cascades deletes', () => {
    const bug = upsertLabel(db, { projectSlug: PAY.slug, name: 'bug', color: 'red' });
    expect(() => upsertLabel(db, { projectSlug: PAY.slug, name: 'BUG', color: 'red' })).toThrow(/already a label/);
    expect(() => upsertLabel(db, { projectSlug: INF.slug, name: 'bug', color: 'red' })).not.toThrow();
    upsertLabel(db, { id: bug.id, projectSlug: PAY.slug, name: 'defect', color: 'orange' });
    const id = createIssue(db, PAY, { projectSlug: PAY.slug, title: 'A', labelIds: [bug.id] });
    expect(listBoard(db, PAY).labels).toEqual([{ id: bug.id, name: 'defect', color: 'orange' }]);
    deleteLabel(db, bug.id);
    expect(listBoard(db, PAY).cards.find((c) => c.id === id)!.labelIds).toEqual([]);
  });

  it('updates fields and labels, adds comments, archives', () => {
    const l = upsertLabel(db, { projectSlug: PAY.slug, name: 'ui', color: 'blue' });
    const id = createIssue(db, PAY, { projectSlug: PAY.slug, title: 'A' });
    updateIssue(db, { id, title: 'A2', body: '# hi', priority: 4, labelIds: [l.id] }, 5);
    addComment(db, { issueId: id, body: 'first' }, 6);
    expect(() => addComment(db, { issueId: id, body: '  ' })).toThrow(/Write something/);
    const d = getIssue(db, lookup, '/d', id);
    expect([d.title, d.body, d.priority, d.labelIds, d.commentCount, d.updatedAt]).toEqual(['A2', '# hi', 4, [l.id], 1, 6]);
    expect(d.comments.map((c) => c.body)).toEqual(['first']);
    setArchived(db, id, true);
    expect(listBoard(db, PAY).cards[0]!.archived).toBe(true);
    expect(issueIndex(db, [PAY])).toEqual([]);
    setArchived(db, id, false);
    expect(issueIndex(db, [PAY])).toEqual([{ id, projectSlug: PAY.slug, key: 'PAY-1', title: 'A2', taskId: null }]);
  });
});

describe('attachments', () => {
  it('copies files with free names and removes only the copy', () => {
    const root = mkdtempSync(join(tmpdir(), 'yantra-att-'));
    const src = join(root, 'src');
    mkdirSync(src);
    const file = join(src, 'spec.md');
    writeFileSync(file, 'hello');
    const id = createIssue(db, PAY, { projectSlug: PAY.slug, title: 'A' });

    attachFiles(db, lookup, root, id, [file, file]);
    const d = getIssue(db, lookup, root, id);
    expect(d.attachments.map((a) => a.fileName)).toEqual(['spec.md', 'spec (2).md']);
    expect(readFileSync(d.attachments[1]!.path, 'utf8')).toBe('hello');
    expect(d.attachments[0]!.size).toBe(5);
    expect(() => attachFiles(db, lookup, root, id, [src])).toThrow(/folder/);

    removeAttachment(db, lookup, root, d.attachments[0]!.id);
    expect(existsSync(d.attachments[0]!.path)).toBe(false);
    expect(existsSync(file)).toBe(true);
    expect(getIssue(db, lookup, root, id).attachmentCount).toBe(1);
  });

  it('freeName counts up past taken names', () => {
    const taken = new Set([join('d', 'a.txt'), join('d', 'a (2).txt'), join('d', 'README')]);
    expect(freeName('d', 'a.txt', (p) => taken.has(p))).toBe('a (3).txt');
    expect(freeName('d', 'README', (p) => taken.has(p))).toBe('README (2)');
    expect(freeName('d', 'b.txt', (p) => taken.has(p))).toBe('b.txt');
  });
});
