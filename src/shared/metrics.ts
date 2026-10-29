// Metrics and review: what the renderer sees. Every cost is an estimate from the price table.

export interface Tokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Estimated, in dollars. */
  cost: number;
}

export interface StageMetrics {
  key: string;
  title: string;
  status: string;
  rounds: number;
  activeMs: number;
  waitingMs: number;
  tokens: Tokens;
  toolCalls: number;
  blocked: number;
}

export interface TaskMetrics {
  stages: StageMetrics[];
  activeMs: number;
  waitingMs: number;
  wallMs: number;
  tokens: Tokens;
  /** Transcript copies in the task's log/. */
  transcripts: string[];
}

export interface DoneTask {
  taskId: number;
  projectSlug: string;
  issueKey: string;
  title: string;
  template: string;
  closedAt: number;
  wallMs: number;
  tokens: Tokens;
  activeMs: number;
}

export interface MetricsOverview {
  today: { tokens: Tokens; activeMs: number };
  projects: { slug: string; tasks: number; done: number; tokens: Tokens; activeMs: number }[];
  done: DoneTask[];
}

export interface DiffFile {
  path: string;
  added: number;
  removed: number;
}

export interface TaskDiff {
  commits: { sha: string; subject: string }[];
  files: DiffFile[];
  /** Unified diff, base...HEAD or one commit. */
  patch: string;
}
