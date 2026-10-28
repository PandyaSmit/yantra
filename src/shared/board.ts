// The board's shared vocabulary and its pure rules: column derivation, fractional ordering,
// which moves are legal, and filtering. Main and renderer both use these; all are unit-tested.
import { z } from 'zod';
import { PALETTE, type PaletteName } from './palette';

export const COLUMNS = ['backlog', 'todo', 'in_progress', 'review', 'done'] as const;
export type ColumnKey = (typeof COLUMNS)[number];

export const COLUMN_LABEL: Record<ColumnKey, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'In Progress',
  review: 'Review',
  done: 'Done',
};

/** 0 none, 1 low, 2 medium, 3 high, 4 urgent. */
export const PRIORITIES = [4, 3, 2, 1, 0] as const;
export type Priority = 0 | 1 | 2 | 3 | 4;
export const PRIORITY_LABEL: Record<Priority, string> = { 0: 'No priority', 1: 'Low', 2: 'Medium', 3: 'High', 4: 'Urgent' };

export const TASK_STATUSES = ['draft', 'active', 'ready_to_ship', 'pushed', 'done', 'abandoned'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface LabelInfo {
  id: number;
  name: string;
  color: PaletteName;
}

/** The issue's live task (status is never 'abandoned'), or null. */
export interface TaskSummary {
  id: number;
  status: Exclude<TaskStatus, 'abandoned'>;
}

export interface Card {
  id: number;
  projectSlug: string;
  number: number;
  key: string; // PAY-12
  title: string;
  body: string;
  column: ColumnKey; // derived: where the card is shown
  priority: Priority;
  position: number;
  archived: boolean;
  labelIds: number[];
  task: TaskSummary | null;
  commentCount: number;
  attachmentCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface BoardData {
  projectSlug: string;
  labels: LabelInfo[];
  cards: Card[]; // ordered by column, then position
}

export interface IssueComment {
  id: number;
  body: string;
  createdAt: number;
}

export interface IssueAttachment {
  id: number;
  fileName: string;
  size: number;
  createdAt: number;
  path: string;
}

export interface TaskHistoryEntry {
  id: number;
  status: TaskStatus;
  template: string;
  createdAt: number;
  closedAt: number | null;
}

export interface IssueDetail extends Card {
  comments: IssueComment[];
  attachments: IssueAttachment[];
  attachmentsDir: string;
  tasks: TaskHistoryEntry[]; // newest first, abandoned ones included
}

export interface IssueIndexEntry {
  id: number;
  projectSlug: string;
  key: string;
  title: string;
}

// IPC payloads -------------------------------------------------------------

const id = z.number().int().positive();
const title = z.string().trim().min(1, 'Give the issue a title').max(200, 'Keep the title under 200 characters');
const priority = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

export const CreateIssueSchema = z.object({
  projectSlug: z.string().min(1),
  title,
  body: z.string().default(''),
  column: z.enum(['backlog', 'todo', 'review', 'done']).default('backlog'), // In Progress needs a task
  priority: priority.default(0),
  labelIds: z.array(id).default([]),
});
export type CreateIssue = z.input<typeof CreateIssueSchema>;

export const UpdateIssueSchema = z.object({
  id,
  title: title.optional(),
  body: z.string().optional(),
  priority: priority.optional(),
  labelIds: z.array(id).optional(),
});
export type UpdateIssue = z.input<typeof UpdateIssueSchema>;

/** Put the card in `toColumn`, directly after `afterId` and/or before `beforeId` (both optional: end of column). */
export const MoveIssueSchema = z.object({
  issueId: id,
  toColumn: z.enum(COLUMNS),
  afterId: id.optional(),
  beforeId: id.optional(),
});
export type MoveIssue = z.input<typeof MoveIssueSchema>;

export const UpsertLabelSchema = z.object({
  id: id.optional(),
  projectSlug: z.string().min(1),
  name: z.string().trim().min(1, 'Name the label').max(40, 'Keep label names under 40 characters'),
  color: z.enum(PALETTE),
});
export type UpsertLabel = z.input<typeof UpsertLabelSchema>;

export const AddCommentSchema = z.object({ issueId: id, body: z.string().trim().min(1, 'Write something first') });

// Pure rules ---------------------------------------------------------------

export const issueKey = (projectKey: string, number: number) => `${projectKey}-${number}`;

/** SPEC "the one rule": with a live task the column follows the task, otherwise the stored column. */
export function deriveColumn(stored: ColumnKey, task: { status: TaskStatus } | null): ColumnKey {
  if (!task) return stored;
  switch (task.status) {
    case 'draft':
    case 'active':
      return 'in_progress';
    case 'ready_to_ship':
    case 'pushed':
      return 'review';
    case 'done':
      return 'done';
    case 'abandoned':
      return 'todo';
  }
}

/** Below this gap between neighbours the column is renumbered 1, 2, 3, … before inserting. */
export const MIN_GAP = 1e-6;

/** Fractional index between two neighbours; either may be missing (start or end of the column). */
export function positionBetween(above: number | undefined, below: number | undefined): number {
  if (above === undefined && below === undefined) return 1;
  if (above === undefined) return below! - 1;
  if (below === undefined) return above + 1;
  return (above + below) / 2;
}

export const needsRenormalize = (above: number | undefined, below: number | undefined) =>
  above !== undefined && below !== undefined && below - above < MIN_GAP;

export const LOCKED_REASON = 'Column follows the task. Open it to approve or ship.';

export type MoveCheck = { ok: true } | { ok: false; reason: string } | { ok: false; startTask: true };

/** Whether a card may be dropped in a column. Reordering within its own column is always fine. */
export function checkMove(card: Pick<Card, 'column' | 'task'>, toColumn: ColumnKey): MoveCheck {
  if (toColumn === card.column) return { ok: true };
  if (card.task) return { ok: false, reason: LOCKED_REASON };
  if (toColumn === 'in_progress') return { ok: false, startTask: true };
  return { ok: true };
}

export interface BoardFilters {
  text: string;
  labelIds: number[]; // card must have all of them
  priority: Priority | null;
  hasTask: 'any' | 'yes' | 'no';
  showArchived: boolean;
}

export const NO_FILTERS: BoardFilters = { text: '', labelIds: [], priority: null, hasTask: 'any', showArchived: false };

export const isFiltering = (f: BoardFilters) =>
  f.text.trim() !== '' || f.labelIds.length > 0 || f.priority !== null || f.hasTask !== 'any' || f.showArchived;

export function filterCards(cards: Card[], f: BoardFilters): Card[] {
  const words = f.text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return cards.filter((c) => {
    if (c.archived && !f.showArchived) return false;
    if (f.priority !== null && c.priority !== f.priority) return false;
    if (f.hasTask === 'yes' && !c.task) return false;
    if (f.hasTask === 'no' && c.task) return false;
    if (f.labelIds.some((l) => !c.labelIds.includes(l))) return false;
    if (words.length) {
      const hay = `${c.key} ${c.title} ${c.body}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}
