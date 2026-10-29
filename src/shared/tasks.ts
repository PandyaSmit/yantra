// Tasks: the template schema, what the renderer sees of a task, and task-folder files.
import { z } from 'zod';
import type { TaskStatus } from './board';
import type { StageStatus } from './types';

// Templates ----------------------------------------------------------------

const StageTemplateSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/, 'Stage keys are lowercase words, like "code"'),
  title: z.string().trim().min(1),
  prompt: z.string().min(1),
  reads: z.array(z.string().min(1)).default([]),
  write: z.array(z.string().regex(/^(worktree|task:[^/\\]+)$/, 'Use "worktree" or "task:<file>"')).default([]),
  produces: z.string().min(1),
  requireCommits: z.boolean().default(false),
  pre: z.array(z.string().trim().min(1)).optional(),
  gate: z.literal('manual'),
  model: z.string().min(1).optional(),
});

export const TemplateSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'Template names are lowercase, like "standard"'),
    description: z.string().default(''),
    stages: z.array(StageTemplateSchema).min(1, 'A template needs at least one stage'),
    deny: z.array(z.string().min(1)).default([]),
  })
  .superRefine((t, ctx) => {
    const seen = new Set<string>();
    t.stages.forEach((s, i) => {
      if (seen.has(s.key)) ctx.addIssue({ code: 'custom', path: ['stages', i, 'key'], message: `Stage "${s.key}" appears twice` });
      seen.add(s.key);
    });
  });
export type Template = z.infer<typeof TemplateSchema>;

/** A template as the Start task dialog shows it. */
export interface TemplateInfo {
  name: string;
  description: string;
  stages: { key: string; title: string }[];
}

/** A template file that failed to load, shown in the dialog so a typo isn't silent. */
export interface TemplateError {
  file: string;
  message: string;
}

// Tasks --------------------------------------------------------------------

export interface StageInfo {
  key: string;
  title: string;
  status: StageStatus;
  round: number;
}

export interface TaskDetail {
  id: number;
  issueId: number;
  projectSlug: string;
  issueKey: string;
  title: string;
  template: string;
  status: TaskStatus;
  branch: string;
  baseSha: string | null;
  worktreePath: string;
  taskDir: string;
  createdAt: number;
  closedAt: number | null;
  /** Set once the folder, worktree and setup commands all finished. Null means setup is unfinished. */
  setupDoneAt: number | null;
  /** True while main is creating it (the Start task checklist is running). */
  creating: boolean;
  stages: StageInfo[];
  defaultBranch: string;
  /** Commits on the default branch since the task branched, or null if unknown. */
  behind: number | null;
}

export const CREATION_STEPS = ['folder', 'worktree', 'setup'] as const;
export type CreationStep = (typeof CREATION_STEPS)[number];

export const CREATION_STEP_LABEL: Record<CreationStep, string> = {
  folder: 'Task folder, issue snapshot and brief',
  worktree: 'Branch and worktree',
  setup: 'Setup commands',
};

export interface TaskProgress {
  issueId: number;
  taskId: number;
  step: CreationStep;
  state: 'running' | 'done' | 'skipped' | 'failed';
  detail?: string;
}

// Task-folder files ----------------------------------------------------------

export interface FileNode {
  /** Relative to the task folder, with forward slashes. */
  path: string;
  name: string;
  kind: 'file' | 'dir';
  size: number;
  mtime: number;
  children?: FileNode[];
}

export type FileContent =
  | { kind: 'text'; text: string; size: number; mtime: number }
  | { kind: 'image'; dataUrl: string; size: number; mtime: number }
  | { kind: 'binary'; size: number; mtime: number }
  | { kind: 'too-large'; size: number; mtime: number };

/** The only task-folder files the app lets me edit in place. Artifacts are written by stages. */
export const EDITABLE_FILES = ['brief.md'] as const;

/** Pipeline order for the Files tree: these come first, in this order, then everything else by name. */
export const FILE_ORDER = [
  'brief.md',
  'issue.md',
  'resources',
  'research.md',
  'plan.md',
  'implementation.md',
  'checks.txt',
  'review.md',
  'pr.md',
  'feedback',
  'log',
];

export const isEditable = (path: string) => (EDITABLE_FILES as readonly string[]).includes(path);
