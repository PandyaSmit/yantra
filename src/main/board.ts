// The local board: issues, labels, comments, attachments and ordering, all in SQLite.
// The pure rules (deriveColumn, positionBetween, checkMove) live in @shared/board.
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import {
  AddCommentSchema,
  checkMove,
  CreateIssueSchema,
  deriveColumn,
  issueKey,
  MoveIssueSchema,
  needsRenormalize,
  positionBetween,
  UpdateIssueSchema,
  UpsertLabelSchema,
  type BoardData,
  type Card,
  type ColumnKey,
  type CreateIssue,
  type IssueDetail,
  type IssueIndexEntry,
  type LabelInfo,
  type MoveIssue,
  type Priority,
  type TaskStatus,
  type UpdateIssue,
  type UpsertLabel,
} from '@shared/board';
import type { PaletteName } from '@shared/palette';
import type { Project } from '@shared/schemas';
import type { Db } from './db/db';

interface IssueRow {
  id: number;
  project_slug: string;
  number: number;
  title: string;
  body_md: string;
  column_key: ColumnKey;
  priority: Priority;
  position: number;
  archived: number;
  created_at: number;
  updated_at: number;
  task_id: number | null;
  task_status: TaskStatus | null;
  comment_count: number;
  attachment_count: number;
}

// Each issue with its live task (at most one, by the partial unique index) and counts.
const ISSUE_SELECT = `
  SELECT i.*, t.id AS task_id, t.status AS task_status,
    (SELECT COUNT(*) FROM issue_comment c WHERE c.issue_id = i.id) AS comment_count,
    (SELECT COUNT(*) FROM issue_attachment a WHERE a.issue_id = i.id) AS attachment_count
  FROM issue i
  LEFT JOIN task t ON t.issue_id = i.id AND t.status <> 'abandoned'`;

// The join only matches live tasks, so a task here is never 'abandoned'.
const liveTask = (row: IssueRow): Card['task'] =>
  row.task_id !== null && row.task_status ? { id: row.task_id, status: row.task_status as NonNullable<Card['task']>['status'] } : null;

