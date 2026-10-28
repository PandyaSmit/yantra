import { describe, expect, it } from 'vitest';
import { migrate, MIGRATIONS, openDb } from './db';

const tables = (db: ReturnType<typeof openDb>) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((r) => r.name);

describe('openDb / migrate', () => {
  it('creates the full schema and sets user_version', () => {
    const db = openDb(':memory:');
    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length);
    expect(tables(db)).toEqual(
      ['event', 'issue', 'issue_attachment', 'issue_comment', 'issue_label', 'issue_seq', 'label', 'review_comment', 'run', 'stage', 'task', 'usage'].sort(),
    );
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('is idempotent', () => {
    const db = openDb(':memory:');
    expect(() => migrate(db)).not.toThrow();
    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length);
  });

  it('applies only pending migrations, in order', () => {
    const db = openDb(':memory:');
    migrate(db, [...MIGRATIONS, 'CREATE TABLE extra (id INTEGER PRIMARY KEY);']);
    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length + 1);
    expect(tables(db)).toContain('extra');
  });

  it('refuses a database newer than the app', () => {
    const db = openDb(':memory:');
    db.pragma(`user_version = ${MIGRATIONS.length + 5}`);
    expect(() => migrate(db)).toThrow(/newer than this app/);
  });

  it('rolls back a failing migration', () => {
    const db = openDb(':memory:');
    expect(() => migrate(db, [...MIGRATIONS, 'CREATE TABLE half (id INTEGER); SELECT * FROM missing;'])).toThrow();
    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length);
    expect(tables(db)).not.toContain('half');
  });

  it('allows one live task per issue, but a new one after abandoning', () => {
    const db = openDb(':memory:');
    db.prepare(
      "INSERT INTO issue (id, project_slug, number, title, column_key, position, created_at, updated_at) VALUES (1, 'p', 1, 't', 'todo', 1, 0, 0)",
    ).run();
    const insertTask = db.prepare(
      "INSERT INTO task (issue_id, project_slug, issue_key, title, template, template_yaml, status, branch, worktree_path, task_dir, created_at) VALUES (1, 'p', 'P-1', 't', 'standard', '', ?, 'b', 'w', 'd', 0)",
    );
    insertTask.run('active');
    expect(() => insertTask.run('draft')).toThrow(/UNIQUE/);
    db.prepare("UPDATE task SET status = 'abandoned'").run();
    expect(() => insertTask.run('draft')).not.toThrow();
  });

  it('enforces foreign keys', () => {
    const db = openDb(':memory:');
    expect(() => db.prepare("INSERT INTO issue_comment (issue_id, body_md, created_at) VALUES (999, 'x', 0)").run()).toThrow(
      /FOREIGN KEY/,
    );
  });
});