function toCard(row: IssueRow, projectKey: string, labelIds: number[]): Card {
  const task = liveTask(row);
  return {
    id: row.id,
    projectSlug: row.project_slug,
    number: row.number,
    key: issueKey(projectKey, row.number),
    title: row.title,
    body: row.body_md,
    column: deriveColumn(row.column_key, task),
    priority: row.priority,
    position: row.position,
    archived: row.archived === 1,
    labelIds,
    task,
    commentCount: row.comment_count,
    attachmentCount: row.attachment_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const COLUMN_ORDER: Record<ColumnKey, number> = { backlog: 0, todo: 1, in_progress: 2, review: 3, done: 4 };
const byColumnThenPosition = (a: Card, b: Card) => COLUMN_ORDER[a.column] - COLUMN_ORDER[b.column] || a.position - b.position;

function issueRow(db: Db, id: number): IssueRow {
  const row = db.prepare(`${ISSUE_SELECT} WHERE i.id = ?`).get(id) as IssueRow | undefined;
  if (!row) throw new Error('That issue no longer exists');
  return row;
}

function labelIdsFor(db: Db, issueId: number): number[] {
  return (db.prepare('SELECT label_id FROM issue_label WHERE issue_id = ? ORDER BY label_id').all(issueId) as { label_id: number }[]).map(
    (r) => r.label_id,
  );
}

/** Resolves an issue's project; throws if the project was removed from config. */
export type ProjectLookup = (slug: string) => Project;

export function getCard(db: Db, lookup: ProjectLookup, id: number): Card {
  const row = issueRow(db, id);
  return toCard(row, lookup(row.project_slug).key, labelIdsFor(db, id));
}

export function listBoard(db: Db, project: Project): BoardData {
  const rows = db.prepare(`${ISSUE_SELECT} WHERE i.project_slug = ?`).all(project.slug) as IssueRow[];
  const links = db
    .prepare('SELECT il.issue_id, il.label_id FROM issue_label il JOIN issue i ON i.id = il.issue_id WHERE i.project_slug = ? ORDER BY il.label_id')
    .all(project.slug) as { issue_id: number; label_id: number }[];
  const labelsOf = new Map<number, number[]>();
  for (const l of links) labelsOf.set(l.issue_id, [...(labelsOf.get(l.issue_id) ?? []), l.label_id]);
  return {
    projectSlug: project.slug,
    labels: listLabels(db, project.slug),
    cards: rows.map((r) => toCard(r, project.key, labelsOf.get(r.id) ?? [])).sort(byColumnThenPosition),
  };
}

export const attachmentsDir = (dataRoot: string, slug: string, key: string) => join(dataRoot, 'issues', slug, key, 'attachments');

export function getIssue(db: Db, lookup: ProjectLookup, dataRoot: string, id: number): IssueDetail {
  const card = getCard(db, lookup, id);
  const dir = attachmentsDir(dataRoot, card.projectSlug, card.key);
  const comments = db.prepare('SELECT id, body_md AS body, created_at AS createdAt FROM issue_comment WHERE issue_id = ? ORDER BY created_at, id').all(id);
  const attachments = (
    db.prepare('SELECT id, file_name AS fileName, size, created_at AS createdAt FROM issue_attachment WHERE issue_id = ? ORDER BY created_at, id').all(id) as {
      id: number;
      fileName: string;
      size: number;
      createdAt: number;
    }[]
  ).map((a) => ({ ...a, path: join(dir, a.fileName) }));
  const tasks = db
    .prepare('SELECT id, status, template, created_at AS createdAt, closed_at AS closedAt FROM task WHERE issue_id = ? ORDER BY created_at DESC, id DESC')
    .all(id);
  return { ...card, comments, attachments, attachmentsDir: dir, tasks } as IssueDetail;
}

/** Every non-archived issue across the given projects, for the command palette. */
export function issueIndex(db: Db, projects: Project[]): IssueIndexEntry[] {
  const keys = new Map(projects.map((p) => [p.slug, p.key]));
  const rows = db
    .prepare(
      `SELECT i.id, i.project_slug, i.number, i.title, t.id AS task_id FROM issue i
       LEFT JOIN task t ON t.issue_id = i.id AND t.status <> 'abandoned'
       WHERE i.archived = 0 ORDER BY i.updated_at DESC`,
    )
    .all() as { id: number; project_slug: string; number: number; title: string; task_id: number | null }[];
  return rows.flatMap((r) => {
    const key = keys.get(r.project_slug);
    return key ? [{ id: r.id, projectSlug: r.project_slug, key: issueKey(key, r.number), title: r.title, taskId: r.task_id }] : [];
  });
}

function assertLabels(db: Db, projectSlug: string, labelIds: number[]) {
  if (!labelIds.length) return;
  const found = db
    .prepare(`SELECT COUNT(*) AS n FROM label WHERE project_slug = ? AND id IN (${labelIds.map(() => '?').join(',')})`)
    .get(projectSlug, ...labelIds) as { n: number };
  if (found.n !== new Set(labelIds).size) throw new Error('One of those labels belongs to another project or was deleted');
}

function setLabels(db: Db, issueId: number, labelIds: number[]) {
  db.prepare('DELETE FROM issue_label WHERE issue_id = ?').run(issueId);
  const insert = db.prepare('INSERT INTO issue_label (issue_id, label_id) VALUES (?, ?)');
  for (const l of new Set(labelIds)) insert.run(issueId, l);
}

function nextNumber(db: Db, slug: string): number {
  db.prepare('INSERT OR IGNORE INTO issue_seq (project_slug, next_number) VALUES (?, 1)').run(slug);
  const { next_number } = db.prepare('SELECT next_number FROM issue_seq WHERE project_slug = ?').get(slug) as { next_number: number };
  db.prepare('UPDATE issue_seq SET next_number = next_number + 1 WHERE project_slug = ?').run(slug);
  return next_number;
}

export function createIssue(db: Db, project: Project, input: CreateIssue, now = Date.now()): number {
  const req = CreateIssueSchema.parse(input);
  return db.transaction(() => {
    assertLabels(db, project.slug, req.labelIds);
    const last = db.prepare('SELECT MAX(position) AS p FROM issue WHERE project_slug = ? AND column_key = ?').get(project.slug, req.column) as {
      p: number | null;
    };
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO issue (project_slug, number, title, body_md, column_key, priority, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(project.slug, nextNumber(db, project.slug), req.title, req.body, req.column, req.priority, positionBetween(last.p ?? undefined, undefined), now, now);
    const id = Number(lastInsertRowid);
    setLabels(db, id, req.labelIds);
    return id;
  })();
}

export function updateIssue(db: Db, input: UpdateIssue, now = Date.now()): void {
  const req = UpdateIssueSchema.parse(input);
  db.transaction(() => {
    const row = issueRow(db, req.id);
    const sets: string[] = [];
    const args: unknown[] = [];
    if (req.title !== undefined) sets.push('title = ?'), args.push(req.title);
    if (req.body !== undefined) sets.push('body_md = ?'), args.push(req.body);
    if (req.priority !== undefined) sets.push('priority = ?'), args.push(req.priority);
    if (req.labelIds !== undefined) {
      assertLabels(db, row.project_slug, req.labelIds);
      setLabels(db, req.id, req.labelIds);
    }
    db.prepare(`UPDATE issue SET ${[...sets, 'updated_at = ?'].join(', ')} WHERE id = ?`).run(...args, now, req.id);
  })();
}

/** The cards shown in a column (derived), ordered, as [id, position]. */
function columnOrder(db: Db, projectSlug: string, column: ColumnKey, excludeId: number) {
  const rows = db.prepare(`${ISSUE_SELECT} WHERE i.project_slug = ? AND i.id <> ? ORDER BY i.position, i.id`).all(projectSlug, excludeId) as IssueRow[];
  return rows.filter((r) => deriveColumn(r.column_key, liveTask(r)) === column).map((r) => ({ id: r.id, position: r.position }));
}

/**
 * Moves a card. The neighbours are resolved against the current order in main, so a stale or
 * filtered view in the renderer still lands the card where it was dropped. The stored column is
 * set to the target even for task cards (where it's ignored), so positions stay in one numbering.
 */
export function moveIssue(db: Db, input: MoveIssue, now = Date.now()): void {
  const req = MoveIssueSchema.parse(input);
  db.transaction(() => {
    const row = issueRow(db, req.issueId);
    const task = liveTask(row);
    const check = checkMove({ column: deriveColumn(row.column_key, task), task }, req.toColumn);
    if (!check.ok) throw new Error('reason' in check ? check.reason : 'Start a task to move an issue to In Progress');

    let order = columnOrder(db, row.project_slug, req.toColumn, row.id);
    const slot = () => {
      const after = req.afterId !== undefined ? order.findIndex((o) => o.id === req.afterId) : -1;
      const before = req.beforeId !== undefined ? order.findIndex((o) => o.id === req.beforeId) : -1;
      const index = after >= 0 ? after + 1 : before >= 0 ? before : order.length;
      return { above: order[index - 1]?.position, below: order[index]?.position };
    };
    let { above, below } = slot();
    if (needsRenormalize(above, below)) {
      const renumber = db.prepare('UPDATE issue SET position = ? WHERE id = ?');
      order.forEach((o, i) => renumber.run(i + 1, o.id));
      order = order.map((o, i) => ({ ...o, position: i + 1 }));
      ({ above, below } = slot());
    }
    db.prepare('UPDATE issue SET column_key = ?, position = ?, updated_at = ? WHERE id = ?').run(req.toColumn, positionBetween(above, below), now, row.id);
  })();
}

export function setArchived(db: Db, id: number, archived: boolean, now = Date.now()): void {
  issueRow(db, id);
  db.prepare('UPDATE issue SET archived = ?, updated_at = ? WHERE id = ?').run(archived ? 1 : 0, now, id);
}

export function projectOf(db: Db, issueId: number): string {
  return issueRow(db, issueId).project_slug;
}

// Labels -------------------------------------------------------------------

export function listLabels(db: Db, projectSlug: string): LabelInfo[] {
  return db.prepare('SELECT id, name, color FROM label WHERE project_slug = ? ORDER BY name COLLATE NOCASE').all(projectSlug) as {
    id: number;
    name: string;
    color: PaletteName;
  }[];
}

export function upsertLabel(db: Db, input: UpsertLabel): LabelInfo {
  const req = UpsertLabelSchema.parse(input);
  const clash = db.prepare('SELECT id FROM label WHERE project_slug = ? AND name = ? COLLATE NOCASE').get(req.projectSlug, req.name) as { id: number } | undefined;
  if (clash && clash.id !== req.id) throw new Error(`There's already a label called "${req.name}"`);
  if (req.id !== undefined) {
    const r = db.prepare('UPDATE label SET name = ?, color = ? WHERE id = ? AND project_slug = ?').run(req.name, req.color, req.id, req.projectSlug);
    if (r.changes === 0) throw new Error('That label no longer exists');
    return { id: req.id, name: req.name, color: req.color };
  }
  const { lastInsertRowid } = db.prepare('INSERT INTO label (project_slug, name, color) VALUES (?, ?, ?)').run(req.projectSlug, req.name, req.color);
  return { id: Number(lastInsertRowid), name: req.name, color: req.color };
}

/** Deletes a label and removes it from every issue (ON DELETE CASCADE). Returns its project. */
export function deleteLabel(db: Db, id: number): string {
  const row = db.prepare('SELECT project_slug FROM label WHERE id = ?').get(id) as { project_slug: string } | undefined;
  if (!row) throw new Error('That label no longer exists');
  db.prepare('DELETE FROM label WHERE id = ?').run(id);
  return row.project_slug;
}

// Comments -----------------------------------------------------------------

export function addComment(db: Db, input: { issueId: number; body: string }, now = Date.now()): void {
  const req = AddCommentSchema.parse(input);
  db.transaction(() => {
    issueRow(db, req.issueId);
    db.prepare('INSERT INTO issue_comment (issue_id, body_md, created_at) VALUES (?, ?, ?)').run(req.issueId, req.body, now);
    db.prepare('UPDATE issue SET updated_at = ? WHERE id = ?').run(now, req.issueId);
  })();
}

// Attachments --------------------------------------------------------------

/** "notes.md" → "notes (2).md" until the name is free in `dir`. */
export function freeName(dir: string, name: string, taken: (path: string) => boolean = existsSync): string {
  if (!taken(join(dir, name))) return name;
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken(join(dir, candidate))) return candidate;
  }
}

/** Copies files into the issue's attachments folder. Folders are refused, not copied. */
export function attachFiles(db: Db, lookup: ProjectLookup, dataRoot: string, issueId: number, paths: string[], now = Date.now()): number {
  const card = getCard(db, lookup, issueId);
  const dir = attachmentsDir(dataRoot, card.projectSlug, card.key);
  for (const p of paths) {
    if (!existsSync(p)) throw new Error(`File not found: ${p}`);
    if (!statSync(p).isFile()) throw new Error(`${basename(p)} is a folder; attach the files inside it instead`);
  }
  mkdirSync(dir, { recursive: true });
  const insert = db.prepare('INSERT INTO issue_attachment (issue_id, file_name, size, created_at) VALUES (?, ?, ?, ?)');
  for (const p of paths) {
    const name = freeName(dir, basename(p));
    copyFileSync(p, join(dir, name));
    insert.run(issueId, name, statSync(p).size, now);
  }
  db.prepare('UPDATE issue SET updated_at = ? WHERE id = ?').run(now, issueId);
  return paths.length;
}

/** Removes an attachment and its copied file (the original the user dropped is untouched). Returns the issue id. */
export function removeAttachment(db: Db, lookup: ProjectLookup, dataRoot: string, attachmentId: number): number {
  const row = db.prepare('SELECT issue_id, file_name FROM issue_attachment WHERE id = ?').get(attachmentId) as
    | { issue_id: number; file_name: string }
    | undefined;
  if (!row) throw new Error('That attachment no longer exists');
  const card = getCard(db, lookup, row.issue_id);
  rmSync(join(attachmentsDir(dataRoot, card.projectSlug, card.key), row.file_name), { force: true });
  db.prepare('DELETE FROM issue_attachment WHERE id = ?').run(attachmentId);
  return row.issue_id;
}
